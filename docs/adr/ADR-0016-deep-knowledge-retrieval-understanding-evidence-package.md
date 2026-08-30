---
title: Deep Knowledge Retrieval、Understanding 與 Evidence Package
type: adr
scope: Forge Runtime v4 Deep Knowledge semantic flow
updated: 2026-08-28
source: FORGE_RUNTIME_Arch_v4.md、ADR-0015、CONTEXT.md、docs/PLAN-A.md
status: implemented-verified-reviewed
---

# ADR-0016：Deep Knowledge Retrieval、Understanding 與 Evidence Package

## 2026-08-29 Discovery fallback 與 human premise

資料不足復原、`human_premise` origin、跨 snapshot evidence 累積與 fallback validator 限制，依 [`ADR-0021`](ADR-0021-deep-discovery-fallback-human-premise.md) 執行；本 ADR 的 Evidence Package 唯一性、引用存在性與 blocking gate 不放寬。

日期：2026-08-24

## 狀態

Accepted and implemented；使用者已逐項核准，並已完成實作與驗證：初次 Deep 實作 `npm test` 208/208，identity handoff follow-up 完成後完整 209/209，`npm run check` exit 0。

## Context

ADR-0015 已完成 Grill 到 Deep 的 immutable snapshot 交接，但當時刻意排除完整 semantic Deep、正式 Deep result type 與 Evidence Package。現有 Deep 因此只有交接邊界，沒有能把證據轉成可追溯 findings 的兩階段流程。本 ADR 擴充 ADR-0015 的未涵蓋部分，不改變其「Deep 不直接回 Grill」的人類決策邊界。

## Decision

1. Grill 只收集足以讓人做決策的最小證據。Deep 先沿用 Grill 實際引用的完整 evidence 與 immutable decisions，不重讀相同來源；只有客觀缺口才可補查。
2. Grill snapshot 永不被 Deep 修改。Deep 建立衍生 Evidence Package，包含 inherited evidence 與 Deep Retrieval 新增的 supplemental evidence；每個新增 evidence 使用新的 Evidence ID，並標記 `origin`。
3. Deep 分成固定兩階段：
   - `Deep Retrieval`：只可使用 `forge_deep_search` 在 `wiki/`、`code_base/` 補查，或使用 Grill snapshot 已明確存在的 target source；最多沿用既有每次 3 筆上限，完成時由 `forge_deep_retrieval_complete` 鎖定證據集合。
   - `Knowledge Understanding`：只能讀取已鎖定的證據集合，透過 `forge_deep_complete` 產出 Evidence Package，不再搜尋或改動證據集合。
4. 兩階段沿用主 session active model。撤回模型派發構想；本 ADR 不新增 `ForgeLlmRunner`、policy、fallback、模型設定或 custom loop，也不修改 `pi-main/`。
5. Deep result 只有 `completed`、`needs_decision`、`needs_discovery`。`needs_decision` 不直接呼叫 Grill，而由 Workflow 建立新的 `WAIT_USER` round；`needs_discovery` 僅在同一 workflow 第一次時回到 `LIGHT_DISCOVERY`，第二次及之後依 [`ADR-0021`](ADR-0021-deep-discovery-fallback-human-premise.md) 進入 `WAIT_USER`，由該 ADR 限定並取代本條件的無條件回轉。技術失敗或取消保留當前輸入，不自動回 Grill。
6. Evidence Package 最小結構為：`evidence`（`kind`、`source`、`title`、完整 `content`、`metadata`、`origin`）、`decisions`（`decisionId`、`statement`、`evidenceIds`）、`findings`（`statement`、`evidenceIds`）、`limitations`（僅非阻擋限制）。不建立重複的 `citations` 欄位。
7. `completed` 必須通過 deterministic validator：Evidence ID 唯一；每個 finding 至少引用一個 Evidence ID，且所有引用 ID 必須存在於 package；證據保留完整來源與內容；blocking gap／conflict 存在時不得回傳 `completed`。本 ADR 不加入第二個 LLM verifier。
8. 每個 Deep 階段以 `attemptId + sourceRoundId + phase` 識別。stale call 拒絕；`/continue` 以新 `attemptId` 重試當前階段。target source 不明確時不得猜路徑，改回 `needs_decision`。
9. 完成點是驗證通過的 Evidence Package 並轉入 `CONTEXT_BUILD`。本 ticket 不生成 `CONTEXT.md`、ADR、SPEC 或 Ticket 內容，不做 Pattern Card、持久化、UI 或 Web／外部 API。

### 使用者核准的 Evidence Package 介面（2026-08-24）

- 公開建立 seam 為 `createEvidencePackage({ inherited, supplemental, decisions, findings, limitations })`；它自動填入每筆 evidence 的 `origin`，輸出順序固定為 inherited 後 supplemental，merge 細節不另行公開。
- 公開驗證 seam 為 `validateEvidencePackage(package)`，成功回傳 `{ ok: true }`，正常驗證失敗回傳 `{ ok: false, errors: string[] }`，不以 throw 表示預期中的驗證失敗。
- Evidence 欄位固定為 `evidenceId`、`kind: string`、`source`、`title`、`content`、`metadata: Record<string, unknown>`、`origin: "grill" | "deep_retrieval" | "human_premise"`；`human_premise` 的 fallback 規則依 ADR-0021，不能被當成外部事實。
- limitation 固定為 `{ statement: string, blocking: boolean }`；`blocking: true` 時不得完成。Evidence ID 在整個 package 內必須唯一；每個 finding 至少引用一個 evidence ID，且只能引用 package 內存在的 ID。
- Deep retry 保留同一 `sourceRoundId`，只產生新的 `attemptId`。public test seam 與第一個驗收測試為 `EvidencePackage_WhenInheritedAndSupplementalEvidenceMerge_ShouldPreserveOrigins`。

### 使用者核准的 Deep Session State 行為（2026-08-25）

- Deep 狀態只放在 `ForgeSessionState`；public test seam 沿用或擴充 `ForgeSessionState`，不另建 UI state interface，方法命名留在最小實作細節。
- identity 固定為 `attemptId + sourceRoundId + phase`。retry 保留 `sourceRoundId` 與 current input，只更換 `attemptId`；stale call 回傳可辨識結果，不以 throw 表示。
- cancel 清除 active attempt 但保留 current input。相同 immutable snapshot 的 retry／cancel 保留 supplemental evidence；換成新 snapshot 時清除舊 supplemental evidence。
- snapshot 沿用 immutable object identity，不新增 hash 或持久化 ID。

### 使用者核准的 Workflow 分流介面（2026-08-25）

- `ForgeSessionState` 對外只新增一個 public seam：`handleDeepResult(identity, result)`；`result` union 僅包含 `completed`、`needs_decision`、`needs_discovery`。
- `completed` 依 `identity.phase` 分流：`Deep Retrieval` 進入 `Knowledge Understanding`；`Knowledge Understanding` 進入 `CONTEXT_BUILD`。
- `needs_decision` 建立全新的 `WAIT_USER` round，`kind` 為 `deep_decision`，`roundId` 使用目前 `attemptId`，不冒充 Grill round；保留 current input／evidence，並使該 attempt 後續呼叫成為 stale。
- `needs_discovery` 第一次進入 `LIGHT_DISCOVERY` 並結束目前 attempt；第二次及之後依 ADR-0021 進入 `WAIT_USER`，stale 結果靜默忽略且不改變 state。
- technical failure 不屬於 result union，走 cancel／no-op，保留原 Deep phase 與 input，等待 `/continue`。Orchestrator 只負責映射 result，不持有 attempt／evidence；StateMachine 只增加合法轉移。
- public test seam 補為 `handleDeepResult(identity, result)`；第一個 Workflow 紅燈測試為 `StateMachine_WhenRetrievalCompletes_ShouldEnterKnowledgeUnderstanding`。

### 使用者核准的 Deep 工具契約（2026-08-25）

- `forge_deep_search` 接收 attempt identity、`query` 與單一 `source`（`wiki`、`code_base`、`target`），每次最多 3 筆。`target` 僅能匹配 snapshot 中唯一且明確的 target source；缺失或多義一律回 `needs_decision`，不可猜路徑。supplemental ID 由 runtime 產生；既有 inherited／supplemental evidence 必須重用，禁止重讀或重複。
- `forge_deep_retrieval_complete` 接收 attempt identity 與 `completed`／`needs_decision`／`needs_discovery` outcome。completed 時由 runtime 鎖定所有實際 inherited 與 accepted supplemental evidence，模型不可任選並轉入 Knowledge Understanding；其他 outcome 交由 `handleDeepResult`。
- `forge_deep_complete` 接收 attempt identity 與同一 outcome union。completed 僅允許模型提交 decisions、findings、limitations；runtime 注入 locked evidence、建立並驗證 Evidence Package，驗證成功才轉 `CONTEXT_BUILD`，invalid 不轉移；其他 outcome 交由 `handleDeepResult`。
- Retrieval 階段只啟用 search 與 retrieval-complete；Understanding 階段只啟用 deep-complete。完成、轉 decision／discovery 或 cancel 後恢復原 active tools；若無法安全限制 active tools，拒絕啟動 Deep。
- 技術失敗不屬正常 outcome，走 cancel／no-op 並保留 input／evidence；stale 安靜忽略。Integration 採現有 `forge-runtime-extension.test.ts` 的輕量 `registeredTools` harness，不啟動完整 TUI，作為核准的最小測試接縫。

### 2026-08-26 Deep 階段輸出契約增補

- Deep Retrieval 與 Knowledge Understanding 的責任，是為後續實作準備、整理及驗證證據；兩階段本身不開始實作，也不輸出 RTL、程式碼或其他 implementation artifact。
- Runtime guard 僅在有 active Deep attempt 且 stage 為 `DEEP_KNOWLEDGE_RETRIEVAL` 或 `KNOWLEDGE_UNDERSTANDING` 時成立。`message_update` 與 `message_end` 移除 assistant `text`／`thinking`，保留合法 `toolCall`。
- Guard 不沿用 Grill recovery，且不影響 `WAIT_USER`、Deep cancel 後與後續階段；Deep active tool 清單維持排除 write/edit 類工具。Guard 已完成實作；真正的 RTL／程式碼實作仍須等待後續正式 gate。

### 2026-08-26 Deep 階段輸出守門實作與驗證

- 根因：`forge-runtime/extensions/forge-runtime.ts` 的 assistant prose guard 只覆蓋 Grill；進入 active Deep 後只更換 active tools，沒有在 `message_update` 與 `message_end` 同時攔截 `text`／`thinking`。
- 修正：新增 `hasActiveDeepAttempt`。Deep Retrieval／Knowledge Understanding active attempt 時，串流清空 assistant `text`／`thinking`，final message 只保留合法 `toolCall`；不修改 `pi-main/`。
- 測試先由 `PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue` 以 `FORBIDDEN_IMPLEMENTATION_MARKER` 確認紅燈（exit 1）；修正後 targeted 9/9。另修正 retrieval／understanding fixture schema 與一個過時 transition assertion；完整 `npm test` 為 209 passed/0 failed/0 skipped，`npm run check` exit 0。
- production diff review 零 functional findings，scope on target。Grill `message_end` 含 toolCall 分支仍依賴 `message_update` 先清文字，屬未證實後續風險，不在本 ticket 擴修。

## 與 ADR-0015 的關係

本 ADR 明確擴充 ADR-0015 當時刻意排除的 full semantic Deep 與 Deep result type。ADR-0015 的下列邊界仍然有效：Deep 不直接向使用者提問；任何尚未解決的新取捨、需求或矛盾都必須由 Workflow → `WAIT_USER` → Grill 取得人類決策；Evidence snapshot 不可被回寫；relevance failure 仍回 Light Discovery。跨 snapshot 保留 evidence 的唯一例外，是 [`ADR-0021`](ADR-0021-deep-discovery-fallback-human-premise.md) 定義的 workflow-local fallback evidence accumulator：它複製實際已驗證的 Evidence 內容並以 `evidenceId` 去重，不沿用已失效的 snapshot-local fetched IDs，也不污染一般 Grill snapshot。第二次資料不足的固定 fallback 問題若已由 Workflow 提出，且使用者以整句同意／確認完成該人類決策，便沒有未解取捨，可依 ADR-0021 由 `USER_CONFIRMED` 進入 `KNOWLEDGE_UNDERSTANDING`；若 Understanding 後出現新的取捨或矛盾，仍回一般 `WAIT_USER` → Grill。

## Consequences

- Deep 有清楚的 retrieval／understanding 封口，理解階段不會一邊下結論一邊改證據。
- 每項 finding 與決策都可追溯到 package 內的 Evidence ID，且 Grill 的原始 snapshot 保持可核對。
- 主 session active model 的限制仍存在；模型替換、fallback 與第二 verifier 必須另開設計。
- Deep 的補查範圍受限，target source 缺少明確檔案時會停下來等待決策，而不是猜測路徑。

## Rejected alternatives

- 不讓 Deep 重新讀取相同 Grill evidence，避免重複查證與 snapshot 污染。
- 不讓 Deep 直接詢問使用者，避免繞過 Workflow 的人類決策入口。
- 不引入 `ForgeLlmRunner`、派發 policy 或 custom tool loop；使用者已撤回此設計以控制複雜度。
- 不把 Context／ADR／SPEC／Ticket 生成塞進 Deep；這些是後續 Context Builder 與規劃階段責任。
- 不把 Pattern Card、持久化或第二 verifier 放入本 ticket；目前沒有必要的驗收契約。

## 2026-08-28 Attempt 決策順序補充

- 每個 active Deep attempt 最多接受一個 `needs_decision`。接受後 Workflow 建立 `WAIT_USER`、清除該 attempt；同 identity 的後續 completion 必須 stale、不得改 state，並以 `terminate: true` 結束當前 agent-loop 循環。
- 使用者回答只保留原 `sourceRoundId` 與 `phase`，建立新的 `attemptId`；新的 attempt 可再次產生並接受一個 `needs_decision`。因此「第一次有效」只適用於同一 attempt，不限制後續 fresh attempts。
- 本補充只規範 attempt／decision 順序；`CONTEXT_BUILD` 的啟動仍是另一個未實作範圍。

## Evidence

## 實作與驗證收尾（2026-08-25）

本 ADR 已完成實作。Runtime 提供兩個 Grill tools 與三個 Deep tools；Deep identity 為 `attemptId + sourceRoundId + phase`。retry 只換 attempt 並回原 Deep phase，cancel 保留 input／evidence，`continue` 回原 Deep phase，不回 Grill；stale outcome 一律 quiet reject，active-tools capability 無法確認時 fail-closed。

人類決策以 `問題：…；決定：…` 保存，同一 decisionId 首筆不可覆寫；Evidence Package 先注入人類決策，模型 duplicate decisionId 會拒絕。Package validator 保證 ID 唯一、finding 引用存在，blocking limitation 不得完成，且 Deep 不重讀已 fetched 的 Grill evidence。

固定安全上限為 query 1500 Unicode code points、同 source／Grill round 8 次搜尋（retry／cancel 不重設）、單筆 256 KiB、整輪 2 MiB（Grill fetched 加 Deep supplemental）、decisions／findings／limitations 各 50、每段 statement 4,000 Unicode code points。讀檔前先 stat，恰好上限可讀；任何超限在 state 寫入前拒絕且不改目前 state。

驗證證據：初次 Deep 實作 `npm test` 208/208；identity handoff follow-up 完成後完整 209/209、`npm run check` exit 0。後續證據：`.tmp/deep-full-green-20260825.log`、`.tmp/deep-caller-check-20260825.log`、`.tmp/deep-related-green-20260825.log`；初次實作 logs 保留於 `C:\Users\User\AppData\Local\Temp\forge-full-final3.log`、`C:\Users\User\AppData\Local\Temp\forge-check-final3.log`。

- `ADR-0015-grill-deep-knowledge-handoff-boundary.md`：snapshot 交接、人類決策與 Deep 不直接回 Grill 的邊界。
- `FORGE_RUNTIME_Arch_v4.md`：Workflow 主權與人類決策邊界。
- `CONTEXT.md`：2026-08-24 核准的 Deep 兩階段與 Evidence Package 設計。
- `docs/PLAN-A.md`：本 ticket 的建置範圍、測試矩陣與驗證命令。
- 使用者於 2026-08-24 逐項確認 Q1 至 Q21；模型派發構想後續明確撤回，改採主 session active model。

### 首次 Grill→Deep identity handoff 修正（2026-08-25）

- 首次 READY→Deep 建立 active identity 後，已沿用 decision-retry 的 `pi.sendUserMessage(..., { deliverAs: "followUp" })` transport，送出含 `attemptId`、`sourceRoundId`、`phase` 的 identity-bearing invocation。
- `forge-runtime/extensions/forge-runtime.ts` 的三個 caller 以 closure-local setter 傳遞 `pendingReplayInvocation`；`continueDeepKnowledge` 建立 attempt 後先設定 marker，再送出 followUp。
- identity 不塞入 tool details；Deep tools 不自行取得 identity；不修改 stale guard、tool schema、`pi-main/`，不加入 sequential 設定。public seam 仍是現有 `registeredTools`／harness。
- 驗證證據：handoff regression 114 pass/1 fail（handoff undefined）後 green 115/0；聚焦 4/4；相關 147/147（`.tmp/deep-related-green-20260825.log`）；完整 209/209（`.tmp/deep-full-green-20260825.log`）；`npm run check` exit 0（`.tmp/deep-caller-check-20260825.log`）；final quick review 0 functional findings。
- 尚未由使用者在真實 PI session 重跑原始情境；此項不是 blocker。沒有 UI 工作，因此不建立 Plan B。

### 最後驗證與工作樹狀態（2026-08-25）

- 工作期間 HEAD 由外部移至並同步 `origin/main` 的 `324501a0412bbfdead9642aeb845bb26192b57cc`，不是本代理 commit；目前本 ticket 剩九檔 tracked 修改未提交。
- 隔離 detached worktree 只套用九檔 diff 後，`npm run check` exit 0，四個關鍵測試均 4/4 exit 0；logs：`forge-runtime/.tmp/deep-isolated4-check-20260825.log`、`forge-runtime/.tmp/deep-isolated4-targeted-20260825.log`。主工作樹 full 仍 209/209。
- 未解仍只有使用者尚未在真實 PI session 重跑原始情境；沒有 blocker。

### Stale-result loop 同步（2026-08-27）

- 本次只修正 stale completion 反覆循環，不改 Deep 的 semantic contract、identity 三元組、Evidence Package、合法後續或人類決策邊界。
- 只有初始 Deep stage panel 使用 `displayOnly`；input 僅預載工具，matching user `message_start` 才消費 pending identity；pending 期間 Deep tool_call fail-closed。這是 delivery／時序邊界修正，不是 semantic flow 變更。
- 自動化驗證：正式 RED 1 fail、GREEN 1 pass；extension 117/117、PI integration 10/10、完整 `npm test` 212/212、`npm run check` exit 0。
- 真實 PI v0.83.0 已從 repo root 以 `.\\pi-main\\pi-test.bat --approve` 啟動，啟動畫面列出 `forge-runtime.ts`；尚未捕捉原始 stale 情境輸入／結果，人工情境驗收仍未完成。

### Deep completion stale termination 同步（2026-08-28）

- Plan A 已核准並完成：兩個 Deep completion 工具六個 stale return 均回傳 `terminate: true`；不改 semantic contract、state machine 或合法後續。
- 兩個 public fresh-attempt regression 先紅 `terminate undefined` 後綠；四個 inner branch 因無公開 deterministic seam，不新增私有 mock／test hook。
- 驗證：focused 124/124、full 219/219、`npm run check` pass。logs：`forge-runtime/.tmp/final-focused-test.log`、`forge-runtime/.tmp/final-full-test.log`、`forge-runtime/.tmp/final-check.log`。PI smoke：`\.\pi-main\pi-test.bat --approve` 成功啟動，真實模型回 `smoke ok`、exit 0；log：`forge-runtime/.tmp/pi-smoke.log`。
- 未修改 `session-state.ts`、scheduler、UI、schema/API、`pi-main/`；mixed tool batch 的 `every(terminate)` 風險不在 scope。
