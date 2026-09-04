---
title: Forge Runtime v4 Plan A
type: implementation-plan
scope: Forge Runtime v4 設計、實作、驗證與交接
updated: 2026-09-05
source: FORGE_RUNTIME_Arch_v4.md、CONTEXT.md、docs/adr、docs/handoff.md
status: implemented-completed-check-blocked
---

# Plan A：Intent Route-Only LLM（本段歷史 ticket）

日期：2026-08-21

本段狀態：Approved；`deep-completion-stale-termination-20260828` 狀態為 `implemented-verified-reviewed`。

各 ticket 狀態以各自章節為準；Grill→Deep 與 2026-08-24 的 Deep Knowledge ticket 均已完成，`deep-completion-stale-termination-20260828` 狀態為 `implemented-verified-reviewed`；identity handoff follow-up 最終驗證為完整 209/209、`npm run check` exit 0。

本文件下方的 Grill Completion Recovery 內容是已完成的歷史 Plan A 基線，不屬本 ticket 的執行範圍。

## Scope

只修改使用者輸入到 Intent Understanding 的路由邊界：workflow guard 先處理 WAIT_USER、open workflow 與 slash control；idle 自然語句交由 LLM 分成 `passthrough` 或 `start_forge`。不改 Light Discovery production／內部測試、Grill、Deep Knowledge 或 `pi-main/`。

## Contract

- 輸入：現有 workflow context 的原始 `userMessage` 與官方 `ctx.model`／`ctx.modelRegistry.complete()`。
- 輸出：TypeBox 驗證後只能是 `{ "route": "passthrough" | "start_forge" }`。
- `passthrough`：明確聊天、翻譯、改寫、一次性資訊查詢或非工程任務。
- `start_forge`：工程請求、不確定輸入，以及 missing model、completion error、timeout、abort、invalid JSON、invalid schema。
- 原始 `userMessage` 保留在 workflow context；goal 從原始有效文字取得，其他衍生欄位不由 Intent 輸出；seed fixed-point helper 留在 extension handoff private helper。
- `IntentModelContext` 是 `understandIntent` 的唯一第二參數 model seam，供 runtime 與測試注入 PI `model`／`modelRegistry`；`IntentInput` 不含 model context。
- prompt isolation：路由規則只在 `systemPrompt`；raw input 以獨立 `user` message 傳入。加入 injection structure regression，確認 raw input 不能改寫 system prompt 或訊息角色結構。
- timeout 固定 10 秒；`/grill-run` 由 guard 直接進 `start_forge`；本 ticket 不新增永久 audit log。

## Exact files

| 檔案 | 變動 |
| --- | --- |
| `forge-runtime/src/intent/intent-types.ts` | 將 Intent input/output 收斂為 route-only contract，保留原始輸入 context 所需型別。 |
| `forge-runtime/src/intent/intent-understanding.ts` | 加入 LLM completion、10 秒 timeout、JSON.parse、TypeBox 驗證與 fail-closed fallback；移除本層 task/goal/seed 推導。 |
| `forge-runtime/extensions/forge-runtime.ts` | 在 Intent 前套用既有 workflow guard，消費 route 並從原始文字建立 start_forge 所需最小資料。 |
| `forge-runtime/tests/intent/intent-understanding.test.ts` | 覆蓋兩種 route、嚴格 schema、錯誤 fallback、guard bypass 與原始輸入保留。 |
| `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | 公開 seed characterization test、raw input 與 `/grill-run` handoff regression。 |
| `forge-runtime/tests/extensions/pi-extension-loader.test.ts` | 修正 loader smoke，使其只驗證 extension load，不混入無關 LLM prompt。 |
| `forge-runtime/tests/extensions/pi-grill-interactive.test.ts` | 調整 faux provider queue 與 route call-count，覆蓋 router completion 後 Grill 呼叫序列及 prompt isolation regression。 |
| `forge-runtime/src/intent/resume-check.ts` | 刪除；session resume guard 已移到 extension／共用 model 前置流程，避免舊五欄位 Intent contract 殘留。 |

不新增 dependency，不修改 `pi-main/`；Light Discovery production 與內部測試不在本 ticket scope。

## Test matrix

| 案例 | 預期 |
| --- | --- |
| 明確聊天／翻譯／改寫／一次性資訊／非工程查詢 | `passthrough` |
| 明確工程請求 | `start_forge` |
| 不確定自然語句 | `start_forge` |
| valid JSON 且只有 route 欄位 | 接受該 route |
| 多欄位、缺欄位、錯 route、非 JSON | `start_forge` |
| missing model、completion error、timeout、abort | `start_forge` |
| WAIT_USER、open workflow、slash control | 不呼叫 LLM，由 guard 決定；`/grill-run` 為 `start_forge` |
| start_forge | 原始 `userMessage` 完整保留；goal 由原始文字取得，seed 由 extension handoff private helper 準備，不由 Intent contract 提供 |

## Execution order

1. 先補 route-only 型別與 focused tests，確認舊五欄位 caller 的失敗位置。
2. 實作 LLM route、schema validation、timeout 與 fallback。
3. 接回 workflow guard 與 router，確認下游只消費兩種 route，並固定 faux provider queue／route call-count。
4. 執行 focused tests、package check，再由獨立 review 確認無 Light Discovery／下游 scope 漂移。

## Rollback

若驗證未通過，回退本 ticket 的四個 implementation/test 檔與本 Plan 的現行區塊，保留 `ADR-0013`、`CONTEXT.md` 的決策歷史；不得恢復五欄位為新的現行 contract，需先取得使用者重新決策。

---

# Plan A：Light Discovery 檔名與 metadata 模組

日期：2026-08-22

工作項目：`light-discovery-file-metadata-20260822`

狀態：本 ticket 實作、驗證、雙軸審查與文件收尾均完成。已依使用者於 2026-08-22 核准的 v4 分階段交付例外完成第一階段。

## Scope

- 接收 Intent 的 `start_forge` 後，由 workflow 將 workspace/root 與原始 `userMessage` 傳入 Light Discovery 唯一 public seam。
- 以 Input normalization → deterministic Core → Output normalization 三段模組責任搜尋 root `wiki/`、`code_base/`。
- 依檔名、相對路徑與穩定 metadata 找候選；每個來源最多 3 筆且固定排序。
- 回傳 `matches` 與 warnings/source availability 狀態；移入既有 extension 私有 seed extraction，caller 只傳 raw message。
- 保留外部 Grill 相容 adapter 的 full-content/snapshot 行為，不改 Grill／Deep Knowledge 決策。

## Non-scope

- 不改 Intent route-only contract。
- 不搜尋 target source、`docs/`、`Memory/`、`pi-main/` 或 OS。
- 不做全文內容、語意向量、summary、Pattern Card、Grill snapshot 或人類決策。
- 不新增 YAML/frontmatter metadata 規範、dependency、class、factory、plugin registry。
- 不修改 Grilling、Deep Knowledge 或 WAIT_USER 決策規則。

## Exact candidate files

| 檔案 | 預定變動 |
| --- | --- |
| `forge-runtime/src/discovery/light-discovery.ts` | 同一檔案內定義 input/output types，建立單一 public seam，實作 input/core/output 三段流程與 deterministic 檔名／metadata discovery。 |
| `forge-runtime/extensions/forge-runtime.ts` | 只保留 caller 傳入 raw `userMessage`，移除並交接既有私有 seed extraction；接回外部 Grill adapter。 |
| `forge-runtime/tests/discovery/light-discovery.test.ts` | focused unit tests：normalization、固定排序、每來源上限、metadata、partial failure。 |
| `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | integration/regression：`start_forge` 呼叫 seam、raw message、Grill 相容 adapter 與既有流程不變。 |

若實際程式結構顯示候選檔案不適用，須先更新本 Plan 與 ADR，再進入實作；不得默默擴大範圍。

## TDD execution order

1. 建立 focused RED：public seam input/output、兩來源候選、固定排序與每來源 3 筆上限。
2. 補 RED：metadata 欄位、缺來源、單一檔案／來源失敗的 partial result 與 warning、禁止全文內容輸出。
3. 補 RED：extension `start_forge` integration、raw message passthrough、Grill adapter regression。
4. 以最小模組實作 Input normalization → deterministic Core → Output normalization，使 focused tests GREEN。
5. 執行 focused tests、package check，再執行完整 suite；所有驗證由獨立代理執行。
6. 由不同代理完成 Standards／Spec review；若有 findings，先修正再重跑受影響驗證。

## Test matrix

| 類型 | 驗收 |
| --- | --- |
| happy path | raw message 產生兩來源候選，metadata 欄位完整且排序穩定。 |
| source limit | 每來源最多 3 筆，超出部分依固定排序截斷。 |
| deterministic | 相同 input 與 filesystem state 兩次結果完全相同。 |
| missing source | `wiki/` 或 `code_base/` 缺失時，輸出 source availability／warning，不搜尋邊界外路徑。 |
| partial failure | 單一檔案或來源失敗時保留其他 matches 並回傳 warning。 |
| output boundary | output 不含完整內容、summary、Pattern Card、snapshot 或決策。 |
| integration | `start_forge` 只傳 raw message；Grill 仍由外部 adapter 取得既有 full-content/snapshot。 |
| edge | 空白輸入、特殊字元、重複檔名、無 metadata、非支援副檔名與不可讀項目不破壞 deterministic contract。 |

## Rollback

回退本 ticket 的 Light Discovery implementation/test 變更與本 Plan 新增區塊，保留 `ADR-0014` 與 `CONTEXT.md` 的設計歷史；恢復 caller 至既有流程時不得重新引入 Intent 衍生欄位，也不得修改 `pi-main/`。

---

# Plan A 歷史基線：Grill Completion Recovery 與真實互動驗收

日期：2026-08-13（2026-08-17 新增 active follow-up）

狀態：原 Plan #1 至 #17、既有增補與 2026-08-17「Grill 呼叫傳輸完整性」follow-up 的 implementation、validation、final review 與 acceptance／closure 均已完成（2026-08-18）。舊完成紀錄保留，不重開 #1 至 #17。

Prerequisite

- ADR-0008 已 Accepted，並 supersede ADR-0007 的 completion omission `continue` replay 規範。
- 既有 loader compatibility 工作已完成；`npm test` 99/99 與 `npm run check` 只是本計畫開始前的 baseline。
- 先由獨立測試子代理建立紅燈；主代理確認紅燈後，才可交給獨立實作角色修改 production code。

---

## Building

- 為每個 Grill attempt 記錄首次 completion omission 與 recovery marker；同一 attempt 最多進 recovery 一次。
- omission 後立即進 `GRILL + RECOVERY_REQUIRED`，顯示 retry／cancel／switch 並 settled；`message_end` 不 steer、不自動 replay、不自動 Deep。
- 新增明確 `/forge-runtime retry`，只由使用者觸發同 round／snapshot 的新 attempt；`continue` 不再處理 omission recovery。
- 讓 `NEEDS_CONFIRMATION` 立即顯示問題並進 `WAIT_USER`，回答後自動下一 Grill round；`READY_FOR_DEEP` 立即自動 Deep。
- 所有可見 panel 固定回傳 `content: panelText`、`display: true`。
- 更新 Grill prompt：不得輸出 assistant prose；需要確認時由 `forge_grill_complete.questions` 提交恰好一題。
- 空 manifest 可用零 evidence 提交來源／scope 問題；relevance gate 失敗顯示可回答問題並進 `WAIT_USER`。
- 以真實 PI TUI 驗收正常多輪、READY 自動推進、有界 recovery 與 assistant-turn 上限。
- 為真 PI TUI 建立最小 test-only seam：`InteractiveModeOptions` 新增 optional `terminal?: Terminal`，constructor 轉交既有 `createInteractiveTui`；省略時維持 factory 建立 `ProcessTerminal`。

## Not Building

- 不修改 `pi-main/` runtime workflow、其他功能或依賴；僅做核准的 test-only terminal seam，不新增 top-level workflow stage 或第三種 completion status。
- 不做自動 retry、background steer、retry backoff、queue 或 parallel workflow。
- 不重做 PI TUI、不實作固定 widget tree；只修正既有 panel／互動 lifecycle。
- 不改 Deep Knowledge 內容、candidate scoring 或知識來源邊界。
- 不把同一修復拆成另一份需要核准的 UI 計畫。

---

## Approach

### Gap 1：有界 attempt 與 explicit recovery

在既有 session round 狀態上加入最小 attempt／omission marker。首個 completion omission 原子地標記 recovery；相同 attempt 後續 terminal event no-op。`RECOVERY_REQUIRED` 只存在於 `GRILL` 內，不加入 state-machine top-level enum。recovery panel 發出後不安排 follow-up，確保 session settled。

使用者於 2026-08-13 已確認 interface：`ForgeSessionState` 以私有 attempt 狀態維護 omission budget；公開 `recordCompletionOmission(): boolean` 僅首次記錄並進 recovery 時回傳 `true`，重複事件回傳 `false` 且 no-op。`retryGrillRound(): GrillRound | undefined` 只在 recovery 中可用，保留 roundId、request 與 immutable snapshot 並重置 omission budget。`GrillRound` 不公開 attemptId 或 omission marker；retry 後新 attempt 的首次 omission 可再次回傳 `true`。這個小 interface 旨在維持 deep module，避免測試耦合私有狀態；private attempt interface 已於本 session 實作，#1 至 #3 targeted tests GREEN，但完整驗證仍未跑。

`/forge-runtime retry` 驗證目前確為 recovery，再重用既有 round、snapshot、decision summary 與 evidence cache 建立新 attempt；新 attempt 有新的 omission budget。`continue` 在 recovery 中不 replay。

### Gap 2：正常 completion 與可見輸出

`NEEDS_CONFIRMATION` completion 在同一操作中以 `{ content: panelText, display: true }` 顯示唯一問題並轉 `WAIT_USER`；使用者回答沿既有 resume path 自動建立下一 round。`READY_FOR_DEEP` 通過 relevance gate 後直接執行既有 deep transition，不等待 command。

Grill invocation 移除「只輸出一個問題」，改為 completion-tool-only：需要確認時 `questions` 恰好一題，`READY_FOR_DEEP` 零題，兩者都不得輸出 assistant prose。

### Gap 3：Discovery completion guard

將首輪 evidence invariant 限定於 manifest 非空。空 manifest 允許零 evidence 的單一來源／scope 問題。relevance gate 失敗不再只 notify 錯誤；它建立可回答的來源／scope decision，顯示 panel 並進 `WAIT_USER`。

### Gap 4：真實 PI TUI 驗收

保留 unit／fake extension harness 作快速回歸，但完成 gate 必須另走真 PI TUI／extension lifecycle：觀察問題、回答、下一 round、READY 自動 Deep、omission recovery settled 與單次輸入的 assistant-turn 上限。

Fragile assumption：真實 PI TUI 驗收環境能提供可控的 completion／omission 回應。若 provider 不穩定，先建立受控但仍通過真 PI TUI 與 Forge extension lifecycle 的模型回應 seam；fake harness 不可替代最終互動驗收。

真實 TUI direct verification 必須使用 `--test-force-exit`：`InteractiveMode.run` 是 production 永久 loop，測試在 assertions／cleanup 完成後才強制結束 isolated process；這不代表新增 runtime abort seam。

Plan #14 seam assumption：只注入 `Terminal`，不注入 TUI factory；省略 `terminal` 時仍由 `createInteractiveTui` 建立 `ProcessTerminal`。此 seam 僅供 test-only 真 PI TUI 驗收，不改 runtime workflow 語意、不新增依賴、不改 pi-main 其他功能。

---

## Files

| 檔案 | 變動 |
| --- | --- |
| `forge-runtime/extensions/forge-runtime.ts` | attempt recovery、retry command、正常自動轉移、可見 panel、relevance failure routing |
| `forge-runtime/src/runtime/session-state.ts` | attempt／omission／recovery marker 與 bounded retry |
| `forge-runtime/src/grill/grill-result.ts` | 空 manifest 的 evidence completion guard |
| `forge-runtime/src/grill/grill-skill.ts` | completion-tool-only prompt 與 question contract |
| `forge-runtime/tests/runtime/session-state.test.ts` | attempt 與 retry state tests |
| `forge-runtime/tests/grill/grill-result.test.ts` | 空 manifest completion test |
| `forge-runtime/tests/grill/grill-skill.test.ts` | prompt contract test |
| `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | omission、panel、自動轉移、relevance failure integration tests |
| `forge-runtime/tests/extensions/pi-grill-interactive.test.ts` | NEW：真實 PI TUI 互動 acceptance |
| `forge-runtime/tsconfig.pi-interactive.json` | 真實 PI TUI test-only source paths 的核准 seam 設定 |
| `forge-runtime/package.json` | 確認 `test` runner 使用 `tsx --test --test-force-exit`，避免互動測試的 production loop 錯誤阻塞結束 |
| `pi-main/packages/coding-agent/src/modes/interactive-mode.ts` | #14：新增 optional `terminal` test-only seam，轉交既有 TUI factory |
| `FORGE_RUNTIME_Arch_v4.md`、`CONTEXT.md`、`docs/adr/ADR-0003` 至 `ADR-0008` | 已核准 contract 與 supersede 關係 |
| `docs/PLAN-A.md`、`docs/PLAN-B.md`、`docs/handoff.md`、`agent-state/*.md` | 計畫、互動驗收與 durable state |

production／test 預計 9 個檔案（1 新增、8 修改）；durable docs 依本次核准清單同步。

## Tests

| 測試 | 驗收條件 |
|---|---|
| `Extension_WhenCustomWaitUserFactoryRuns_ShouldRenderAndSubmitTrimmedAnswer` | fake custom 真正執行四參數 factory；Editor 可 render，Enter 送出 trim 後答案 |
| `Extension_WhenCustomWaitUserFactoryReceivesBlankThenEscape_ShouldReturnToSelectorWithoutDecision` | blank Enter 不完成，Escape 返回 selector，不新增 decision／round |
| `Extension_WhenWaitUserOptionCannotResume_ShouldKeepWaitUserAndCloseSelector` | 無 follow-up bridge 時普通選項只開一次 selector，維持 `WAIT_USER` 且不送出 user message |

| 測試 | 驗收條件 |
| --- | --- |
| `SessionState_WhenCompletionOmissionFirstOccurs_ShouldEnterRecoveryOnce` | 首次 omission 記錄一次並設定 recovery |
| `SessionState_WhenSameAttemptOmissionRepeats_ShouldRemainSingleRecovery` | 同 attempt 重複事件不新增 recovery |
| `SessionState_WhenExplicitRetryRequested_ShouldRetainRoundAndSnapshotAndStartNewAttempt` | retry 建立新 attempt 但保留 round／snapshot |
| `Extension_WhenCompletionOmissionOccurs_ShouldShowRetryCancelSwitchAndSettle` | 顯示三個 action，且沒有待送 follow-up |
| `Extension_WhenStreamingMessageEndsWithoutCompletion_ShouldNotSteerOrAutoReplay` | `message_end` 不呼叫 steer／replay |
| `Extension_WhenContinueRequestedDuringRecovery_ShouldNotReplayAttempt` | recovery 中 continue 不重播 |
| `Extension_WhenCompletionNeedsConfirmation_ShouldDisplayQuestionAndEnterWaitUser` | 問題可見並進 `WAIT_USER` |
| `Extension_WhenUserAnswersQuestion_ShouldAutomaticallyStartNextGrillRound` | 回答後不需 continue 即開下一 round |
| `Extension_WhenCompletionReadyForDeep_ShouldAutomaticallyEnterDeepKnowledge` | READY 不需 continue 即進 Deep |
| `Extension_WhenPanelIsEmitted_ShouldUseVisibleContentContract` | panel 為 `content: panelText`、`display: true` |
| `GrillSkill_WhenInvocationBuilt_ShouldRequireCompletionToolWithoutAssistantProse` | prompt 無「只輸出一個問題」，只允許 completion tool contract |
| `GrillCompletion_WhenManifestIsEmpty_ShouldAllowSingleScopeQuestionWithoutEvidence` | 空 manifest 的單一 scope 問題可零 evidence 完成 |
| `Extension_WhenRelevanceGateFails_ShouldDisplayScopeQuestionAndEnterWaitUser` | gate failure 顯示可回答問題並進 WAIT_USER |
| `PiTui_WhenNeedsConfirmationCompletes_ShouldShowQuestionAndAdvanceAfterAnswer` | 真 PI TUI 問題可見且回答後下一 round |
| `PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue` | 真 PI TUI 自動 Deep |
| `PiTui_WhenCompletionIsOmitted_ShouldRecoverOnceAndSettle` | 真 PI TUI 每 attempt recovery 一次且 settled |
| `PiTui_WhenSingleInputRuns_ShouldBoundAssistantTurns` | 單次輸入沒有無上限 assistant turns |

新增 17 條測試；`116` 是原始預估目標，不是硬 gate 或目前實測總數。刪除 ADR-0007 stale test 後，淨測試數會變動。

## 本 session 進度（2026-08-14）

- #1 至 #17 individual tests 已完成並 GREEN；使用者選擇方案 A 並核准 #14 的 test-only seam，#14 已 GREEN。
- focused batch、完整 suite、typecheck、真 PI TUI 與 review 已完成；Plan A acceptance 已完成。
- production 修改集中於 `forge-runtime/src/runtime/session-state.ts` 與 `forge-runtime/extensions/forge-runtime.ts`；測試 #7 已使用上方新名稱，ADR-0007 stale test 已刪除。

| 編號 | 狀態 |
| --- | --- |
| #1 至 #17 individual tests | completed / GREEN |
| #14 `PiTui_WhenNeedsConfirmationCompletes_ShouldShowQuestionAndAdvanceAfterAnswer` | approved seam / GREEN |
| focused batch、完整 suite、typecheck、review | completed / GREEN |

### Final review 與驗證收尾

- Standards review 曾發現 P1：非 active Grill attempt 的兩工具未 fail-closed；已以 `pendingGrillRun && stage===GRILL` 共同 gate 加上 execute guard 修正。
- Spec review 發現兩個驗收缺口並已補齊：正常 TUI 明確排除 `continue`；omission 靜置不自動 retry，輸入 `/forge-runtime retry` 才建立下一 attempt。
- `forge-runtime/tsconfig.pi-interactive.check.json` 已加入 Plan A 文件邊界；upstream 測試路徑修正為 `pi-main/packages/coding-agent/test/interactive-tui.test.ts`。
- runner 因 full-suite 並行造成 loader 30s timeout，`package.json` test 最小修正為 `--test-concurrency=1`，未放寬 timeout。
- 證據：P1 1/1 exit 0（`agent-state/plan-a-review-p1-green.log`）；TUI 4/4 exit 0（`agent-state/plan-a-review-tui-green.log`）；`npm run check` exit 0（`agent-state/plan-a-final-check.log`）；`npm test` 114/114 exit 0（`agent-state/plan-a-final-suite-after-review.log`）。upstream seam Vitest 4/4；upstream check 僅剩既有 `packages/ai` 測試型別錯誤。

## Execution Order

1. 獨立測試子代理先新增最小 session-state 與 extension omission tests，執行 focused batch，確認第一個紅燈並回報 failing test 與原因。
2. 確認紅燈後，獨立實作角色才加入 attempt／recovery marker、`retry` 與 no-steer terminal handling；驗證子代理重跑 focused tests。
3. 測試子代理再加入正常自動轉移、visible panel、prompt 與 discovery guard 的紅燈；實作角色逐 slice 做最小修正。
4. 測試子代理加入真實 PI TUI acceptance；先證明至少一個舊行為紅燈，再補齊必要 integration seam。
5. 獨立驗證角色執行 focused tests、完整 suite、type check 與真實 PI TUI acceptance。
6. 獨立 review 角色依 ADR-0008、Plan A 與真實互動證據審查；全部通過後才更新完成狀態與 handoff。

## Verification

```text
# 僅由獨立驗證子代理執行，從 repo root
cd forge-runtime && npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-name-pattern='^PiTui_WhenNeedsConfirmationCompletes_ShouldShowQuestionAndAdvanceAfterAnswer$' tests/extensions/pi-grill-interactive.test.ts
cd forge-runtime && npx tsx --test tests/runtime/session-state.test.ts tests/grill/grill-result.test.ts tests/grill/grill-skill.test.ts tests/extensions/forge-runtime-extension.test.ts
cd forge-runtime && npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit tests/extensions/pi-grill-interactive.test.ts
cd forge-runtime && npm test
cd forge-runtime && npm run check

# 驗證結果：focused batch、完整 suite、type check 與真 PI TUI 均已完成；116 僅為原始預估，不是硬 gate。
# #14 至 #17 與 final review 均已 GREEN；Plan A acceptance 已完成。
# 真實 PI TUI：問題可見、回答後下一 round、READY 自動 Deep、每 attempt omission recovery 一次且 settled、單次輸入 assistant turns 有界。
```

---

## 2026-08-15 增補 Plan A：WAIT_USER 選項語意契約（Completed）

本增補不重開已完成的 Plan A #1 至 #17；只先補上 Plan B 固定自由輸入入口所依賴的最小 prompt contract。

### Building

- 規定 `questions[].options` 只能包含可直接記錄為 decision 的完整答案。
- 禁止把「請輸入／請提供……」等操作指示放入 options；自由文字由 `WAIT_USER` 的系統「自行輸入…」入口負責。

### Not Building

- 不加入選項文案 heuristic 或語意 parser。
- 不修改 grill result schema、workflow stage、completion status 或 `pi-main/`。

### Approach

只在 `buildGrillingSkillInvocation` 既有 options 規則旁補一條明確約束；結構驗證仍維持既有 string array contract。這避免 UI 猜文案，也避免為單一互動新增 schema。

Fragile assumption：prompt 約束能大幅減少操作指示型 options，但不提供機器層語意證明；固定「自行輸入…」仍是使用者可逃離錯誤候選的 UI 邊界。

### Files

| 檔案 | 變動 |
| --- | --- |
| `forge-runtime/src/grill/grill-skill.ts` | 補上 options 必須是完整答案的 prompt contract |
| `forge-runtime/tests/grill/grill-skill.test.ts` | 新增兩個 prompt contract tests |

共 2 個檔案（0 新增 + 2 修改）。

### Tests

| 測試 | 驗收條件 |
| --- | --- |
| `BuildGrillingSkillInvocation_WhenOptionsAreRequested_ShouldRequireCompleteRecordableAnswers` | invocation 明確要求 options 可直接記錄為 decision |
| `BuildGrillingSkillInvocation_WhenFreeTextIsAvailable_ShouldForbidInputInstructionOptions` | invocation 禁止操作指示型 options，並把自由輸入責任交給 WAIT_USER UI |

### Execution Order

1. 獨立測試子代理先新增上述兩個測試並執行 focused batch，確認第一個紅燈及失敗原因。
2. 確認紅燈後，獨立實作角色才修改 `grill-skill.ts` 做最小 GREEN。
3. 獨立驗證角色重跑 focused test、完整 suite 與 type check。
4. 獨立 review 角色確認沒有 schema、狀態機或 `pi-main/` 變更後，才進 Plan B。

### Execution Result

- 增補已完成並通過 focused test、完整 suite、type check 與獨立 review；未重開 Plan A #1 至 #17。
- Plan B 的 custom Editor 依賴決策已批准：Forge package 使用 `@earendil-works/pi-tui@0.83.0`，只改 Forge package，不改 `pi-main/`；後續以 RED→GREEN 進入固定「自行輸入…」slice。

### Verification

```text
# 僅由獨立驗證子代理執行，從 repo root
cd forge-runtime && npx tsx --test tests/grill/grill-skill.test.ts
cd forge-runtime && npm test
cd forge-runtime && npm run check

# 期望：既有 114 + 新增 2 = 116 passed / 0 failed；type check 通過。
```

## 2026-08-16 增補實測同步

> 歷史段落：本節的 47/44、OOM 與待 RED→GREEN 順序已由下方「最終完成狀態」取代，保留作診斷與時間線證據，不代表目前 blocker。

- prompt-contract 增補已實測完成，並保留上述當時的 focused 5/5、`npm test` 116/116、`npm run check` exit 0 與兩軸 review 0 findings 證據。
- 這不代表 Plan B 的 current 驗證完成；Plan B selector slice 只有歷史 71/71 證據，不能當作目前完整 suite。
- 四參數 custom factory、Theme adapter、冗餘 `onEscape` 移除與有效答案 resume 後結束 command 均已完成；focused regression tests 3/3、`npm run check` exit 0，final Standards／Spec review 皆 0 blocker，scope blast 無 sibling bug。
- 歷史結果：`npm test` exit 1：47 tests 中 44 pass、3 fail；約 123 秒、約 4GB heap OOM，另有 2 個 loader timeout。`selectList` formatter 尚無實際 autocomplete render coverage。
- 真實 PI TUI acceptance 與 current full suite 仍待完成；ticket 不得標記完成，舊 OOM／type-import probe 未執行。本段舊順序已由下方最終 closure 取代。

---

## 歷史 Plan A（已完成）

> 以下只保留執行歷史，不可作為下一輪規範。completion omission 的 continue replay 與空 manifest 首輪 evidence 規則均由 ADR-0008／本檔最上方的新 Plan A supersede。

# Plan A：Forge Runtime v4 Grill 工具化多輪決策迴圈

日期：2026-08-11

狀態：Completed，2026-08-13 final schema exactness 與文件語意 follow-up 完成，完整驗證 97/97 與 type check 均通過。

Prerequisite

- `docs/adr/ADR-0006-grill-readonly-candidate-verification.md` 與 `docs/adr/ADR-0007-grill-completion-tool.md` 均為 Accepted。
- `FORGE_RUNTIME_Arch_v4.md` 已同步為 `WAIT_USER → USER_CONFIRMED → GRILL* → READY_FOR_DEEP → DEEP_KNOWLEDGE`。
- 本輪無 View／widget tree 新需求；`docs/PLAN-B.md` 維持不變。

---
Building

- 把 Light Discovery 輸出凍結為不可變 `GrillEvidenceSnapshot`，以 opaque `candidateId` 提供 wiki、code_base 與存在時的 target source。
- 以 session 內 round／decision ledger 管理 `roundId`、已查核 evidence、已回答 `decisionId` 與同一 round 的 explicit replay。
- 在 Forge extension 註冊 `forge_grill_evidence(candidateId)` 與 `forge_grill_complete(payload)`；Grill 期間只暴露這兩個 tool，並以 `tool_call` deny-by-default 作硬性防線。
- 以 completion tool（而非 assistant 終局文字 JSON）推進 `WAIT_USER` 或 Deep Knowledge；完成後壓制同一 agent turn 的殘餘 prose。
- 將使用者的選項與自由回答統一記為 decision record，經 `WAIT_USER → USER_CONFIRMED → GRILL` 進入下一輪；只有 `READY_FOR_DEEP` 才進 Deep Knowledge。
- 未呼叫 completion tool 的終局回覆顯示 `GRILL_COMPLETION_REQUIRED`，直接提示 `/forge-runtime continue` 與 `/forge-runtime switch <request>`，不做自動重試。

Not Building

- 不修改 `pi-main/`，不使用 provider-specific `toolChoice` 或強制 tool call payload hack。
- 不允許 Grill 使用 `bash`、`read`、`grep`、`find`、`ls`、`edit`、`write`、網路或未知 tool。
- 不新增第三種 Grill result status、背景 steer／follow-up retry、queue、parallel workflow 或跨 session round persistence。
- 不改 Deep Knowledge candidate relevance gate、Deep executor、既有 UI widget tree 或 `docs/PLAN-B.md`。
- 不移除 `/forge-runtime grill-result` 與 `/forge-runtime grill ambiguous <json>`；兩者只保留為明確測試／除錯 injection。`/grill-run` 是歷史命令相容 alias，會正規化進 formal ingress，不另建 bypass lifecycle。

---
Approach

[Gap 1 - 不可變證據 snapshot 與多輪 decision ledger]

`LightDiscoveryResult` 目前只有摘要與 code_base candidates，不能限制 Grill 的查核範圍。擴充它以在 Light Discovery 當下建立 `GrillEvidenceSnapshot`：依固定來源順序為每筆明確引用的 wiki 文件、code_base candidate、存在時的 target source 發出 deterministic opaque `candidateId`，並保存 title、source、content 與 evidence metadata。Grill tool 只能讀這份記憶體 snapshot，不接受 path。

`ForgeSessionState` 新增最小內部 ledger：current round、已完成 round、已查核 candidate ids、已回答 decision ids、待回答 decision。`recordAnswer` 先走 `WAIT_USER → USER_CONFIRMED`，再以同一 snapshot 建立下一個 round；同一 `decisionId` 重複作答或完成一個已完成／過期 round 都拒絕。`continue` 不建立新 round，而是重播 current round 與既有 evidence cache。

`USER_CONFIRMED → GRILL` 是新合法 transition；不新增 workflow stage，也不讓 `reject` 直接手寫 UI stage。

Fragile assumption：Light Discovery 已持有產生 snapshot 所需的內容；若某一候選只保留路徑，必須在 Light Discovery 建立 snapshot 時讀取一次，而不能讓 Grill 重新開任意檔案。

[Gap 2 - 兩個 domain tool 與硬性工具邊界]

在 `forgeRuntimeExtension()` closure 中註冊兩個 official Pi custom tools，並在每個 Grill round 前以 `getActiveTools()` 保存原工具面、`setActiveTools(["forge_grill_evidence", "forge_grill_complete"])` 顯示最小工具面。離開 Grill、cancel 或 switch 時還原原工具面；`tool_call` handler 同時在 pending Grill 期間 block 一切非這兩個名稱的呼叫，因 active-tool 切換只在下一個 agent turn 生效。

`forge_grill_evidence` 只接受 `{ candidateId }`，回傳 snapshot 中對應 evidence 並登記已查核。`forge_grill_complete` 採 sequential execution，接受既有 structured result 欄位加 `roundId`；payload 只可引用已查核 ids，新 snapshot 的第一輪至少要有一筆 evidence 查核。兩個 schema 使用 Pi official `typebox` package `1.3.7`，不自行發明 JSON-schema adapter。

[Gap 3 - completion 成為唯一控制通道]

抽出 completion payload validation，重用 `parseStructuredGrillResult()` 的 status、問題、recommendation 與 evidence 檢查，另驗證 runtime-issued `roundId`、fetched evidence subset 與未回答 `decisionId`。`NEEDS_CONFIRMATION` 呼叫既有 WAIT_USER panel；`READY_FOR_DEEP` 直接走既有 `continueDeepKnowledge()`。

completion 成功時在 tool execute 內一次完成 state transition、清除 pending Grill parser 狀態、標記該 assistant turn 要 suppress，並回傳最小 tool result；不呼叫 `ctx.abort()`。`message_update`／`message_end` 只清除這個完成 turn 的殘餘 text；正常 runtime 不再 parse assistant terminal JSON。若 terminal assistant message 沒有 completion，發 `GRILL_COMPLETION_REQUIRED` 與可操作指令提示，保留 current round。

[Gap 4 - 單一路徑 resume 與既有命令相容]

建立單一 `resumeGrillWithAnswer`／round prompt helper，所有 typed answer、selector selection、`confirm`、`reject <text>` 都先產生 decision record，再回到新 Grill round。selector 將選擇值以 Pi `sendUserMessage(..., { deliverAs: "followUp" })` 送回同一 input path；內部 round invocation 以 closure guard 防止輸入 router 把它誤判成新工作流。`/forge-runtime continue` 走同一 helper，但使用 current round、不新增 decision 或 snapshot；`switch` 的 replacement 必須經正式 ingress（自然請求／asset approval），不得改走 `/grill-run` bridge。

`buildGrillingSkillInvocation()` 改為提供 task、round id、snapshot manifest、已確認 decision、兩個 domain tools 與 completion contract；移除「輸出文字 JSON」指令。`parseStructuredGrillResultMessage()` 保留給 `/forge-runtime grill-result` 測試／除錯入口。

---
Files

┌──────────────────────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────┐
│ 檔案                                                                         │ 變動                                                        │
├──────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ forge-runtime/package.json                                                   │ 加入 pinned `typebox` 1.3.7 runtime dependency               │
│ forge-runtime/package-lock.json                                              │ 鎖定 `typebox` 1.3.7                                         │
│ forge-runtime/extensions/forge-runtime.ts                                    │ custom tools、allowlist、completion／omission、resume routing │
│ forge-runtime/src/discovery/light-discovery.ts                               │ 建立 immutable GrillEvidenceSnapshot                          │
│ forge-runtime/src/grill/grill-result.ts                                      │ completion payload validation 與 round/evidence checks        │
│ forge-runtime/src/grill/grill-skill.ts                                       │ 工具化 round prompt；保留 debug parser                        │
│ forge-runtime/src/runtime/session-state.ts                                   │ round／decision／evidence ledger 與 replay                    │
│ forge-runtime/src/workflow/state-machine.ts                                 │ 允許 USER_CONFIRMED → GRILL                                   │
│ forge-runtime/tests/extensions/forge-runtime-extension.test.ts               │ custom tool、gate、completion、omission、resume integration   │
│ forge-runtime/tests/grill/grill-result.test.ts                               │ round id 與 evidence provenance validation                   │
│ forge-runtime/tests/workflow/state-machine.test.ts                           │ 多輪合法 transition                                            │
│ forge-runtime/tests/runtime/session-state.test.ts                            │ NEW：ledger、duplicate decision、replay                        │
│ FORGE_RUNTIME_Arch_v4.md                                                     │ 已更新多輪 Grill 流程                                         │
│ CONTEXT.md                                                                   │ 已記錄 accepted boundary                                      │
│ docs/adr/ADR-0006-grill-readonly-candidate-verification.md                   │ NEW：已記錄 scope／tool boundary                              │
│ docs/adr/ADR-0007-grill-completion-tool.md                                  │ NEW：已記錄 completion contract                               │
│ docs/PLAN-A.md                                                               │ 本計畫與歷史 Plan A                                           │
│ docs/handoff.md                                                              │ 交接至本計畫                                                  │
└──────────────────────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────┘

共 18 個檔案（3 新增 + 15 修改）；其中 6 個為既有設計／交接文件。

Tests

┌─────────────────────────────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────┐
│ 測試                                                                                        │ 驗收條件                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────┤
│ StateMachine_WhenUserConfirms_ShouldAllowReturnToGrill                                      │ `WAIT_USER → USER_CONFIRMED → GRILL` 合法                                   │
│ SessionState_WhenAnswerRecorded_ShouldEnterUserConfirmedThenGrill                           │ answer 成為 decision record 並建立新 round                                   │
│ SessionState_WhenDecisionAlreadyAnswered_ShouldRejectDuplicate                              │ 重複 decision id 不改變 state                                                │
│ SessionState_WhenContinueRequested_ShouldRetainRoundAndSnapshot                             │ replay 不新增 round、snapshot 或 decision                                    │
│ GrillCompletion_WhenRoundMatchesAndEvidenceFetched_ShouldParse                              │ 有效 payload 被接受                                                          │
│ GrillCompletion_WhenRoundIsStale_ShouldReject                                                │ 錯誤 roundId 被拒絕                                                          │
│ GrillCompletion_WhenEvidenceWasNotFetched_ShouldReject                                      │ 未經 evidence tool 的 id 被拒絕                                              │
│ Extension_WhenGrillStarts_ShouldExposeOnlyDomainTools                                       │ active tools 只含兩個 Forge tool                                              │
│ Extension_WhenNonDomainToolIsCalledDuringGrill_ShouldBlock                                  │ native／未知 tool 在 tool_call 被 block                                       │
│ Extension_WhenEvidenceCandidateIsKnown_ShouldReturnSnapshotContent                          │ candidateId 回傳已凍結內容並登記 fetched                                     │
│ Extension_WhenEvidenceCandidateIsUnknown_ShouldReject                                       │ 偽造 id 不讀檔、不改 state                                                    │
│ Extension_WhenCompletionNeedsConfirmation_ShouldEnterWaitUserAndHideProse                   │ `NEEDS_CONFIRMATION` 顯示 WAIT_USER，餘下 prose 不顯示                       │
│ Extension_WhenCompletionIsReady_ShouldEnterDeepKnowledgeAndHideProse                        │ `READY_FOR_DEEP` 走既有 Deep executor，餘下 prose 不顯示                     │
│ Extension_WhenTerminalMessageOmitsCompletion_ShouldPromptContinueAndSwitch                  │ 顯示錯誤與兩個明確指令，round 保留                                            │
│ Extension_WhenUserAnswerIsReceived_ShouldRecordAndStartNextGrillRound                       │ option／free text 均經同一 resume path                                       │
│ Extension_WhenContinueIsRequested_ShouldReplaySameRound                                     │ 明確 continue 再送相同 round prompt，不重跑 Discovery                        │
└─────────────────────────────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────┘

新增 16 條測試；預期 `55 + 16 = 71` passed、0 failed。

Execution Order

1. 子代理先在 `state-machine`、`session-state` 與 `grill-result` 補上述最小測試，執行指定測試並確認現況紅燈。
2. 主代理確認紅燈後，先完成 state transition、session ledger、snapshot 與 completion payload validation；子代理重跑相關測試。
3. 子代理新增 extension harness 的 `registerTool`／`tool_call` 支援與雙 domain tool 的 red tests，確認 native tool gate 與 candidate scope 在舊程式碼失敗。
4. 主代理在 extension 實作 custom tool、active-tool restore、completion／omission suppression 與單一路徑 resume；每完成一個 slice 都由子代理重跑相關測試。
5. 子代理執行完整 `forge-runtime` test 與 type check；只有 71/71 綠燈才更新完成狀態與 handoff。

---

## Execution Progress：2026-08-12

已完成的 red → green slices：

1. `StateMachine_WhenUserConfirms_ShouldAllowReturnToGrill`：先證明舊實作拒絕 transition，後加入 `USER_CONFIRMED → GRILL`；指定測試檔為 2 passed、0 failed。
2. `SessionState_WhenAnswerRecorded_ShouldEnterUserConfirmedThenGrill`、`SessionState_WhenDecisionAlreadyAnswered_ShouldRejectDuplicate`、`SessionState_WhenContinueRequested_ShouldRetainRoundAndSnapshot`：已加入最小 answer／duplicate／round-replay session contract；指定測試檔為 3 passed、0 failed。
3. `GrillCompletion_WhenRoundMatchesAndEvidenceFetched_ShouldParse`、`GrillCompletion_WhenRoundIsStale_ShouldReject`、`GrillCompletion_WhenEvidenceWasNotFetched_ShouldReject`：已加入 TypeBox completion schema 與 round／evidence validation；指定測試檔為 6 passed、0 failed。
4. `forge-runtime/package.json` 與 lockfile 已鎖定 runtime dependency `typebox@1.3.7`。
5. `Extension_WhenGrillStarts_ShouldExposeOnlyDomainTools`、`Extension_WhenNonDomainToolIsCalledDuringGrill_ShouldBlock`：已完成 domain-tool allowlist 與非 domain `tool_call` deny gate；兩項皆 targeted green，尚未執行完整 suite／type check。
6. `Extension_WhenEvidenceCandidateIsKnown_ShouldReturnSnapshotContent`、`Extension_WhenEvidenceCandidateIsUnknown_ShouldReject`、`LightDiscovery_WhenSnapshotCreated_ShouldDeepFreezeEvidence`：Light Discovery 已建立 runtime deep-frozen snapshot，以 `ev-<SHA-256>` manifest 提供候選；evidence tool 只回傳 snapshot content／metadata，unknown ID 固定拒絕。
7. `Extension_WhenGrillIsCancelled_ShouldRestorePreviousActiveTools`、`Extension_WhenGrillIsSwitched_ShouldRestorePreviousActiveTools`：cancel 與 switch fallback 已還原 Grill 前的 active tools；兩項皆 targeted green。
8. `Extension_WhenCompletionNeedsConfirmation_ShouldEnterWaitUserAndHideProse`：completion tool 已先驗證 round／fetched evidence，再以 `NEEDS_CONFIRMATION` 進入 `WAIT_USER`；同一 Grill turn 的 streaming prose／thinking 仍受 suppression。targeted green。

尚未開始或尚未完成：

- Light Discovery 建立 immutable `GrillEvidenceSnapshot`。
- completion `READY_FOR_DEEP` 對 Deep Knowledge 的單一路徑 transition、completion turn 的 terminal-prose suppression、completion omission handling。
- option／free-text resume、extension `/forge-runtime continue` replay transport，以及完整 suite／type check／review。

### Snapshot contract（2026-08-12，使用者已確認）

- 每個 candidate ID 固定為 `ev-<完整 SHA-256>`；輸入使用 Light Discovery 當下已選定來源的 canonical metadata 與內容，ID 不接受模型自訂。
- snapshot 在建立時做 runtime deep-freeze，只收錄 Light Discovery 實際選出的 wiki 文件、code_base candidate 與存在時的對應 target source。
- `forge_grill_evidence({ candidateId })` 的已知 ID 回傳 frozen snapshot 的 `content` 與最小 metadata，並登記為 fetched；unknown ID 一律以固定錯誤拒絕，不讀檔、不改 state。
- canonical hash preimage 固定為 `JSON.stringify(["forge-grill-evidence-v1", kind, canonicalSource, normalizedContent])`；`canonicalSource` 為 `wiki/`、`code_base/` 或 `target/` 下的 root-relative path，`normalizedContent` 將 CRLF／CR 正規化為 LF。不得把絕對路徑、排序、score 或 discovery ID 納入 hash。
- snapshot candidate 固定包含 `candidateId`、`kind`、`title`、`source`、`content`、`metadata`；runtime deep-freeze 必須涵蓋 snapshot、candidate record、candidate、metadata 及其中的陣列。unknown candidate 固定拒絕為 `GRILL_EVIDENCE_CANDIDATE_NOT_FOUND`。
- 這些決定解除 snapshot production implementation 的暫停；其餘 Plan A 邊界不變。

目前尚未執行完整 `npm test`、`npm run check`；`71 passed` 仍是驗收目標，不是實測結果。CodeGraph 已同步但無法展開 extension nested handler 與 test harness；使用者已授權下一 session 唯讀檢視 `forge-runtime/extensions/forge-runtime.ts` 與 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 以完成下一個 TDD slice。

### 最新續作狀態（2026-08-12）

本段取代上方「尚未開始或尚未完成」的 extension lifecycle 狀態；舊段保留為歷史執行順序。

已完成 targeted green：

1. `Extension_WhenGrillStarts_ShouldExposeOnlyDomainTools`、`Extension_WhenNonDomainToolIsCalledDuringGrill_ShouldBlock`：Grill 僅暴露兩個 domain tool，非 domain tool 在 `tool_call` 被 block。
2. `Extension_WhenEvidenceCandidateIsKnown_ShouldReturnSnapshotContent`、`Extension_WhenEvidenceCandidateIsUnknown_ShouldReject`、`LightDiscovery_WhenSnapshotCreated_ShouldDeepFreezeEvidence`：Light Discovery 以 `ev-<完整 SHA-256>` manifest 建立 runtime deep-frozen snapshot；evidence tool 只讀 snapshot，unknown ID 固定拒絕。
3. `Extension_WhenGrillIsCancelled_ShouldRestorePreviousActiveTools`、`Extension_WhenGrillIsSwitched_ShouldRestorePreviousActiveTools`：cancel／switch 恢復 Grill 前 active tools。
4. `Extension_WhenCompletionNeedsConfirmation_ShouldEnterWaitUserAndHideProse`、`Extension_WhenCompletionIsReady_ShouldEnterDeepKnowledgeAndHideProse`：completion 成功後依 payload 分流至 `WAIT_USER` 或既有 deep-knowledge transition。
5. `Extension_WhenCompletionSuccessIsFollowedByTerminalProse_ShouldSuppressOnlyThatTurn`、`Extension_WhenTerminalMessageOmitsCompletion_ShouldPromptContinueAndSwitch`：completion 成功只壓制同一 turn prose；正常未 completion 的 terminal prose 改發 `GRILL_COMPLETION_REQUIRED`，保留 round 並提示 continue／switch。
6. `Extension_WhenGrillInvocationIsBuilt_ShouldExposeRuntimeIssuedRoundIdAndCompletionContract`：自然／approval Discovery 路徑公開 runtime-issued `roundId`、snapshot manifest、兩個 domain tool 與 completion contract。
7. legacy terminal-JSON 測試已遷移為 completion path 或明確 `/forge-runtime grill-result` debug command；`tests/extensions/forge-runtime-extension.test.ts` 實測 48 passed、0 failed。

尚待完成：

- 三個 review-derived safety slices。
- 完整 `forge-runtime` test suite、`npm run check` 與 final review。

已完成 targeted tests：option／free-text answer resume、`/forge-runtime continue` 同 round replay，以及 switch replacement 經正式 ingress。`/grill-run` 是歷史命令相容 alias，會正規化進 formal ingress；`/forge-runtime grill ambiguous <json>` 僅作低階測試／除錯 injection。

---
Verification

```text
# 僅由子代理執行，從 repo root
cd forge-runtime && npx tsx --test tests/workflow/state-machine.test.ts tests/runtime/session-state.test.ts tests/grill/grill-result.test.ts tests/extensions/forge-runtime-extension.test.ts
cd forge-runtime && npm test
cd forge-runtime && npm run check

# 期望：npm test 0 failed；npm run check 通過。
```

---
Approval and Completion Gate

- 使用者已確認本 Plan A，實作可依 Execution Order 繼續。
- 只有完整 suite、type check 與 review 通過後，才可將本計畫標記為 Completed。

---

## Completion：2026-08-13

- 三個 safety slices 均完成：continue replay 攜帶既有 decision；缺 followUp bridge 時 confirm／reject／selector 維持 `WAIT_USER`；缺 `newSession` 或 replacement 被取消時 switch 保留原 workflow。
- final review 修正：正常 Grill prompt 改為 completion-tool-only；`READY_FOR_DEEP` completion 離開 Grill 後還原原 active tools；缺少完整 tool-boundary capability 時拒絕啟動或重播 Grill。
- 舊測試中假設無 `newSession` 仍可成功 switch、或無 followUp 仍可 direct reject 的互斥契約已移除；成功 switch 測試改用具 `newSession` 的最小 fixture。
- 完整驗證由獨立代理執行：`cd forge-runtime && npm test` 為 77/77 通過；`cd forge-runtime && npm run check` 通過。
- 本輪不改 `pi-main/`、不新增 queue／parallel workflow；`/grill-run` 保留歷史命令相容性，但只會正規化進 formal ingress，取得正式 round／snapshot，不保留獨立 bypass lifecycle。
- 複審 follow-up：首輪 snapshot completion 強制至少一筆已查核 evidence；`NEEDS_CONFIRMATION` 恰好一題、`READY_FOR_DEEP` 無題；無 followUp bridge 的 continue 與 cancel 後 pending closure state 均安全停留／清除。
- 最終獨立驗證：`cd forge-runtime && npm test` 為 83/83 通過；`cd forge-runtime && npm run check` 通過。
- 第三次最終驗證：`cd forge-runtime && npm test` 為 89/89 通過；`cd forge-runtime && npm run check` 通過。
- 第四次最終驗證：`cd forge-runtime && npm test` 為 93/93 通過；`cd forge-runtime && npm run check` 通過。
- 第五次最終驗證：`cd forge-runtime && npm test` 為 94/94 通過；`cd forge-runtime && npm run check` 通過。
- 第六次最終驗證：`cd forge-runtime && npm test` 為 97/97 通過；`cd forge-runtime && npm run check` 通過。
- 第七次最終驗證：`cd forge-runtime && npm test` 為 97/97 通過；`cd forge-runtime && npm run check` 通過。

## 歷史 Plan A：Forge Runtime v4 Grill Terminal Result Lifecycle Repair

日期：2026-08-10

狀態：Completed；使用者確認後已依本計畫完成最小修復與驗證。

Prerequisite（若有）

- `docs/adr/ADR-0005-grill-terminal-result-lifecycle.md` 已獲得使用者確認。
- `docs/PLAN-B.md` 維持原狀，因本輪不涉及 UI 或 widget tree。

---
Building

- 修正 `GRILL` turn 在 assistant tool-call iteration 後，過早清除 `pendingGrillRun` 的 lifecycle bug。
- 只對不含 `toolCall` 的終局 assistant message 解析 `StructuredGrillResult`。
- 終局結果有效時，維持既有分流：`NEEDS_CONFIRMATION → WAIT_USER`；`READY_FOR_DEEP → DEEP_KNOWLEDGE_RETRIEVAL → KNOWLEDGE_UNDERSTANDING`。
- 終局結果無效時，發出受控 `GRILL_RESULT_PARSE_ERROR`，不假裝完成、不中途洩漏一般 prose，且不自動重試。
- 新增最小回歸測試，覆蓋 tool-call 後才收到終局 Grill result 的三條分支。

Not Building

- 不修改 `pi-main/`。
- 不新增自動 retry、背景重問、queue 或第二個 workflow。
- 不重寫 `.pi/skills/grilling/SKILL.md`、不改模型 provider，也不導入跨 provider 的 JSON mode。
- 不修改現有 `WAIT_USER` selector、status/widget tree 或 Deep Knowledge 的候選 relevance 規則。

---
Approach

[Gap 1 - Terminal Grill Result Detection]

PI 會為每個 assistant response 發送 `message_end`，而 tool calls 是一個或多個非終局 assistant response。extension 必須將含 `toolCall` 的 message 視為 Grill 仍在進行中：保留 `pendingGrillRun`、維持 streaming suppression、且不 parse。只有不含 `toolCall` 的終局 assistant message 才可消耗 pending flag 並 parse。

Fragile assumption：PI 會將每個工具呼叫保留為 `content.type === "toolCall"`；若上游改變事件模型，必須重新以 CodeGraph 驗證 lifecycle，而不是改動 `pi-main/`。

[Gap 2 - Controlled Invalid Final Result]

終局 assistant message 若不是有效 `StructuredGrillResult`，workflow 必須保留明確失敗訊號，而不是讓一般文字成為流程終點。此計畫推薦不做自動 retry：格式修復會改變一次 agent turn 的語義並增加隱性重試；使用者可透過既有明確入口重新發起 Grill。

已確認決策：採用「顯性 error、無自動 retry」；替代方案是一次受控的內部重試，但不納入本 Plan A。

---
Files

┌─────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┐
│ 檔案                                                                │ 變動                                                     │
├─────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ forge-runtime/extensions/forge-runtime.ts                           │ 修改，識別 toolCall iteration，僅 parse 終局 Grill result │
│ forge-runtime/tests/extensions/forge-runtime-extension.test.ts      │ 修改，補 tool-call → terminal-result 回歸測試             │
│ docs/adr/ADR-0005-grill-terminal-result-lifecycle.md                │ NEW，記錄 terminal lifecycle boundary                     │
│ docs/PLAN-A.md                                                      │ 修改，本計畫                                               │
│ CONTEXT.md                                                          │ 修改，記錄已定位 gap                                      │
│ docs/handoff.md                                                     │ 修改，記錄核准與實作進度                                  │
└─────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────┘

共 6 個檔案（1 新增 + 5 修改）。

Tests

┌──────────────────────────────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────┐
│ 測試                                                                                 │ 驗收條件                                                                   │
├──────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Extension_WhenGrillUsesToolCallThenNeedsConfirmation_ShouldEnterWaitUser             │ tool-call message 不消耗 pending；終局 `NEEDS_CONFIRMATION` 進 `WAIT_USER` │
│ Extension_WhenGrillUsesToolCallThenReadyForDeep_ShouldCompleteDeepKnowledge          │ tool-call 後的終局 `READY_FOR_DEEP` 進 `KNOWLEDGE_UNDERSTANDING`           │
│ Extension_WhenTerminalGrillResultIsInvalid_ShouldEmitParseErrorWithoutDeepTransition │ 非 JSON 終局只發出 parse error，不進 Deep Knowledge                         │
└──────────────────────────────────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────┘

Execution Order

1. 使用者確認本計畫與 ADR-0005 後，子代理先在 extension harness 補第一個 tool-call → `WAIT_USER` 測試。
2. 子代理先執行該測試，確認舊程式碼紅燈，並回報 failing test 名稱與原因。
3. 主代理確認紅燈後，才在 `forge-runtime/extensions/forge-runtime.ts` 做最小 lifecycle 修正。
4. 子代理補 `READY_FOR_DEEP` 與 invalid final result 測試；每個 slice 都先紅再改，再重跑相關測試。
5. 全部回歸綠燈後，由子代理執行完整 `forge-runtime` 測試與 `npm run check`。

Execution Result

1. 舊程式碼的第一條測試紅燈：最終狀態為 `Forge GRILL [active]`，未進 `WAIT_USER`。
2. 已在 `message_end` 對含 `toolCall` 的 assistant message 提前 return，保留 `pendingGrillRun` 至真正終局 result。
3. 三條指定回歸測試與完整 extension 測試檔通過；子代理完整驗證為 `npm test` 55/55 通過、`npm run check` 通過。

後續決策註記（2026-08-11）

- 使用者已確認：`GRILL` 可使用工具，但僅限對 `LIGHT_DISCOVERY` 候選來源做唯讀查核；每次使用者作答後都須返回下一輪 `GRILL`，只有 `READY_FOR_DEEP` 可進入 Deep Knowledge；同一迴圈固定使用 Light Discovery snapshot，只有使用者透過 `/forge-runtime switch <request>` 改變任務範圍才重跑 Discovery；每輪完成以專用 `forge_grill_complete` tool 回報，正常 runtime 不再解析 assistant 終局文字 JSON；Workflow 發出不可自訂的 round id，已回答 decision id 不可重問；Grill 僅暴露兩個 domain tool，其他工具 deny-by-default；evidence 以 immutable snapshot 與 opaque candidate id 存取；completion 後壓制同 turn 的殘餘 prose；候選不足仍以 `NEEDS_CONFIRMATION` 請使用者改變 Discovery 範圍；新 snapshot 的第一輪必須以 evidence tool 實際查核至少一筆來源；options 與自由回答皆會成為 decision record；未呼叫 completion tool 時發受控錯誤，並直接提示 `/forge-runtime continue` 或 `/forge-runtime switch <request>`；completion payload 沿用既有 result schema 加 round id。這不是本完成計畫的 scope，後續須以新 ADR 與新 Plan 落地。

---
Verification

```text
# 僅由子代理執行，從 repo root
cd forge-runtime && npm test
cd forge-runtime && npm run check

# 實測：npm test 55/55 passed、0 failed；npm run check 通過。
```

---
Approval Gate

- 使用者已明確確認 ADR-0005 與本 Plan A，可開始測試紅燈與任何程式碼修改。

---

# Plan A：PI extension TypeBox loader compatibility（2026-08-13）

## Building

- 在 `forge-runtime/tests/extensions/` 新增真正 PI extension loader 的回歸測試。
- 將 `forge-runtime/src/grill/grill-result.ts` 的 TypeBox compile import 改為 PI loader 已支援的 alias。
- 以 PI CLI 的明確 `--extension` 路徑驗證 `pi` 可載入 Forge extension。

## Not Building

- 不修改 `pi-main/`、PI loader alias 清單或上游 TypeBox package。
- 不改動 `StructuredGrillResult` schema、parser 行為、completion lifecycle 或新增相依套件。
- 不以 direct `tsx` import 取代真實 loader 回歸測試。

## Approach

PI loader compatibility

`grill-result.ts` 的 `typebox/schema` 是合法 TypeBox export，但 PI extension loader 只提供 `typebox`、`typebox/compile`、`typebox/value`。將 compile 呼叫改為 `typebox/compile` 的現有 API，讓 Forge package 使用 loader 的公開相容性 surface。

Fragile assumption：`pi-main` source runtime 已安裝，且 `npx tsx packages/coding-agent/src/cli.ts --offline --no-session --no-extensions --extension ../forge-runtime/extensions/forge-runtime.ts --help` 會在載入 extension 後自行結束；若上游 CLI 的資源載入順序改變，需重新確認這個 integration seam。

## Files

| 檔案 | 變動 |
| --- | --- |
| `forge-runtime/tests/extensions/pi-extension-loader.test.ts` | NEW：以真實 PI CLI loader 驗證 Forge extension 可載入 |
| `forge-runtime/src/grill/grill-result.ts` | 將不受支援的 TypeBox schema subpath 改為支援的 compile alias |
| `CONTEXT.md` | 記錄 extension loader compatibility boundary |
| `docs/adr/ADR-0007-grill-completion-tool.md` | 記錄 TypeBox import compatibility 決策 |
| `docs/PLAN-A.md` | 記錄本 Plan A |
| `docs/handoff.md` | 記錄進度與驗證入口 |
| `agent-state/typebox-loader-compatibility.md` | NEW：持久化本 ticket 狀態 |

共 7 個檔案（2 新增、5 修改）。

## Tests

| 測試 | 驗收條件 |
| --- | --- |
| `Pi_WhenLoadingForgeRuntimeExtension_ShouldNotEmitTypeBoxSchemaResolutionError` | global compiled PI CLI 的 offline print probe 不含 `index.mjs/schema` |
| `Pi_WhenLoadingForgeRuntimeExtension_ShouldNotFailDuringExtensionLoad` | 同一 probe 不含 `Failed to load extension`；後續 offline/model exit 不視為 loader failure |

## Execution Order

1. 子代理先新增 `pi-extension-loader.test.ts` 的兩個 regression assertions，並以 global compiled `pi --offline --no-session --no-extensions --extension .pi/extensions/forge-runtime.ts -p "loader smoke"` 作 probe。
2. 子代理先執行 `cd forge-runtime && npx tsx --test tests/extensions/pi-extension-loader.test.ts`，確認舊程式碼紅燈，回報 failing test 名稱與失敗原因。
3. 主代理確認紅燈後，才由獨立實作子代理在 `src/grill/grill-result.ts` 做最小 import 修正。
4. 獨立驗證子代理重跑 focused test，確認兩個 assertions 綠燈；再執行完整 `npm test`、`npm run check` 與 PI CLI runtime check。
5. 獨立 review 子代理只審查本 ticket 的文件與程式變動；若有修正，重新派驗證子代理。

## Verification

```text
# 僅由子代理執行，從 repo root
cd forge-runtime && npx tsx --test tests/extensions/pi-extension-loader.test.ts
cd forge-runtime && npm test
cd forge-runtime && npm run check

pi --offline --no-session --no-extensions --extension .pi/extensions/forge-runtime.ts -p "loader smoke"

# 期望：97 既有 + 2 新增 = 99 passed、0 failed；CLI 不得出現 extension loader error。
# 注意：offline print 在 loader 通過後仍可能因模型不可用而 exit 1。
```

## Approval Gate

- 使用者已明確要求修復實際 `pi` 載入錯誤；本 Plan A 僅採 Forge package import 相容性修正，未跨越 `pi-main/` 邊界。

## Test-seam correction（2026-08-13）

- `pi-main` source CLI 直接載入 `forge-runtime/extensions/forge-runtime.ts` 的兩個 assertions 在舊程式碼即通過，不能作為本錯誤的紅燈 guard。
- production code 保持未修改；Plan A 暫停於 red phase，改以使用者實際的 global `pi` 與 `.pi/extensions/forge-runtime.ts` bootstrap path 重建可重現 seam。

## Red evidence（2026-08-13）

- replacement seam 已由 `forge-runtime/tests/extensions/pi-extension-loader.test.ts` 驗證為紅燈：`Pi_WhenLoadingForgeRuntimeExtension_ShouldNotEmitTypeBoxSchemaResolutionError` 與 `Pi_WhenLoadingForgeRuntimeExtension_ShouldNotFailDuringExtensionLoad` 都在舊程式碼失敗。
- probe 在約兩秒內 exit 1，且在任何 offline/model error 前出現 `Failed to load extension` 與 `typebox/build/index.mjs/schema`；可進入最小 production import 修正。

## Execution Result（2026-08-13）

- 已在 `forge-runtime/src/grill/grill-result.ts` 將 `typebox/schema` 的 `Schema.Compile` 改為 `typebox/compile` 的 `Compile`；沒有修改 schema、parser 行為或 `pi-main/`。
- red evidence：兩個 global compiled PI loader assertions 都因原始 `index.mjs/schema` error 失敗。
- green evidence：focused loader test 2/2、完整 `npm test` 99/99、`npm run check` 與 global compiled PI runtime probe 都 exit 0；三個 extension error 字串均未出現。
- 唯一測試環境前提：`pi-extension-loader.test.ts` 需要 PATH 中可用的 compiled `pi` CLI，缺少時明確視為 integration prerequisite 失敗，不靜默 skip。

## Final Review（2026-08-13）

- 獨立 review 未發現 Standards 或 Spec 缺陷：schema、validator lifecycle 與 completion 回傳結構未變，修改只移除不支援的 `typebox/schema` alias。
- 限制：workspace 沒有 Git baseline，review 以指定檔案與 Plan A 的證據進行，無法產生 fixed-point diff；CodeGraph 也未能逐行載入新增測試與文件，但 focused／完整／runtime 驗證已實際覆蓋 loader seam。

## 2026-08-16 已核准增補：WAIT_USER 開放回答與單次發布（歷史快照，已由最終完成狀態取代；當時待 RED→GREEN）

### Building

- 讓 WAIT_USER 將 options 視為推薦／快捷回答，接受 trim 後非空自由文字。
- 讓語意不足的回答進入下一輪 GRILL 的新 clarification decision，不重發原 `decisionId`。
- 讓同一 pending `decisionId` 只發布一次 WAIT_USER；移除通用 Confirm／Reject 顯示；exact evidence id 去重，主畫面只顯示唯一 evidence 數量，raw `ev-...` ID 留在 runtime state／紀錄且不顯示；completion 後不輸出 assistant prose。

### Not Building

- 不新增 schema、session-state 欄位、workflow stage、通用輸入元件或 `pi-main/` 修改。
- 不預先修改 session-state；先由紅燈證明既有 raw free-text 已會 `recordAnswer` 但契約仍有 gap。
- 不重開本文件既有 completed sections。

### Files

Production seams：

- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/src/ui/wait-user-panel.ts`
- `forge-runtime/src/grill/grill-skill.ts`

Tests：

- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `forge-runtime/tests/grill/grill-skill.test.ts`
- `forge-runtime/tests/ui/wait-user-panel.test.ts`（新增）

共 6 檔，超過 5 檔但分屬三個既有 seam；不得預先修改 session-state。

### Tests

Focused command：

```text
cd forge-runtime && npx tsx --test tests/extensions/forge-runtime-extension.test.ts tests/grill/grill-skill.test.ts tests/ui/wait-user-panel.test.ts
```

Assertions 必須涵蓋開放 options、new clarification decision、單次 WAIT_USER、無通用 Confirm／Reject、exact evidence id 去重後的唯一數量摘要與 completion 無 prose。

### Execution Order

1. 由獨立測試子代理先補三份 focused assertions，明確打出第一個 RED。
2. 紅燈確認後，才由獨立實作角色在三個既有 seam 做最小 GREEN；不修改 session-state。
3. 由獨立驗證角色執行上述 focused command 與 `npm run check`；完整 suite 保留 OOM 風險，不宣稱 current full-suite pass。

### Verification

- focused command 三檔均通過，且 `npm run check` exit 0。
- 最近一次完整測試嘗試 47 中 44 pass、3 fail，另有 loader timeout／約 4GB heap OOM；該結果不視為 current full-suite pass。
- 真實 PI TUI 視覺驗收在後續 verification，不阻塞先完成 RED→GREEN 的文件計畫。

### Approval / Fragile assumptions

- 使用者已核准上述六項契約；本增補可進入 RED→GREEN，但 ticket 仍未完成。
- 六檔超過五檔是因三個既有 seam 各有 focused coverage；本計畫不預設 session-state 修改。

## 最終完成狀態（2026-08-16）

本節 supersede 上述舊的 47/44、OOM blocker 與待 RED→GREEN 狀態。

### Building

- Plan A implementation 已完成：WAIT_USER custom Editor／trim／blank Enter／Escape／shared resume、clarification decisionId、pending decisionId 一次性 publish、unique evidence count 與 completion prose suppression 均已落地。

### Tests

- 最終程式／測試路徑：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/grill/grill-skill.ts`、`forge-runtime/src/ui/wait-user-panel.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/grill/grill-skill.test.ts`、`forge-runtime/tests/ui/wait-user-panel.test.ts`。
- focused batch：83/83 pass。
- canonical `npm test`：124/124 pass，無 OOM／timeout。

### Verification

- `npm run check`：兩段 `tsc --noEmit` 通過。
- scripted PI TUI：focused 1/1、full 4/4 pass。
- final review：Standards 0 findings；Spec finding 已修正，closure 0 findings。
- Plan B 人工視覺驗收、固定 widget tree、selectList autocomplete render coverage 尚未完成；下一步由使用者決定是否進入 Plan B。

---

# Plan A：WAIT_USER 重入與 UI lease 生命週期

日期：2026-08-16

狀態：已完成（2026-08-17）。正式程式、精準／完整驗證與審查均已完成。

## 建置範圍

- 同一時間只保留一個 pending decision；不同 `decisionId` 重入採「先到的待決策優先（first-pending-wins）」由 extension 靜默忽略，不拋錯、不改動原 decision 或 UI，也不發布第二個 UI。
- 相同 `decisionId` 重入只重顯 UI；UI 已 active 時略過重複發布，不再次做 `WAIT_USER` transition。
- 將 `published` marker 改為互動期間的 in-flight UI lease；`ctx.ui.custom` 整段互動持有，透過 `finally` 清除，正常返回與 throw 都涵蓋。
- Escape／無 UI 保留 `WAIT_USER` 與 pending decision，允許自然文字或同 ID 日後重試，不自動重試。
- UI throw 清 lease 後向上傳遞，仍保留 `WAIT_USER` 與 pending decision。

## 不建置

- 不修改 `pi-main/`、schema、stages 或 completion。
- 不做 queue、replace、history dedupe、answered decisionId reuse 改動或 reset lifecycle。
- 不處理上游強制關閉 component 且未呼叫 `done` 所造成的 Promise／lease pending；列為已知風險。

## 實作方式

在既有 `forge-runtime.ts` 的 WAIT_USER 發布與互動 seam 做最小修正：先以 pending decision identity gate 保護原狀態，再以 UI active／lease 邊界控制發布與清理。不同 ID 在 transition 前靜默忽略；同 ID 只走重顯路徑。UI 結束或例外統一清 lease，例外照原路徑向上傳遞。

## 檔案

| 檔案 | 變動 |
| --- | --- |
| `forge-runtime/extensions/forge-runtime.ts` | WAIT_USER single-pending、same-ID rerender、UI lease 與 failure／cancel semantics |
| `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | 不同 ID 靜默忽略、同 ID 重試、UI throw、Escape／無 UI 與 active UI 去重回歸測試 |

正式程式／測試實際只修改上述 2 個檔案；本文件與 ADR、handoff、ticket state 為 durable 文件，不列入正式程式檔案範圍。

## 測試

至少覆蓋以下案例；不預先承諾新增測試總數，驗收以基線與新增案例全數通過為準：

- 不同 ID 重入被 extension 靜默忽略，不拋錯、不發布第二個 UI，原 pending decision、WAIT_USER 與 marker／lease 不變。
- 相同 ID 在 UI 失敗後可重試，且重試不再次做 WAIT_USER transition。
- UI throw 向上傳遞，並清除 lease、保留 WAIT_USER／pending decision。
- Escape／無 UI 正常返回，保留 WAIT_USER／pending decision，允許後續重試且不自動重試。
- active UI 收到相同 ID 時不重複發布。

## 執行順序

1. 已完成回歸案例、最小 production 修正與 focused 驗證。
2. 已完成 full suite、兩段 type check 與 scripted PI TUI 驗證。
3. 已完成 Standards／Spec 審查；無 runtime 發現，且無範圍膨脹。

## 驗證

```text
# 僅由獨立驗證子代理執行，從 repo root
cd forge-runtime
npx tsx --test tests/extensions/forge-runtime-extension.test.ts tests/grill/grill-skill.test.ts tests/ui/wait-user-panel.test.ts
npm test
npm run check
```

命令依 `forge-runtime/package.json` 的 `test`／`check` scripts；實際結果為精準測試套件 87 通過／0 失敗、`npm test` 128 通過／0 失敗／0 略過、`npm run check` 兩段 tsc 均通過。scripted PI TUI 精準 1/1、完整 4/4 通過。

## 脆弱假設

若上游強制關閉 component 而沒有呼叫 `done`，Promise／lease 可能 pending；本 Plan A 不加入 reset lifecycle，後續若要處理需另行核准。

## Ticket closure（2026-08-17；歷史 WAIT_USER ticket）

Plan A 與本 ticket 已完成，無待實作或 re-review。最終 Standards review 為 0 findings；最終 Spec review 為 0 findings。精準測試套件 87/87、完整 `npm test` 128/128、`npm run check` 兩段 tsc 均通過；runtime／test 在最終測試後未再修改，後續僅進行文件翻譯與狀態同步。下一步只能由使用者另行決定方案 B 人工視覺驗收，或開立新 ticket。

保留三個已知 gap：缺少 `decisionId` 的 ingress 不做 dedupe；上游 UI component 不呼叫 `done` 可能使 Promise／lease 永久 pending；Plan B 人工視覺驗收尚未完成。

---

## 2026-08-17 Active Follow-up：Grill 呼叫傳輸完整性

狀態：implementation complete；post-review-fix validation complete；final review complete（2026-08-18）。

驗收／closure：已完成；Standards 0 findings、Spec 0 findings。

### 建置範圍

- 確保初始 Forge ingress、知識庫缺失後 approval、`WAIT_USER` 回答後下一 round 三條路徑，都把完整 Grill invocation 送到 provider。
- 移除會在 provider 消費前把 invocation 改回原始 request／answer 的 `pendingUserMessageRewrite` 生命週期。
- 保留 completion-only contract、runtime-issued `roundId`、snapshot manifest、candidate ids 與 task 文字。
- 保留既有工具 gate、assistant completion suppression、completion omission 與 `RECOVERY_REQUIRED` 行為。

### 不建置

- 不修改 `pi-main/`。
- 不修改 retry／cancel／switch、settled 或 auto-retry policy。
- 不新增 provider hook、message model、queue、parallel workflow 或第三種 completion status。
- 不建立短版 transcript／history presentation seam；「顯示訊息」與「送給 provider 的訊息」分離不屬本 ticket scope，尚未核准或實作。
- 不修改 Plan B UI，也不把此底層 bug 包裝成視覺驗收工作。

### 實作方式

在 `forge-runtime/extensions/forge-runtime.ts` 做單點刪除：移除 `pendingUserMessageRewrite` 宣告、三個設值點，以及 user `message_end` replacement 分支。保留 `buildGrillingSkillInvocation(...)` 產生的訊息，讓 finalized user message 與 provider payload 使用同一份完整 invocation。

本 ticket 不新增 provider timing seam，也不實作 display/provider message 分離；後者列為後續設計待辦，需另走 `design-plan-workflow` 並取得人類決策。

脆弱假設：使用者可接受 session history 顯示完整 Grill invocation。若新 session 不接受此結果，必須先停止實作並回到設計，另開 presentation seam 決策；不得把 rewrite 偷渡回 provider lifecycle。

### 檔案

| 檔案 | 變動 |
| --- | --- |
| `forge-runtime/tests/extensions/pi-grill-interactive.test.ts` | 新增三條 provider-facing invocation 回歸測試 |
| `forge-runtime/extensions/forge-runtime.ts` | 移除 user message rewrite 狀態與生命週期 |

正式程式與測試只涉及 2 個檔案；三條 production slice、post-review-fix validation、final review 與 acceptance／closure 已完成，本文件、Context、ADR、handoff 與 agent state 已同步狀態。

### 測試

| 測試 | 驗收條件 |
| --- | --- |
| `PiIngress_WhenInitialGrillIngress_ShouldPreserveFullGrillInvocationInProviderContext` | 首次 provider request 包含 completion contract、目前 `roundId`、snapshot manifest 與 task，且不等於原始 request |
| `PiProvider_WhenKnowledgeBaseApprovalStartsGrill_ShouldReceiveStructuredInvocationInsteadOfApprovalText` | approval 後 provider 收到完整 invocation，不等於 approval 文字 |
| `PiProvider_WhenWaitUserAnswerStartsNextRound_ShouldReceiveStructuredInvocationInsteadOfAnswer` | 回答後下一 round 保留新 roundId、既有 snapshot 與 completion contract，不等於使用者答案 |

三條測試在舊程式上均因 provider payload 被改寫而 RED；目前實際測試名稱如上，post-cleanup targeted batch 為 3 pass、0 fail。post-review-fix 的真 PI TUI、canonical suite、TypeScript checks 與 final review 已完成。

### Post-review 修正與驗證（2026-08-18）

- 首輪 review findings 已修正：英文 ponytail 註解改為繁中、initial 測試補上 `roundId` 與 manifest assertion、文件驗證狀態與測試名稱同步。
- 三條 integration path 的 fixture duplication 是刻意保留的 judgement call，不抽象共用 fixture，以維持 independent integration paths。
- canonical 首次 130 pass／1 fail 為 obsolete original-transcript rewrite test；刪除該 obsolete test 後為 130 pass／0 fail／0 skip。
- post-review-fix：full PI TUI 7 pass／0 fail／0 skip；`npm run check` 兩段 tsc 均 pass、no diagnostics。
- final review：Standards 0 findings、Spec 0 findings；acceptance／closure complete。

### 執行順序

1. 已新增 initial ingress、approval 與 `WAIT_USER` resume 三條 provider-context 測試。
2. 已確認三條紅燈，並移除 `pendingUserMessageRewrite` 及 user `message_end` replacement，完成最小 production slice。
3. 已取得三條 post-cleanup targeted GREEN，並完成 post-review-fix full PI TUI、canonical suite 與兩段 TypeScript check。
4. 首輪 review findings 已修正；獨立兩軸 final review 已完成，Standards 0 findings、Spec 0 findings。
5. 本 ticket acceptance／closure 已完成；後續僅保留另案 presentation/provider seam 設計待辦。

### 驗證

```text
# 僅由獨立驗證子代理執行，從 repo root
cd forge-runtime
npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/extensions/pi-grill-interactive.test.ts
npx tsx --test tests/extensions/forge-runtime-extension.test.ts
npm test
npm run check
```

驗證結果：三個實際 provider-context 案例 post-cleanup 3 pass／0 fail；post-review-fix full PI TUI 7 pass／0 fail／0 skip；canonical `npm test` 130 pass／0 fail／0 skip（首次 130/1 為 obsolete original-transcript rewrite test，刪除後重跑）；`npm run check` 兩段 tsc 均 pass、no diagnostics。final review：Standards 0 findings、Spec 0 findings；acceptance／closure complete。

---

## 2026-08-20 最終 Plan A：Grill 完成終止邊界與 display-only

工作項目：`grill-completion-terminal-boundary-20260819`。Plan A 已實作完成；使用者已授權修改 `pi-main`。不執行 Plan B，因為本 ticket 是 core contract／行為缺口，沒有獨立視覺工作。

### 建置範圍

- PI coding-agent `0.83.0`、commit `321bbe69e909de9551906967629908a99167d11e`（`321bbe6`）、main：新增窄化 display-only custom message contract；public `CustomMessage`／`CustomAgentMessages.custom` 維持 HEAD，marker 僅在 internal intersection。
- `deliverAs: "displayOnly"` 的 message 進 UI、transcript、persistence/reload，不進 provider context、不觸發 turn；marker 為 `excludeFromContext?: boolean`。
- Forge 成功 `forge_grill_complete` 的 `NEEDS_CONFIRMATION` WAIT_USER state message 使用 display-only；成功結果仍 `terminate: true`。

### 不建置

- 不修改 `packages/agent/src/harness/*`、不保證跨 package 共用 JSONL、不降版、不回填舊 session。
- 不改其他 Forge command/retry/cancel/switch/deep knowledge/state message、不改完成遺漏政策、不用 `abort()`。
- 不做 Plan B 視覺工作、不處理 queued steer 的全結果終止強化或 Deep 後新歧義轉移。

### 實作方式

TDD 垂直切片已完成：core streaming RED → minimal route；persistence/convert/compaction/branch summarization RED → minimal marker/filter；Forge NEEDS_CONFIRMATION RED → displayOnly integration GREEN；READY regression 以 characterization GREEN 完成，未增加 production。

### 檔案

本次已修改 implementation code/test 10 檔，並同步 durable docs 7 檔；以下為實際範圍。

- PI 正式程式 5：`pi-main/packages/coding-agent/src/core/extensions/types.ts`、`agent-session.ts`、`messages.ts`、`session-manager.ts`、`core/compaction/branch-summarization.ts`。
- PI 測試 5：`pi-main/packages/coding-agent/test/suite/agent-session-queue.test.ts`、`test/suite/lax-message-content.test.ts`、`test/compaction.test.ts`、`test/session-manager/file-operations.test.ts`、`test/branch-summarization.test.ts`。
- Forge 正式程式／測試 2：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。
- 持久文件 7：`FORGE_RUNTIME_Arch_v4.md`、`CONTEXT.md`、`docs/adr/ADR-0011-grill-completion-terminal-boundary.md`、`docs/adr/ADR-0012-display-only-custom-message.md`、`docs/PLAN-A.md`、`docs/handoff.md`、`agent-state/grill-completion-terminal-boundary-20260819.md`。

### 測試

- 新增 core 5 案例：streaming route、message persistence/convert、compaction filter、branch summarization marker rehydrate、session file round-trip。
- Forge 2 案例：`SuccessfulNeedsConfirmationCompletion_TerminatesTurnUntilUserAnswer`、`SuccessfulReadyForDeepCompletion_TerminatesTurnAtKnowledgeUnderstanding`。
- Forge successful NEEDS_CONFIRMATION 與 READY regression 均已完成；測試等待觀測點以 session/provider marker 為準，不以 roundId viewport 作為唯一依據。

### 執行順序

1. PI core streaming、provider conversion、compaction、branch summarization、session-file round-trip 依序完成 RED→GREEN。
2. Forge NEEDS_CONFIRMATION 完成 displayOnly integration；回答後先 resume、重用 `pendingReplayInvocation`，再送完整 followUp invocation。
3. READY regression 完成 characterization GREEN；READY 仍自動進 Deep，不要求 idle。
4. 完成 Forge／PI focused、full、check、lock/import 與 review 前置驗證，並同步 durable docs。

### 驗證

```text
# 驗證由獨立子代理執行；完整 log 位於 agent-state/logs/
```

最終結果：Forge `npm test` 132 passed、exit 0（`forge-full-test-green-final-20260820.log`）；Forge post-review check/full 均 exit 0（`forge-check-after-review-20260820.log`、`forge-full-after-review-20260820.log`）；Forge interactive 9 passed（`forge-pi-interactive-full-green-20260820.log`）；PI focused 5 files 76 passed／2 skipped、exit 0（`pi-display-only-five-files-final-20260820.log`）；PI Biome 991 files exit 0（`pi-readonly-biome-final-final-20260820.log`）。branch summarization RED／GREEN 證據為 `branch-summary-displayonly-red-20260820.log`／`branch-summary-displayonly-green-final-20260820.log`。PI tsgo 僅剩 `packages/ai` 六個 untouched baseline errors（`pi-readonly-tsgo-final-final-20260820.log`），本次 CustomMessage／branch test 無錯；canonical `npm run check` 未跑，因含 `--write`，改跑唯讀子命令。

### 脆弱假設

`terminate` 可能被 queued steer 延續；display-only 的 context exclusion 必須在 streaming、persistence、convert、compaction 與 branch summarization rehydrate 五條路徑一致，否則會出現可見但誤入 provider context 的訊息。

已知風險另包括 extension API `send`／`sendUserMessage` 的 fire-and-forget lifecycle、Node `DEP0190` warning；兩者均不在本次重定義範圍。最終 review 後下一步為 targeted re-review 與 final handoff。

### Final closeout（2026-08-20）

- targeted final review：Standards 0 findings、Spec 0 findings；P2 public union 與 hard `any` finding 均已解決。
- branch summarization final GREEN：`agent-state/logs/branch-summary-final-final-green-20260820.log`，1 passed、0 failed、exit 0；no-`any` 後驗證已完成。
- 最新 PI tsgo：`agent-state/logs/pi-tsgo-final-six-baseline-20260820.log`，僅剩 `packages/ai` 六個 untouched baseline errors。
- 新測試使用具體 `Model<"openai-completions">`，無 `any`；`Model.cost`／`Usage.cost` fixture 正確。
- modified files 清單確認包含 `pi-main/packages/coding-agent/src/core/compaction/branch-summarization.ts` 與 `pi-main/packages/coding-agent/test/branch-summarization.test.ts`。
- Plan A completed，無待實作；下一步僅使用者決定 commit／PR，或後續處理 baseline／out-of-scope 風險。Plan B 未執行。

---

## 2026-08-21 Plan A：Intent route-only LLM

工作項目：`intent-route-only-llm-20260821`。

### 狀態

實作、驗證與獨立 final review 均完成；Standards 與 Spec 皆為 0 findings，ticket 已完成。下一步只能等待使用者確認後再進入 Light Discovery。

### 建置範圍與決策

- Intent 只做 LLM 路由，嚴格輸出 `{"route":"passthrough"}` 或 `{"route":"start_forge"}`。
- workflow guard 先處理 WAIT_USER、open workflow、slash control；`/grill-run` 以 canonical payload wrapper 進 `start_forge`。
- 10 秒 timeout、missing model、completion error、abort、invalid JSON/schema 一律 fail-closed 為 `start_forge`。
- 自然輸入以 rawText 原樣保存；goal 由 start_forge 後取得，seed fixed-point helper 留在 extension handoff private helper。
- 使用共用 `IntentModelContext` model seam；不修改 `pi-main/`。

### 修改檔案

- Production：`forge-runtime/src/intent/intent-understanding.ts`、`forge-runtime/src/intent/intent-types.ts`、`forge-runtime/extensions/forge-runtime.ts`；刪除 `forge-runtime/src/intent/resume-check.ts`（session resume guard 移到 extension／共用 model 前置流程）。
- Tests：`forge-runtime/tests/intent/intent-understanding.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`（公開 seed characterization test）、`forge-runtime/tests/extensions/pi-extension-loader.test.ts`（loader smoke 修正）。Light Discovery production／內部測試不在 scope。
- Durable docs：`CONTEXT.md`、`docs/adr/ADR-0013-intent-route-only-llm.md`、`docs/PLAN-A.md`、`docs/handoff.md`、`Memory/record.md`、`Memory/lesson_learn.md`、`agent-state/intent-route-only-llm-20260821.md`。

### 最終驗證

- intent 12/12、Forge extension 91/91、loader smoke 2/2。
- `npm run check` exit 0；完整 `npm test` 146/146 pass。
- 證據：`.tmp/intent-route-only-systemprompt-*.log`。

### Final closeout（2026-08-22）

- Standards final review：0 發現事項；Spec final review：0 發現事項。
- 本 ticket acceptance／closure 已完成，沒有進入 Light Discovery；下一步只能等待使用者確認。

### Rollback


回退本 ticket 的 production/test commit，並同步回退 ADR、Context、Plan、handoff、Memory 與 agent-state；不回退或修改 `pi-main/`。

---

## 2026-08-22 Plan A：Light Discovery 檔名與 metadata

### 狀態

實作、驗證與獨立雙軸審查均完成；狀態為 `implementation+verification+two-axis-review-complete`。

### 建置範圍與決策

- 依使用者核准的 ADR-0014 第一階段，只掃 `wiki/`、`code_base/` 一般檔案 metadata；每來源最多 3 筆，依相對路徑 deterministic 排序。
- public seam 只收 rootDir 與 raw userMessage；module 內完成 normalize、scan、output，輸出 `matches`、`warnings`、`sourceAvailability`。
- Grill／Deep Knowledge 相容 adapter 留在 module 外並讀取內容計算 relevance；Light Discovery 本身不產生 full content、summary 或 snapshot。缺失來源人工核准流程保留。

### 修改檔案

- Production：`forge-runtime/src/discovery/light-discovery.ts`、`forge-runtime/extensions/forge-runtime.ts`。
- 參考／證據（未修改）：`forge-runtime/src/discovery/discovery-sources.ts`，僅用於確認既有 discovery source 邊界。
- Tests：`forge-runtime/tests/discovery/light-discovery.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`，及測試遷移涉及的三個既有 test 檔。
- 文件：`CONTEXT.md`、`docs/adr/ADR-0014-light-discovery-file-metadata-module.md`、`docs/PLAN-A.md`、`docs/handoff.md`、`Memory/record.md`、`Memory/lesson_learn.md`、`agent-state/light-discovery-file-metadata-20260822.md`。

### 驗證

- 互動 9/9、focused 79/79、`npm run check` exit 0、完整 `npm test` 140/140；0 fail、0 skip、0 todo。
- 證據：`forge-runtime/.tmp/review-fix-verify-*.log`。僅有既有 Node `DEP0190` warning，無殘留程序。

### 測試遷移與修復紀錄

- 清除 2 個 stale old API callers；刪除 10 個 ADR 淘汰測試、改寫／保留 5 個，並還原 2 個強相關 Deep expectations。
- 修復 adapter 固定只有 path signal 導致 relevance gate 將 `READY_FOR_DEEP` 誤回 `WAIT_USER` 的 production bug；adapter 現依 raw request seeds 計算 path/content、`matchedSeeds`、`score`。

### 雙軸審查收尾

- 初次 Standards 與 Spec review 各有 3 個發現事項，已採納並完成修正。
- 修正後 Spec re-review 為 0 發現事項；Standards re-review 僅發現過時數字，已修正本節與交付文件中的目前數字。
- 實作、驗證與雙軸審查均完成；未解風險僅為既有 Node `DEP0190` warning，v4 後續階段另案處理。

---

## Plan A：Grill 到 Deep Knowledge 的穩定交接

日期：2026-08-23

狀態：completed（2026-08-24；實作、驗證、雙軸複審與文件收尾均完成）

前置條件：`ADR-0015` 已 Accepted；使用者已裁決採用方案 A，並完成本計畫實作。

本 ticket 只有單一 Plan A。沒有新 UI，因此不建立 Plan B。

### 建置內容

1. 以既有 `continueDeepKnowledge` 為唯一交接 seam。正式與 debug completion 都走同一 gate；通過 relevance 後，在任何 `await` 前同步關閉 pending Grill、還原 tools、使舊 round 失效，再 begin Deep。`message_end` 與 `/continue` 也必須有 active-stage guard。
2. relevance fail 不建立 Grill round。以既有 `WAIT_USER` 顯示 Discovery clarification；回答後依 `WAIT_USER → USER_CONFIRMED → LIGHT_DISCOVERY`，用原需求加補充重新探索，建立新 snapshot 後再進 Grill。
3. reset 不重設 `nextRoundId`；同一 extension lifetime 內保持單調遞增。同一 snapshot 多輪可保留 fetched evidence；candidate IDs 改變就清除。Deep 直接使用 Grill snapshot 與 decisions，`wiki/`／`code_base/` 不重讀，只補 target source 等新來源。
4. WAIT_USER identity 固定使用方案 A 的 `roundId + kind + decisionId`：unknown round 拒絕、精確重播保持 idempotent、新 round 可重用相同 ID；formal、debug、relevance 與 UI lease 共用此 identity。relevance `/confirm` 不代答。

### 不建置內容

- 不改 `pi-main`。
- 不加 dependency、服務或設定。
- 不做完整 semantic Deep、Pattern Card 或持久化 session。
- 不加第二個 LLM verifier。
- 本 ticket 不新增 Deep → Grill result type，僅由 ADR 約束未來行為。
- 不修正 PLAN-A 既有第 172、229 行標點。

### 實作方式

在既有 runtime 交接 seam 加入完成 gate 與 active-stage guard，讓 Grill 的 completion、snapshot、decision 與 round identity 在進 Deep 前完成一次同步封口。Discovery clarification 使用既有 WAIT_USER 回流 Light Discovery，不把 relevance failure 誤建成 Grill 問題；snapshot 改變時清理不再有效的 fetched evidence。

### 檔案範圍

production：

- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/src/grill/grill-result.ts`
- `forge-runtime/src/runtime/session-state.ts`
- `forge-runtime/src/ui/ui-state.ts`
- `forge-runtime/src/workflow/state-machine.ts`

tests：

- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `forge-runtime/tests/grill/grill-result.test.ts`
- `forge-runtime/tests/runtime/session-state.test.ts`
- `forge-runtime/tests/ui/wait-user-panel.test.ts`
- `forge-runtime/tests/workflow/state-machine.test.ts`

### 測試

- `RelevanceFailure_UserClarifies_RerunsLightDiscoveryBeforeGrill`：relevance 失敗進 clarification，回答後重跑 Light Discovery，再建立 Grill。
- `DeepStart_StaleGrillEvents_DoNotReopenGrill`：Deep 開始後的舊 Grill event 不得重開 Grill。
- `Extension_WhenDeepHandoffAwaits_ShouldCloseGrillBoundaryBeforeAwaitAndIgnoreStaleMessageEnd`：Deep handoff 在第一次 await 前關閉 Grill boundary，並忽略 stale `message_end`。
- `Extension_WhenRelevanceWaitUserReceivesConfirm_ShouldKeepClarificationPending`：relevance clarification 的 `/confirm` 不代替使用者回答，維持 `WAIT_USER`。
- `DebugCompletion_InvalidRoundOrEvidence_IsRejectedByFormalGate`：debug completion 的無效 round 或 evidence 由正式 gate 拒絕。
- `UserConfirmed_DiscoveryClarification_AllowsLightDiscovery`：Discovery clarification 回答後允許進入 Light Discovery。
- `Reset_NewGrillRound_UsesMonotonicRoundId`：reset 後新 Grill round 使用單調遞增 round ID。
- `NewSnapshot_FetchedEvidence_DoesNotLeakFromPreviousSnapshot`：新 snapshot 不會沿用上一 snapshot 的 fetched evidence。
- `ReadyForDeep_ExistingDiscoverySnapshot_IsReusedWithoutDuplicateReads`：READY_FOR_DEEP 沿用既有 discovery snapshot，不重複讀取相同證據。
- `SessionState_WhenNormalConfirmationIdCollidesWithRoundId_ShouldStillEnterGrill`：方案 A 的 round identity 允許新 round 重用相同 decision ID。
- `Extension_WhenNormalConfirmationIdCollidesWithRoundId_ShouldRejectReadyForDeepReplay`：方案 A 的 round identity 拒絕跨 round 的 READY_FOR_DEEP replay。

原計畫列出的測試已完成；複審另補回歸案例，涵蓋 Deep boundary cleanup、stale `message_end`、relevance `/confirm` 與方案 A round identity。

### 執行順序

1. 由測試子代理逐 slice 先建立紅燈。
2. 主代理依紅燈做最小 production 實作，不擴大 scope。
3. 由獨立驗證代理執行 focused、check 與完整 suite。
4. 由不同代理完成 Standards／Spec review，必要時只修正受影響範圍並重驗證。

### 驗證方式

不得在 repo root 跑 npm workflow；命令由獨立驗證代理執行：

```text
cd forge-runtime
npm test -- tests/extensions/forge-runtime-extension.test.ts tests/runtime/session-state.test.ts tests/workflow/state-machine.test.ts
npm run check
npm test
```

結果：`npm run check` 兩個 tsconfig 通過；`npm test` 157/157、0 fail、0 skip。證據：`forge-runtime/.tmp/grill-deep-final-check-20260824.log`、`forge-runtime/.tmp/grill-deep-final-test-20260824.log`。Standards／Spec final review 的 P0、P1、P2 均為 0。

### Rollback

回退此 ticket 的 5 個 production 與 5 個 test 修改，不涉及資料 migration；保留 ADR-0015 的決策歷史，若要重新設計須另開 ticket。

### 脆弱假設

runtime gate 與 active-stage guard 能阻止舊 Grill event 在 Deep 啟動後重新開啟 Grill；模型可能漏掉語意問題仍是 verifier 邊界，runtime 契約本身無法證明模型完整理解。若此假設失效，另開 verifier ticket，不在本計畫加入第二個 LLM evaluator。

### 交付狀態

已完成交付。未修改 `pi-main/`，未新增 dependency；完整 semantic Deep、Pattern Card、持久化 session 與第二個 verifier 仍屬 out-of-scope。

## Plan A：Deep Knowledge Retrieval／Understanding／Evidence Package

日期：2026-08-25

狀態：completed（以下保留設計階段的分 slice 記錄；最終收尾見本段末）

前置條件：`ADR-0015` 交接邊界已完成；`ADR-0016` 已 Accepted；使用者已確認 Q1 至 Q21，並撤回模型派發設計。

### 建置內容

- 以 Grill immutable snapshot 與已確認 decisions 作為 Deep 輸入；只接收 Grill 實際引用的完整 evidence，不重讀相同 evidence。
- 實作 `Deep Retrieval → Knowledge Understanding` 兩階段；Retrieval 可在 `wiki/`／`code_base/` 補查客觀缺口，Understanding 只能讀固定證據集合。
- 提供 `forge_deep_search`、`forge_deep_retrieval_complete`、`forge_deep_complete` 三個受 Workflow gate 控制的工具；每階段只啟用必要工具，結束／錯誤／取消時恢復原 tools。
- 產生並驗證 Evidence Package：`evidence`、`decisions`、`findings`、非阻擋 `limitations`；新增 evidence 使用新 ID 與 `origin`。
- Deep result 固定為 `completed`、`needs_decision`、`needs_discovery`；completed 通過 deterministic validator 後轉 `CONTEXT_BUILD`。
- 以 `attemptId + sourceRoundId + phase` 拒絕 stale call；技術失敗／取消保留輸入，`/continue` 以新 attemptId 重試。

### 不建置內容

- 不修改 `pi-main/`；不新增 dependency。
- 不做 `ForgeLlmRunner`、model policy、fallback、模型設定或 custom loop；直接沿用主 session active model。
- 不讓 Deep 直接詢問使用者；`needs_decision` 必須由 Workflow 建立 `WAIT_USER` round，證據整體不足則回 `LIGHT_DISCOVERY`。
- 不讀任意 local files、`docs/`、`Memory/`、`pi-main/`、Web 或外部 API；target source 只接受 Grill snapshot 已明確存在的檔案。
- 不做 Pattern Card、持久化、第二 LLM verifier、UI 或 Context／ADR／SPEC／Ticket 內容生成。

### 實作方式

先在 evidence engine 建立 package 與 validator，再在 session state 保存 Deep attempt identity，接著由 state machine 固定兩階段與結果分流，最後在 extension 串接主 session 工具輪次與工具 lifecycle。Grill snapshot 保持 immutable；Deep supplemental evidence 只以新 ID 附加到衍生 package。若出現新需求／取捨／矛盾，Workflow → `WAIT_USER`；若來源整體不足，Workflow → `LIGHT_DISCOVERY`。

### 已核准的 public test seams

- `createEvidencePackage({ inherited, supplemental, decisions, findings, limitations })` 自動標記 `origin`，合併順序固定為 inherited 後 supplemental；merge 不公開。
- `validateEvidencePackage(package)` 成功回傳 `{ ok: true }`，正常驗證失敗回傳 `{ ok: false, errors: string[] }`，不 throw。
- Evidence 欄位為 `evidenceId`、`kind: string`、`source`、`title`、`content`、`metadata: Record<string, unknown>`、`origin: "grill" | "deep_retrieval"`；limitation 為 `{ statement: string, blocking: boolean }`。
- Package 內 Evidence ID 必須唯一；每個 finding 至少一個引用且只能引用存在的 ID；blocking limitation 不得完成。retry 保留 `sourceRoundId`，只換 `attemptId`。
- 第一個測試固定為 `EvidencePackage_WhenInheritedAndSupplementalEvidenceMerge_ShouldPreserveOrigins`。完整決策以 [`ADR-0016`](adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md) 為準。
- 使用者於 2026-08-25 核准 Session State seam：Deep 狀態只放在 `ForgeSessionState`，沿用或擴充該 seam，不新增 UI state interface；方法命名留在最小實作細節。
- retry 保留 `sourceRoundId`、current input 與同 snapshot 的 supplemental evidence，只換 `attemptId`；cancel 清除 active attempt 但保留 current input；stale call 回傳可辨識結果而非 throw。
- 換成新 snapshot 時清除舊 supplemental evidence；snapshot 沿用 immutable object identity，不新增 hash 或持久化 ID。

### Workflow 分流核准（2026-08-25）

- `ForgeSessionState` 的唯一 public seam 為 `handleDeepResult(identity, result)`；`result` union 僅含 `completed`、`needs_decision`、`needs_discovery`。
- `completed`：Retrieval → Understanding；Understanding → `CONTEXT_BUILD`。
- `needs_decision`：建立全新 `WAIT_USER` round（`kind: deep_decision`、`roundId: attemptId`），保留 input／evidence，並使該 attempt 後續呼叫 stale；不得冒充 Grill round。
- `needs_discovery`：進入 `LIGHT_DISCOVERY` 並結束目前 attempt。
- technical failure 不進 result union，走 cancel／no-op，留在原 Deep phase 並保留 input 等待 `/continue`；stale 靜默不改 state。
- StateMachine 只增加合法轉移；Orchestrator 只映射 result，不持有 attempt／evidence。
- 補 public test seam 與第一個紅燈測試：`StateMachine_WhenRetrievalCompletes_ShouldEnterKnowledgeUnderstanding`。

### Deep 工具契約核准（2026-08-25）

- `forge_deep_search` 輸入 attempt identity、`query`、單一 `source: wiki | code_base | target`，每次最多 3 筆；target 僅接受 snapshot 中唯一匹配的明確 target source，缺失／多義回 `needs_decision`。supplemental ID 由 runtime 產生；已存在的 inherited／supplemental evidence 重用，不重讀、不重複。
- `forge_deep_retrieval_complete` 輸入 attempt identity 與 `completed | needs_decision | needs_discovery` outcome；completed 時 runtime 鎖定全部實際 inherited＋accepted supplemental evidence，模型不可任選，轉 Understanding；其他 outcome 走 `handleDeepResult`。
- `forge_deep_complete` 輸入 attempt identity 與同一 outcome；completed 時模型只提交 decisions/findings/limitations，runtime 注入 locked evidence 並驗證 Evidence Package，成功轉 `CONTEXT_BUILD`，invalid 不轉移；其他 outcome 走 `handleDeepResult`。
- Retrieval 只啟用 search＋retrieval-complete，Understanding 只啟用 deep-complete；完成、decision/discovery 或 cancel 後恢復原 active tools；無法安全限制時拒絕啟動 Deep。技術失敗走 cancel／no-op 並保留 input/evidence，stale 安靜忽略。

### 檔案範圍

production（最小 5 個既有檔案）：

- `forge-runtime/extensions/forge-runtime.ts`：Deep 三工具、主 session active model、工具啟用／恢復與 handoff。
- `forge-runtime/src/evidence/evidence-engine.ts`：Evidence Package 型別、合併與 deterministic validator。
- `forge-runtime/src/runtime/session-state.ts`：Deep attempt identity、snapshot 衍生 evidence 與 retry／cancel 保留規則。
- `forge-runtime/src/knowledge/discovery-engine.ts`：受限 Deep search 與 target source allowlist。
- `forge-runtime/src/workflow/state-machine.ts`：兩階段轉移、三種 Deep result 與 `CONTEXT_BUILD`／`WAIT_USER`／`LIGHT_DISCOVERY` 分流。

tests（4 個檔案）：

- `forge-runtime/tests/evidence/evidence-engine.test.ts`（NEW）
- `forge-runtime/tests/runtime/session-state.test.ts`（修改）
- `forge-runtime/tests/workflow/state-machine.test.ts`（修改）
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`（修改；沿用現有輕量 `registeredTools` harness，不啟動完整 TUI）

不修改 `pi-main/`，不把未追蹤的 `forge-runtime-flow.html`、`progress-timeline.html` 納入本 ticket。

### 測試

預期 baseline 為 157，新增 21 個測試後預期為 178；這是設計階段預估，實際收尾結果以本段「最終完成狀態」為準。以下測試名稱仍是驗收契約：

Evidence（4）：

- `EvidencePackage_WhenInheritedAndSupplementalEvidenceMerge_ShouldPreserveOrigins`
- `EvidencePackage_WhenEvidenceIdDuplicates_ShouldReject`
- `EvidencePackage_WhenFindingReferencesUnknownEvidence_ShouldReject`
- `EvidencePackage_WhenBlockingGapExists_ShouldRejectCompleted`

Session（4）：

- `SessionState_WhenDeepAttemptIdentityChanges_ShouldRejectStaleCall`
- `SessionState_WhenContinueRetriesDeep_ShouldIssueNewAttemptId`
- `SessionState_WhenDeepCancelled_ShouldPreserveCurrentInput`
- `SessionState_WhenSnapshotChanges_ShouldDiscardOldSupplementalEvidence`

State machine（5）：

- `StateMachine_WhenRetrievalCompletes_ShouldEnterKnowledgeUnderstanding`
- `StateMachine_WhenUnderstandingCompletes_ShouldEnterContextBuild`
- `StateMachine_WhenDeepNeedsDecision_ShouldCreateWaitUserRound`
- `StateMachine_WhenDeepNeedsDiscovery_ShouldEnterLightDiscovery`
- `StateMachine_WhenTechnicalFailureOccurs_ShouldRemainInDeep`

Integration（8）：

- `Integration_WhenDeepSearchUsesAllowedSources_ShouldReturnAtMostThreeEvidence`
- `Integration_WhenDeepSearchReusesGrillEvidence_ShouldAvoidDuplicateRead`
- `Integration_WhenRetrievalCompleteLocksEvidence_ShouldDisableSearch`
- `Integration_WhenUnderstandingUsesLockedEvidence_ShouldProducePackage`
- `Integration_WhenTargetSourceIsAmbiguous_ShouldNeedDecision`
- `Integration_WhenNewRequirementAppears_ShouldRouteWorkflowToWaitUser`
- `Integration_WhenDeepAttemptIsStale_ShouldRejectCompletion`
- `Integration_WhenPackageIsValid_ShouldTransferToContextBuild`

### 執行順序

1. 由測試子代理在核准的 `forge-runtime-extension.test.ts` 輕量 `registeredTools` harness 先建立上述 Integration 紅燈；主 context 不先修改 production code。
2. implementation 子代理只修改列出的 5 個 production 檔與必要測試 fixture，依紅燈做最小實作；不得修改 `pi-main/` 或未追蹤 UI 檔。
3. test／verification 子代理從 `forge-runtime/` 執行 focused tests、`npm test` 與 `npm run check`；implementation 代理不得兼任驗證。
4. review 子代理與 implementation／test 角色分離，完成 Standards／Spec review；若有 findings，只修正本 ticket 範圍後重新驗證。
5. 所有測試、check 與 review 證據完成後，才把本 ticket 狀態改為 completed 並更新 handoff。

### 驗證方式

由獨立驗證子代理從 `forge-runtime/` 執行：

```text
npm test
npm run check
```

（設計階段歷史快照）當時尚未執行，不能預先宣稱 178/178 或 check 通過；最終已記錄實際結果、exit code 與 log 路徑，詳見本段「最終完成狀態」。

### 脆弱假設

主 session active model 的既有工具輪次能在不新增 custom loop 的前提下，依階段切換三個 Deep tools 並可靠恢復原 tools；若實際 PI lifecycle 不支持，先停在設計衝突，不偷偷引入模型 adapter。另一個脆弱假設是 `target source` 可由 Grill snapshot 的明確檔案辨識；辨識不到時必須 `needs_decision`，不可猜路徑。模型語意完整性仍未由 runtime 證明，第二 verifier 另案處理。

### 回退方式（設計階段）

### 最終完成狀態（2026-08-25）

- 狀態：已實作、已驗證。Deep Retrieval／Understanding、Evidence Package 與五個公開工具已完成；未修改 `pi-main/`。
- 狀態模型：identity=`attemptId+sourceRoundId+phase`；retry 新 attempt、同 sourceRound、回原 Deep phase；cancel 保留 input／evidence，`continue` 回原 Deep phase，不回 Grill；stale outcome 優先 quiet reject；active-tools capability 對 active identity fail-closed。
- 人類決策：持久格式為 `問題：…；決定：…`，同 decisionId 首筆不可覆寫；Evidence Package 先注入 human decisions，模型 duplicate decisionId 拒絕。
- 安全上限：query 1500 Unicode code points；同 source／Grill round 8 次搜尋且 retry／cancel 不重設；單筆 evidence 256 KiB（讀檔前 stat，恰好上限可）；整輪 2 MiB，包含 Grill fetched＋Deep supplemental；decisions／findings／limitations 各 50；每段 statement 4,000 Unicode code points。超限在 state 寫入前拒絕且不改 state。
- 每次來源搜尋最多 3 個相關候選仍保留，這是呈現／候選上限，不是 Evidence Package 每類 50 筆的安全上限。Deep 不重讀 Grill fetched evidence；Evidence Package 要求 ID 唯一、finding 引用存在、blocking limitation 不可 complete。
- 驗證：初次 Deep 實作 `npm test` 208/208；identity handoff follow-up 完成後完整 209/209，`npm run check` exit 0；完整與 focused logs 已記錄於 `docs/handoff.md`。
- 下一步：由使用者在真實 PI session 重跑原始情境；目前未 commit、未 staged，無 production blocker。

### 首次 Grill→Deep identity handoff follow-up（2026-08-25）

本 follow-up 已完成實作與驗證：

1. 首次 Grill READY→Deep 建立 active identity 後，沿用既有 decision-retry 的 `pi.sendUserMessage(..., { deliverAs: "followUp" })` transport，送出含 `attemptId`、`sourceRoundId`、`phase` 的 identity-bearing invocation。
2. `forge-runtime/extensions/forge-runtime.ts` 的三個 caller 以 closure-local setter 傳遞 `pendingReplayInvocation`；`continueDeepKnowledge` 建立 attempt 後先設定 marker，再送出 followUp。
3. public seam 維持現有 `registeredTools`／harness；未修改 stale guard、tool schema、`pi-main/`，未加入 sequential 設定。

identity 不放入 tool details，Deep tools 不自取 identity。測試由 114 pass/1 fail（handoff undefined）修正為 115/0；聚焦 4/4；相關 147/147（`.tmp/deep-related-green-20260825.log`）；完整 209/209（`.tmp/deep-full-green-20260825.log`）；`npm run check` exit 0（`.tmp/deep-caller-check-20260825.log`）；final quick review 0 functional findings。尚未由使用者在真實 PI session 重跑原始情境，非 blocker。沒有 UI 工作，不建立 Plan B。

回退本 ticket 的 5 個 production 檔與 4 個 test 檔變更，不涉及 migration；保留 ADR-0015 與 ADR-0016 的設計歷史，若 runtime seam 不成立則回報具體衝突後另開設計修訂。

## Plan A Addendum：Deep stale-result loop（deep-stale-result-loop-20260826，修正前歷史快照）

日期：2026-08-26

狀態：`plan-approved-ready-for-red`（修正前歷史狀態）；本 ticket 已於 2026-08-27 完成自動化驗證，無 Plan B，因本 ticket 不做 UI 功能。

### Building

- 只修正 Deep Retrieval 完成結果因 identity followUp 尚未真正進入 agent loop 而反覆被 stale reject 的循環。
- Deep stage panel 使用 `deliverAs: "displayOnly"`；pending identity 保留到 matching user message 進入 `message_start` 才 consume；pending 期間 Deep tool-call gate 阻擋 Deep tools。
- 保留既有 identity、stale quiet reject、合法 Deep 後續與所有 Workflow 邊界。

### Not Building

- 不修改 Grill completion、WAIT_USER、cancel/retry/switch、relevance、state transition、snapshot 或合法 Deep 後續。
- 不處理 Grill `message_end` sibling risk；不新增 custom loop、sequential 設定、新狀態機、第二 verifier 或 UI 功能；不修改 `pi-main/`。

### Files

| 類別 | 檔案 | 預計變動 |
| --- | --- | --- |
| Production | `forge-runtime/extensions/forge-runtime.ts` | displayOnly panel、message_start identity gate、pending 期間 Deep tool-call gate |
| Tests | `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | 真實 PI agent-loop queue priority／followUp drain regression，先形成紅燈 |
| 文件 | `CONTEXT.md`、`docs/adr/ADR-0015-grill-deep-knowledge-handoff-boundary.md`、`docs/handoff.md`、本檔、`agent-state/deep-stale-result-loop-20260826.md` | 同步狀態與邊界 |

### Tests

- 測試代理先補 regression，必須覆蓋 `steer` 優先於 followUp、followUp 延後 drain，以及 pending identity 期間 Deep tools 不可用。
- 先執行測試確認舊程式碼紅燈；主代理確認紅燈後才改 production。驗證代理再執行 targeted、完整 suite 與 check。

### Verification

- RED：新 regression 在舊程式碼失敗，且失敗證據寫入 agent-state／log。
- GREEN：targeted regression 通過；完整 suite 與 `npm run check` 通過；確認未修改 `pi-main/` 且既有合法 Deep／WAIT_USER／cancel/retry/switch 路徑未退化。

### 最後驗證與工作樹狀態（2026-08-25）

- 工作期間 HEAD 由外部移至並同步 `origin/main` 的 `324501a0412bbfdead9642aeb845bb26192b57cc`，不是本代理 commit；目前本 ticket 剩九檔 tracked 修改未提交。
- 隔離 detached worktree 只套用九檔 diff 後，`npm run check` exit 0，四個關鍵測試均 4/4 exit 0；logs：`forge-runtime/.tmp/deep-isolated4-check-20260825.log`、`forge-runtime/.tmp/deep-isolated4-targeted-20260825.log`。主工作樹 full 仍 209/209。
- 未解仍只有使用者尚未在真實 PI session 重跑原始情境。

---

## Plan A Addendum：Deep identity handoff activation（deep-followup-identity-activation-20260826）

日期：2026-08-26

狀態：implemented-and-verified。

### Building

- 修正 Grill completion 建立 Deep attempt 後，工具啟用早於 identity-bearing followUp 進入 `input` 的時序缺口。
- 只有在既有 `pi.on("input", ...)` exact pending replay invocation 條件命中、且已清除 `pendingReplayInvocation` 後，才啟用 Deep Retrieval tools，接著沿用 `{ action: "continue" }`。
- 保留 identity 三元組、stale quiet reject、followUp transport、主 session 與既有 verifier。

### Not Building

- 不修改 `pi-main/`。
- 不把 identity 放入 completion tool result；不新增 custom loop、sequential 設定、新狀態機或 UI。
- 不做 Plan B；不處理 Grill `message_end` 含 toolCall 的文字清除 sibling risk。

### Approach

`forge_grill_complete` 只建立 attempt 與排入 identity-bearing followUp，不在當下直接啟用 Deep Retrieval tools。既有 input handler 收到 exact pending replay invocation 時，採一次性 gate：先清 marker，再啟用工具，最後回傳 `{ action: "continue" }`。在 gate 開啟前 Deep tools 保持不可用，舊 identity 事件維持既有 stale quiet reject。

最脆弱假設已驗證：test harness 的 followUp bridge 會在下一次模型推論前重入 input handler；exact marker 可作一次性 gate。

### Files

| 類別 | 檔案 | 預計變動 |
| --- | --- | --- |
| Production | `forge-runtime/extensions/forge-runtime.ts` | 延後 Deep Retrieval tool activation 至 exact pending replay invocation；其餘 lifecycle 不變 |
| Tests | `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | 新增兩個 handoff timing regression |

### Tests

- `Extension_WhenGrillCompletionQueuesDeepIdentity_ShouldEnableDeepToolsOnlyAfterFollowUpStarts`
- `Extension_WhenDeepHandoffIsPending_ShouldKeepDeepToolsUnavailableAndIgnoreStaleEvent`

### Execution Order

1. 測試代理先新增第一個回歸測試，實際執行並確認舊程式碼有效紅燈。
2. 主代理確認紅燈後，才修改 `forge-runtime/extensions/forge-runtime.ts` 的最小 production seam。
3. 驗證代理依序執行 targeted tests、`npm test`、`npm run check`；不得由實作角色兼任驗證。

### Verification

```text
# 僅由獨立驗證子代理執行
cd forge-runtime
npx tsx --test tests/extensions/forge-runtime-extension.test.ts
npm test
npm run check
```

基線依既有 handoff 為 209/209；新增 2 個測試後實際為 211/211。

### Plan B

不做 Plan B。本 ticket 是純 runtime 工具啟用時序修正，沒有 UI／View 變更。

### 最終完成狀態（2026-08-26）

- 已將 Deep Retrieval activation 從 `continueDeepKnowledge` 延後至 exact `pendingReplayInvocation` input gate；gate 先清 marker，再啟用 Deep Retrieval tools，並沿用 `{ action: "continue" }`。
- 新增 2 個 timing regression；targeted 117/117、完整 `npm test` 211/211、`npm run check` exit 0。
- 本輪未發現新 bug。未解風險僅保留 Grill `message_end` 含 toolCall 的未證實 sibling risk，以及真實 PI session 尚未重跑的既有非 blocker；兩者均不擴大本 ticket。

### Final review medium finding 修正（2026-08-26）

- `requireDeepToolBoundary` 必須同時具備 tool boundary 與 `sendUserMessage`，才能完成 Deep handoff；若無法送出 identity-bearing followUp，維持未完成，不進入半完成狀態。
- 修正後驗證：targeted 117/117、`npm test` exit 0、`npm run check` exit 0；本輪未發現新 bug。

## Plan A：Deep 階段輸出守門（deep-stage-output-guard-20260826）

日期：2026-08-26

狀態：implemented-and-verified

### Building

- 在 Deep 有 active attempt 且 stage 為 `DEEP_KNOWLEDGE_RETRIEVAL` 或 `KNOWLEDGE_UNDERSTANDING` 時，移除 `message_update`／`message_end` 的 assistant `text`／`thinking`，保留合法 `toolCall`。
- 明確固定 Deep Retrieval／Knowledge Understanding 只整理與驗證後續實作所需證據，不在此階段開始實作。

### Not Building

- 不沿用 Grill recovery，不影響 `WAIT_USER`、Deep cancel 後或後續階段。
- 不改 Deep active tool 清單（write/edit 類工具本來已排除）、不新增 Plan B、不修改 `pi-main/`。

### Files

- Production：`forge-runtime/extensions/forge-runtime.ts`。
- Tests：`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`（驗證 active Deep transition 後的 text/thinking 預期為空）。
- 設計與交接文件：`CONTEXT.md`、`FORGE_RUNTIME_Arch_v4.md`、`docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md`、本檔、`docs/handoff.md`、`agent-state/deep-stage-output-guard-20260826.md`。

### Tests

- 測試子代理先新增紅燈：assistant message 含 `FORBIDDEN_IMPLEMENTATION_MARKER` 時，現況測試必須因 marker 仍留在 assistant message 而失敗。
- `forge-runtime/tests/extensions/pi-grill-interactive.test.ts` 驗證 active Deep transition 後 assistant `text`／`thinking` 為空，且保留合法 `toolCall`。
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 驗證 active Deep transition 的 `text`／`thinking` 空字串預期。

### Execution Order

1. 測試子代理先修改 `forge-runtime/tests/extensions/pi-grill-interactive.test.ts` 與 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`，並執行 focused tests，確認有效紅燈。
2. 紅燈確認後，主代理只對 `forge-runtime/extensions/forge-runtime.ts` 做最小修正。
3. 驗證子代理先跑既有單檔 interactive test，再跑相關 regression；implementation 與驗證角色分離。

以上執行順序已完成；紅燈、最小 production 修正、相關回歸、完整 suite、type check 與 production review 均有下方收尾證據。

### Verification

```text
cd forge-runtime
npx tsx --test tests/extensions/pi-grill-interactive.test.ts
npm test
```

最脆弱假設：PI 的 message event 仍允許保留 toolCall、只移除 assistant text／thinking；若 event shape 不符，先回報契約衝突，不擴大成新的 recovery 或 custom loop。

### Execution Result（2026-08-26）

- 根因確認：`forge-runtime/extensions/forge-runtime.ts` 的 assistant prose guard 只覆蓋 Grill；Deep active 後未在 `message_update` 與 `message_end` 同時攔 `text`／`thinking`。
- 實作完成：新增 `hasActiveDeepAttempt`；Deep Retrieval／Understanding active attempt 的串流清空 `text`／`thinking`，final message 只保留合法 `toolCall`。
- TDD 證據：`PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue` 先以 `FORBIDDEN_IMPLEMENTATION_MARKER` 形成紅燈（exit 1），修正後 targeted 9/9。修正 retrieval／understanding fixture schema 與一個過時 transition assertion 後，`npm test` 209 passed/0 failed/0 skipped，`npm run check` exit 0。
- 修改測試：`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。production review 零 functional findings，scope on target。
- 未解風險：Grill 的 `message_end` 含 toolCall 分支仍依賴 `message_update` 先清文字，尚未由本 ticket 證實；不擴修。
- Context／ADR／Spec／Ticket／Planning 尚未串成 runtime flow：這是本 ticket 範圍外的後續風險，不影響 `deep-stage-output-guard` 已完成；未來若啟用該串接，另開 ticket 建立各階段輸出契約。

## Plan A：Deep stale-result loop（deep-stale-result-loop-20260826）收尾

日期：2026-08-27；狀態：implemented-and-automated-verified-awaiting-real-session。

- 目標僅為修正 stale completion 循環：stage panel 改 `displayOnly`；input 只預載 Deep tools；matching user `message_start` 才 consume pending identity；pending 期間阻擋 Deep tool_call。
- 真實 AgentSession／InteractiveMode／faux provider regression：未修版 RED 1 fail，修正版 GREEN 1 pass，後續合法 Deep search accepted；TUI 以 `waitForScrollBuffer` 驗證 stage。
- extension targeted 117/117、PI integration 10/10、完整 `npm test` 212/212、`npm run check` exit 0。未修改 `pi-main/`，不改其他 workflow；殘餘風險另行記錄，下一步只有使用者重跑真實 PI session。

## Plan A：Deep target source contract（deep-target-source-contract-20260827）

日期：2026-08-27；狀態：implemented-and-verified。

### Building

- 從既有 `workflow.snapshot.candidates` 在 Deep follow-up 列出允許的 target manifest，空清單也明確呈現。
- 讓 `forge_deep_search` 依 `source` 使用 discriminated union：target 必填 `targetSource`，wiki／code_base 不要求。
- handler 對 target 缺檔名回 retryable invalid，保留 attempt 與 budget；明確但無唯一匹配維持 `needs_decision`。
- stale Deep sibling 回傳 `terminate: true`。

### Not Building

- 不修改 `pi-main/`、`session-state.ts`、snapshot 契約或合法 Deep 後續。
- 不自動選 target、不加入 sequential、custom loop、migration 或新依賴。

### Approach

以 [`ADR-0017`](adr/ADR-0017-deep-target-source-contract.md) 為契約唯一真相來源，沿用既有 snapshot 與 handler guard。Fragile assumption 是 PI/provider 能正確使用 discriminated union，因此 runtime guard 不可省略。rollback 為還原單一正式程式檔。

### Files

- Production：`forge-runtime/extensions/forge-runtime.ts`。
- Tests：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。
- 文件：本檔、`CONTEXT.md`、`docs/handoff.md`、`docs/adr/ADR-0017-deep-target-source-contract.md`、ticket、agent-state、Memory 兩檔。

### Tests

先由測試子代理打 RED，主代理確認紅燈後才修改 production code；之後由不同測試子代理執行驗證。新增 5 個測試：

- `Extension_DeepSearchTargetWithoutTargetSource_ShouldRejectBeforeBudgetAndKeepAttempt`：斷言 retryable invalid、不進 WAIT_USER、attempt／budget 保留。
- `Extension_DeepRetrievalFollowUp_ShouldCarryTargetManifestIncludingEmptyList`：斷言 follow-up 含既有 manifest，空清單仍明確存在。
- `Extension_DeepSearchTargetSourceUnmatched_ShouldEnterWaitUser`：斷言明確但無唯一匹配轉 `WAIT_USER`。
- `Extension_DeepSearchStaleSibling_ShouldTerminate`：斷言 stale sibling 的 `terminate` 為 `true`。
- `Extension_DeepSearchWikiAndCodeBase_ShouldRemainUnaffected`：斷言 wiki／code_base 不要求 targetSource。

五個指定情境測試均通過；完整 `npm test` `217/217`（`forge-runtime/.tmp/post-schema-test.log`）；0 failed。

### Execution Order

1. 新 session 先讀 handoff、CONTEXT、ADR-0017、ticket 與 agent-state，展示摘要並等使用者確認。
2. 測試子代理新增 5 個測試並執行 targeted test，確認 RED。
3. 主代理確認 RED 後，只修改 `forge-runtime/extensions/forge-runtime.ts`。
4. 不同測試子代理執行 targeted test、完整 `npm test` 與 `npm run check`。

### Verification

從 `forge-runtime/` 執行：

```text
npx tsx --test tests/extensions/forge-runtime-extension.test.ts
npm test
npm run check
```

實際驗證：五個指定情境測試均通過；完整 `npm test` `217/217`（`forge-runtime/.tmp/post-schema-test.log`）；`npm run check` exit 0（`forge-runtime/.tmp/post-schema-check.log`）；Standards／Spec re-review PASS。僅有 Node `DEP0190` 非阻塞警告。下一步為使用者檢閱與決定提交；本文件不捏造 commit。

## Plan A：Deep completion stale termination（deep-completion-stale-termination-20260828）

日期：2026-08-28；狀態：`implemented-verified-reviewed`；路徑：direct Plan A；不建立 Plan B。

### 建置範圍

- 在 `forge-runtime/extensions/forge-runtime.ts` 補齊 `forge_deep_retrieval_complete` 與 `forge_deep_complete` 共六個 stale return 的 `terminate: true`。
- 保持每個 active Deep attempt 最多接受一個 `needs_decision`；接受後進 `WAIT_USER` 並清 attempt。同 identity 後續 completion stale、不改 state、立即 terminate。
- 使用者回答保留 `sourceRoundId`／`phase`、建立 fresh attempt；fresh attempt 可再次成功進入 `needs_decision`。

### 不建置範圍

- 不修改 `session-state.ts`、`pi-main/`、Grill、`CONTEXT_BUILD`、UI、schema/API、scheduler 或其他 helper；不新增依賴、不做 Plan B。

### 檔案

- Production：`forge-runtime/extensions/forge-runtime.ts`。
- Tests：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。
- 文件：`CONTEXT.md`、本檔、兩份 Deep ADR、`docs/handoff.md`、ticket、agent-state、Memory 兩檔。

### 測試

先由獨立測試子代理新增／擴充測試並打紅燈，主代理確認 RED 後才做最小 production 修改；驗證由不同子代理執行。既有 stale Retrieval／Understanding 測試與新增測試共同鎖定下列六個 production 分支：

| 階段 | stale 分支 | Production file:line | 預期結果 | 測試方式 |
| --- | --- | --- | --- | --- |
| Retrieval | 入口 identity guard | `forge-runtime/extensions/forge-runtime.ts:944` | `status=stale`、`terminate=true`；不改 state/tool | 既有 stale Retrieval contract 測試，補斷言 `terminate=true` |
| Retrieval | `handleDeepResult` dispatch 後 | `forge-runtime/extensions/forge-runtime.ts:974` | `status=stale`、`terminate=true`；不改 state/tool | production inventory/review + 既有可觀測 stale contract 測試 |
| Retrieval | `completeDeepRetrieval` state commit 後 | `forge-runtime/extensions/forge-runtime.ts:1001` | `status=stale`、`terminate=true`；不改 state/tool | production inventory/review + 既有可觀測 stale contract 測試 |
| Understanding | 入口 identity guard | `forge-runtime/extensions/forge-runtime.ts:1123` | `status=stale`、`terminate=true`；不改 state/tool | 既有 stale Understanding contract 測試，補斷言 `terminate=true` |
| Understanding | `handleDeepResult` dispatch 後 | `forge-runtime/extensions/forge-runtime.ts:1150` | `status=stale`、`terminate=true`；不改 state/tool | production inventory/review + 既有可觀測 stale contract 測試 |
| Understanding | `handleDeepResult` completed state commit 後 | `forge-runtime/extensions/forge-runtime.ts:1193` | `status=stale`、`terminate=true`；不改 state/tool | production inventory/review + 既有可觀測 stale contract 測試 |

同步 harness 無法穩定製造 dispatch／commit 中途 race；上述兩個新增測試驗證 fresh attempt 的可觀測 contract，六分支則以 production inventory／review 鎖定，不新增 artificial seam，也不宣稱逐分支動態命中。

新增：

- `Extension_WhenRetrievalNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt`
- `Extension_WhenUnderstandingNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt`

每個新測試覆蓋第一次 decision→`WAIT_USER`→清 attempt、舊 identity stale+terminate、使用者回答建立 fresh attempt、fresh attempt 再 `needs_decision` 成功；沿用既有 valid completion positive tests。基線 217，預期新增 2 後為 219。

### 驗證

Focused：

```text
cd forge-runtime
npx tsx --test tests/extensions/forge-runtime-extension.test.ts
```

完整：

```text
cd forge-runtime
npm test
npm run check
```

真實 PI smoke：第一個 decision 後不再連續 stale；使用者回答後下一個 decision 仍正常。Fragile assumption：若同批混有其他非 terminate 工具結果，PI 的 `every(terminate)` 仍可能繼續；本 ticket 不修改 scheduler。Rollback 為撤回本 ticket code／test／docs，無 migration。

### 2026-08-28 實作與驗證結果

Plan A 已獲核准並完成。兩個 public fresh-attempt regression 先紅 `terminate undefined` 後綠；六個 completion stale return 均補上 `terminate: true`。四個 inner branch 因同步防禦路徑無公開 deterministic seam，不新增私有 mock／test hook。

驗證：focused 124/124、full 219/219、`npm run check` pass。證據：`forge-runtime/.tmp/final-focused-test.log`、`forge-runtime/.tmp/final-full-test.log`、`forge-runtime/.tmp/final-check.log`。PI smoke：`.\pi-main\pi-test.bat --approve` 成功啟動，真實模型回 `smoke ok`、exit 0；log：`forge-runtime/.tmp/pi-smoke.log`。未改 `session-state.ts`、scheduler、UI、schema/API、`pi-main/`；mixed tool batch `every(terminate)` 風險仍不在 scope。Review 已完成，可交付／提交。

## Plan A：Deep retryable recovery contract（deep-recovery-contract-20260828）

日期：2026-08-28；狀態：`implemented-verified-reviewed`；只有 Plan A，沒有 Plan B。

### Building

- 空 target manifest（`manifest=[]` 且 `source=target`）回 retryable invalid，保留相同 `attemptId`／`sourceRoundId`／`phase`，不進 `WAIT_USER`，要求模型自行改用 `wiki`／`code_base`。
- duplicate `decisionId` 維持拒絕、不靜默去重；Evidence Package validator 只有錯誤包含 `決策 ID 重複` 時回 `retryable:true`，保留同一 `KNOWLEDGE_UNDERSTANDING` attempt，以相同 identity 重送修正後唯一 IDs。其他 validation failure 不因本 ticket 自動標 retryable。
- invalid／rejection 不推進 stage、不寫 Evidence Package、不進 `CONTEXT_BUILD`；既有 stale guard 保留。

### Not Building

- 不自動選 source／target、不自動 fallback、不接受 basename 模糊匹配。
- 不修改 `session-state.ts`，除非 RED 證明 extension seam 不足並回報 blocker；不改 `pi-main/`。
- 不新增 API／schema／UI／scheduler、snapshot 欄位、custom loop、依賴或 Plan B。

### Approach

以 [`ADR-0018`](adr/ADR-0018-deep-retryable-recovery-contract.md) 為 recovery 契約唯一真相來源，在既有 extension handler seam 加上最小 guard／retryable response；attempt identity 與 target allowlist 沿用 ADR-0016／0017。只要 invalid 路徑能被 extension seam 完整表達，就不擴大到 state layer。

### Files

| 類別 | 檔案 | 預計變動 |
| --- | --- | --- |
| Production | `forge-runtime/extensions/forge-runtime.ts` | 空 manifest target recovery、duplicate decision recovery |
| Tests | `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | 五個指定回歸測試 |

### Tests

- `Extension_DeepSearchEmptyTargetManifest_ReturnsRetryableInvalidWithoutWaitUser`：斷言 retryable invalid、相同 identity 保留、stage 仍為 `DEEP_KNOWLEDGE_RETRIEVAL`、未建立 `WAIT_USER`、未扣 target budget。
- `Extension_DeepSearchAfterEmptyTargetManifest_UsesExplicitWikiOnSameAttempt`：以同一 identity 呼叫明確 `source=wiki`，斷言搜尋成功、未建立新的 attempt／WAIT_USER，且結果可供 retrieval complete。
- `Extension_DeepCompleteDuplicateDecision_ReturnsRetryableInvalidWithoutStateAdvance`：斷言 retryable invalid、同一 understanding attempt 保留、既有 decisions 不變、stage 不變、未寫 `CONTEXT_BUILD`。
- `Extension_DeepCompleteCorrectedDecision_ReusesAttemptAndEntersContextBuild`：以同一 identity 重送唯一修正 IDs，斷言 Evidence Package 驗證成功並進入 `CONTEXT_BUILD`。
- `Extension_DeepRecoverySequence_ReachesContextBuildWithoutWaitUserLoop`：串起空 target invalid→同 attempt 明確 wiki→duplicate invalid→同 attempt 唯一修正，斷言沒有 `WAIT_USER` loop，最後進入 `CONTEXT_BUILD`。

實作前基線與目標：extension file 實作前基線 `124/124`，新增 5 後目標 `129/129`；排除 `pi-grill-interactive.test.ts` 的本地 suite 實作前基線 `209/209`，新增後目標 `214/214`。標準 `npm test` 實作前基線 `209 pass/1 fail`，唯一既存失敗為缺 `pi-main/packages/ai/src/providers/data/qwen-token-plan-individual.json`；`npm run check` 實作前基線因 10 個 `InteractiveModeOptions` terminal 型別錯誤與 pi-main 既存缺依賴失敗。不得宣稱 full/check 全綠；本 ticket 只要求不新增新失敗並保留 baseline。

### Execution Order

1. 新 session 第一步讀取 `docs/handoff.md`、`CONTEXT.md`、ADR-0018、ticket 與 agent-state，展示摘要並等待使用者確認。
2. 獨立測試子代理先新增五個測試並執行 targeted test，確認舊程式碼有效 RED；測試角色不得兼任 implementation 或 final review。
3. 主代理確認 RED 後，才對 `forge-runtime/extensions/forge-runtime.ts` 做最小 production 實作；若 extension seam 不足，停止並回報 blocker，不預先改 `session-state.ts`。
4. 另一個獨立驗證／review 角色執行 targeted suite、baseline-aware checks 與 final review；不得由 implementation 角色兼任。

### Verification

- 以五個指定測試確認 recovery contract、identity 保留、state 不前進、無 `WAIT_USER` loop 與最終 `CONTEXT_BUILD`。
- 保留並報告 baseline：extension `124/124`→目標 `129/129`；本地排除 interactive suite `209/209`→目標 `214/214`；標準 `npm test` 與 `npm run check` 的既存失敗不得被誤報為本 ticket 新失敗。
- 真實 PI 原情境列人工驗收：重現空 manifest、wiki retry、duplicate decision、最終進入 `CONTEXT_BUILD`。

### Fragile assumption

假設 extension handler 能在不改 `session-state.ts` 的情況下保留 attempt、回傳 retryable invalid 並接受同 identity 重送；若 RED 證明不成立，回報具體 seam blocker，停止擴大修改。

### Rollback

撤回本 ticket 的 `forge-runtime/extensions/forge-runtime.ts` 與 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 變更；不涉及 migration、snapshot 回填或其他外部狀態。

### 實作與驗證收尾

- Production 僅修改 `forge-runtime/extensions/forge-runtime.ts`；空 target manifest 在共用 ambiguity branch 前回 retryable invalid，要求模型改用 `wiki`／`code_base`，不呼叫 `handleDeepResult`；Evidence Package validator 只有 rejection 錯誤包含 `決策 ID 重複` 時增加 `retryable:true`，其他 validation failure 維持原回應；既有 validator、stale guard、state advance 保留。
- Tests 僅修改 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`，五個指定測試均已完成。第一 RED：舊碼回 `needs_decision`；第二 RED：duplicate invalid 的 `retryable` 未定義。focused GREEN 129/129；排除 `pi-grill-interactive` 的本地 suite 214/214。
- 標準 `npm test` 為 214 pass/1 fail，唯一既存失敗為缺少 `pi-main/packages/ai/src/providers/data/qwen-token-plan-individual.json`；`npm run check` exit 2、38 errors，包含 10 個既存 `InteractiveModeOptions.terminal` 與其餘 pi-main 既存依賴／型別問題。不得宣稱 full/check 全綠。測試型別修正後 `tsc` exit 0。
- 證據 logs：`forge-runtime/.tmp/deep-recovery-red-1.log`、`deep-recovery-red-2.log`、`deep-recovery-focused-green.log`、`deep-recovery-local-suite-rerun.log`、`deep-recovery-npm-test.log`、`deep-recovery-check-rerun.log`、`deep-recovery-test-type-green.log`。
- 初次 review findings 均已修正並保留為歷史：Standards P1 durable state；P2 重複 setup，已抽為單一 `prepareDeepRetrieval` helper。Spec P1 budget coverage，已補至少 9 次 empty target 仍回 `target_manifest_empty`；P1 retryable 過寬，已縮到 duplicate error；P2 stale state；Plan A P2 基線標示，已將 209 pass/1 fail 明確標為實作前基線。
- Review-fix RED：`forge-runtime/.tmp/deep-recovery-review-red.log`。Final test refactor 後 extension 129/129（`forge-runtime/.tmp/deep-recovery-final-refactor-focused.log`）；本地排除 `pi-grill-interactive` 214/214（`forge-runtime/.tmp/deep-recovery-review-local.log`）；標準 `npm test` 214 pass/1 fail 且唯一 qwen 缺檔（`forge-runtime/.tmp/deep-recovery-review-npm-test.log`）；final `npm run check` 38 個既存 baseline errors，沒有錯誤指向本 ticket 修改的 `forge-runtime.ts` 或 `forge-runtime-extension.test.ts`（`forge-runtime/.tmp/deep-recovery-final-check.log`）。`pi-grill-interactive.test.ts` 不是本 ticket 修改檔。
- 最終雙軸 re-review：Standards P0/P1/P2=0；Spec P0/P1/P2=0。
- 未改 `session-state.ts`、`pi-main`、API/schema/UI/scheduler/snapshot；未新增依賴、Plan B、自動 fallback 或模糊 matching。真實 PI 原情境人工驗收尚待完成；其後由使用者決定是否提交。Node `DEP0190` 為非阻塞 warning。

## Plan A：Deep mixed-tool batch termination barrier（deep-mixed-tool-batch-termination-20260829）

日期：2026-08-29；狀態：`implemented/verified-with-existing-workspace-caveats`；只有 Plan A，沒有 Plan B。

### Building

- 在 awaited assistant `message_end` 讀取完整 tool-call IDs，建立 extension-local ephemeral `DeepRetrievalBatch`：`searchCallIds`、`completionCallIds`、`settledSearchCallIds`、`mixed`、`followUpQueued`。
- mixed search+completion 時，completion 按 call ID deterministic retryable reject、`terminate=true`、保留 identity、不轉 stage；current-identity search 成功／失敗均 `terminate=true`，所有 search settle 後只 queue 一個同 identity follow-up。
- 下一個 completion-only batch 才接受並正常 stage transition；stale／route 後不得 duplicate follow-up。prompt guidance 區分 `needs_decision` 與 `needs_discovery`，kind 是唯一正式 route。

### Not Building

- 不修改 `pi-main`、`@earendil-works/pi-telemetry`、PI scheduler 的 `every(terminate)`、`session-state.ts`、public schema/API、snapshot 或依賴。
- 不解析 `decisionSummary` 自由文字、不建立 semantic gate／public discriminant、不做 UI 變更、不建立 Plan B。

### Approach

以 [`ADR-0019`](adr/ADR-0019-deep-mixed-tool-batch-termination-barrier.md) 為唯一真相來源；使用 extension transport lifecycle 與 call ID 做 barrier，讓 PI scheduler 保持不變。已由 AgentSession/faux-provider RED 證明問題，再完成最小 production change；extension seam 足夠，未修改 `pi-main`。

### Files

| 類別 | 檔案 | 預計變動 |
| --- | --- | --- |
| Production | `forge-runtime/extensions/forge-runtime.ts` | batch barrier、retryable mixed reject、settle/follow-up、prompt guidance |
| Tests | `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | contract regressions |
| Tests | `forge-runtime/tests/extensions/pi-grill-interactive.test.ts` | AgentSession/faux-provider parallel mixed batch integration |

### Tests

先由獨立測試子代理新增並跑 RED；測試、實作、驗證、final review 不得由同一角色兼任。新增 6 個 PascalCase 測試：`Extension_WhenSearchAndCompletionShareBatch_ShouldRejectCompletionWithoutTransition`、`Extension_WhenMultipleCurrentIdentitySearchesSettle_ShouldTerminateAllAndQueueOneFollowUp`、`Extension_WhenCompletionOnlyBatchReplays_ShouldAcceptOnce`、`Extension_WhenStaleOrRouteChangedBatchSettles_ShouldNotQueueDuplicateFollowUp`、`Extension_PromptGuidance_ShouldDistinguishDecisionFromDiscovery`、`AgentSession_WhenParallelMixedDeepBatchRuns_ShouldApplyBarrierEndToEnd`。

期待既有 full baseline `219` 加 6 為 `225 passed / 0 failed`；若 baseline 已變，先記錄新 baseline，再維持新增 6。從 `forge-runtime` 執行既有文件已記錄的 exact targeted／full／check commands，不發明新命令。PI 原生完整測試不是 gate；Forge contract tests 與真實 AgentSession/faux-provider integration 是自動 gate；真實 PI session 是發布前人工 gate。

### Execution Order

1. 新 session 先讀 handoff、CONTEXT、ADR-0019、ticket、agent-state、Memory 兩檔，檢查 git status/diff，展示摘要並等待使用者確認。
2. 確認後呼叫 `execute-designed-plan`；獨立測試角色新增 6 測試並執行 RED，證明 unfixed code 失敗。
3. implementation 角色確認 RED 後，只改 `forge-runtime/extensions/forge-runtime.ts`；若 seam 不足，停止並回報 blocker。
4. 獨立驗證角色執行 targeted、full、check 與 integration gate；另一獨立 final review 角色檢查 Standards／Spec。

### Verification

檢查 mixed completion 不 transition、search 全 terminate、follow-up 恰好一次、completion-only replay 一次、stale/route 不重複、prompt guidance 與 AgentSession parallel batch。真實 PI 原情境列發布前人工驗收；PI 原生完整測試不是本 bug gate。

### Fragile assumption

PI 維持 awaited `message_end` before tools 與穩定 tool-call IDs；若上游改變，AgentSession integration test 必須失敗。語意分類的 deterministic semantic gate／public discriminant 為獨立未授權風險。

### Rollback

移除 extension barrier／prompt changes 與兩個指定測試檔的本 ticket 變更；不涉及資料 migration。

## Plan A Addendum：移除自動 Deep 階段面板發布（2026-08-29）

工作項目：`deep-auto-deep-panel-removal-20260829`。狀態：`implemented/verified-with-existing-workspace-caveats`；只有 Plan A，沒有 Plan B。

### 決策

使用者已核准不修改 `pi-main`，刪除 `continueDeepKnowledge` 在自動進入 Deep 前的 `await publishState(..., { deliverAs: "displayOnly" })`。該呼叫只產生 UI side effect；在目前 PI delivery union 不可靠辨識 `displayOnly` 的前提下，可能被當成會觸發模型回合的訊息，干擾正式 Deep follow-up 時序。

### 保留範圍

只移除自動進入 Deep 的階段面板發布。保留 `WAIT_USER`、recovery、confirmation panel、session state、active tools、pending fail-closed gate、status 與其他既有 UI；需要人類決策的流程不得因此消失面板。

### TDD 與執行順序

1. 已先新增或調整 regression 形成 RED，再以最小 production change 修正；測試未放寬正式 gate，也未改 `pi-main`。
2. RED→GREEN 後移除 `forge-runtime/extensions/forge-runtime.ts` 的多餘自動 Deep `sendMessage`／`publishState(...displayOnly...)`；保留 `ctx.ui.setStatus(buildWorkflowStatusText(nextState))`，不新增 delivery contract、不修改 scheduler、session state、工具 schema 或其他 UI。
3. 獨立驗證已完成；結果與 workspace caveat 見下段。

### Files

| 類別 | 檔案 | 預計變動 |
| --- | --- | --- |
| Production | `forge-runtime/extensions/forge-runtime.ts` | 移除自動 Deep 前的單次階段面板 `publishState` 呼叫 |
| Tests | 既有對應 extension／AgentSession 測試檔 | 只補足回歸證據，不改正式流程語意 |
| 不修改 | `pi-main/` | 維持上游原始碼不變 |

### 驗證與風險

驗證已完成：auto-panel unit 1/1、AgentSession after-status 1/1、三個受影響 tests 3/3、extension isolated `tsconfig.json` 67/67。`npm run check` exit 2，但 production 0 錯誤、本 ticket test 1199 後 0 錯；既有 TUI terminal 10 錯與 pi-main highlight.js 21 錯。完整 pi-grill 受既有 TUI 兩個失敗阻斷，故狀態為 `implemented/verified-with-existing-workspace-caveats`；本 ticket targeted 通過。較早 pi-config 134/134 是 status 修正前結果，不列為最終證據；最後 pi-config log 只有逐項 ✔、沒有 summary。

## Plan A Addendum：WAIT_USER UI-only state publication（2026-08-29）

工作項目：`wait-user-ui-only-state-publication-20260829`。狀態：`implemented/verified-with-existing-workspace-caveats`；只有 Plan A，沒有 Plan B。

### Decision

WAIT_USER 的 workflow state、selector、custom editor、使用者 followUp 與 `setStatus` 均保留；停止 `publishState()` 內 `pi.sendMessage` 的 `forge-stage` custom message 投遞。原因是 PI current 與官方 0.84.3 只支援 `steer`、`followUp`、`nextTurn`，未知 `displayOnly` 在 streaming 會落入 `steer`。不新增 UI、core delivery contract、persistence 或替代通道。

### Building

- 先由獨立測試子代理新增 regression 並跑出 RED，再由實作角色做最小刪除，最後由 review 角色收尾。
- 最小 production change 只移除 WAIT_USER `publishState` 的 `pi.sendMessage` 行為；保留 `setStatus`、WAIT_USER、selector、custom editor 與回答後 followUp。

### Not Building

- 不修改 `pi-main`、全域 PI、project `.pi`、state machine、Deep、setStatus 參數 bug、`warn`／`warning`、recovery 重做或替代 persistence。
- 不修改已完成的自動 Deep 階段面板移除；不新增 Plan B 或替代 UI。

### Files

| 類別 | 檔案 |
| --- | --- |
| Production | `forge-runtime/extensions/forge-runtime.ts` |
| Tests | `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts` |
| Documents | `CONTEXT.md`、`docs/adr/ADR-0020-wait-user-ui-only-state-publication.md`、本 Plan、ticket、agent-state、`Memory/record.md`、`Memory/lesson_learn.md`、`docs/handoff.md` |

### Test Contract

新增測試名稱：`ForgeStage_WhenPublishingWaitUserState_ShouldNotQueueUnsupportedDelivery`。

保護既有契約：`SuccessfulNeedsConfirmationCompletion_TerminatesTurnUntilUserAnswer`、`PiTui_WhenNeedsConfirmationCompletes_ShouldShowQuestionAndAdvanceAfterAnswer`、`PiTui_WhenCompletionIsOmitted_ShouldRecoverOnceAndResumeOnlyAfterExplicitRetry`。recovery 不得自動 replay，必須等候明確 retry；實作前基線數量由測試代理記錄，本輪不捏造 passed 數量。

### Execution Order

1. 測試角色先建立上述 regression 並跑 RED。
2. 實作角色只修改 `forge-runtime/extensions/forge-runtime.ts` 的 WAIT_USER state publication，保留正式 state／UI／followUp 流程。
3. 驗證角色執行 targeted tests、package test 與 check；review 角色獨立確認 scope、fail-closed 與無 PI core 變更。
4. 完成後同步本文件、CONTEXT、ADR、ticket、agent-state、Memory 與 handoff。

### Verification

```text
npm --prefix forge-runtime exec -- tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/extensions/pi-grill-interactive.test.ts
npm --prefix forge-runtime exec -- tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/extensions/forge-runtime-extension.test.ts
npm --prefix forge-runtime test
npm --prefix forge-runtime run check
```

另須在 `C:\Users\User\Desktop\Agents\pi-test` 執行 `pi`，輸入 `/forge-runtime grill ambiguous {"question":"display-only smoke","recommendation":"accept","options":["accept"],"evidenceIds":["smoke"],"decisionId":"display-only-smoke","roundId":"display-only-smoke-round"}`。驗收 WAIT_USER 出現、回答前無額外 provider turn、回答後只繼續一次、聊天不再有 `forge-stage` panel，最後輸入 `/forge-runtime cancel`。

### Rollback

若驗證未通過，只回退本 ticket 的 production／tests 變更與本 addendum 的現行段落；保留 ADR-0012 原始歷史，不恢復不受支援的 `displayOnly` 投遞。

### 實作與最終驗證

`publishState` 先呼叫 `setStatus`，`deliverAs: "displayOnly"` 直接返回，不呼叫 `sendMessage`；omission branch state 使用 display-only，recovery panel 維持 `triggerTurn: false`。保留 state／status／selector／custom editor、answer followUp、retry／recovery，不修改 `pi-main`。

目前 `InteractiveModeOptions` 僅有 `tuiMode`；10 個 interactive tests 改用 test-local `attachVirtualTerminal`，依序 `init`、`run`、`waitForRender` 後輸入。extension targeted 2/2；PI targeted 3/3（含 no-auto-replay 與 explicit retry callCount 2→3）；static touched errors 0，剩餘 pi-main highlight.js 21 個 baseline errors；`git diff --check` 0、`pi-main` diff 0。

真實 PI 0.84.3 no-session smoke 的合法 `/grill-run` WAIT_USER `display-only smoke` 通過並完成 confirm；normal active `forge-stage` 皆在 WAIT_USER 前，未取得 WAIT_USER-specific stage 證據。cancel 因在 streaming 送入而 inconclusive；第一次 forged roundId 被 fail-closed 拒絕，不算產品失敗。修正前歷史快照為 full PI file 10/11，唯一 Deep dirty-scope failure 非本 ticket；已由 Deep 修正段落記載的最新 11/11 GREEN 取代。完整 npm suite 於既有 integration hang（85 pass／0 fail）後中止並保留 log。

必要 logs：`verify_three_wait_user_pi_contracts_with_retry_20260829.log`、`verify_two_wait_user_extension_contracts_final_20260829.log`、`verify_static_after_harness_sweep_20260829.log`、`verify_full_pi_grill_interactive_20260829.log`、`verify_full_forge_runtime_suite_20260829.log`。

核心規範／安全 review PASS；manual retry gap 已補。private renderer terminal cast 僅為 upstream 無 public injection seam 的測試 caveat，不新增抽象。修正前歷史快照曾列 Deep dirty-scope failure；已由最新 11/11 GREEN 取代。現存 caveat 僅為完整 suite hang、可選真實 cancel smoke；本 ticket 已完成，不需下一 session 實作。

## Plan A：Deep pure-search continuation 修正收尾（2026-08-29）

狀態：`implemented/verified-with-existing-workspace-caveats`。使用者實測的 pure `forge_deep_search` 中斷，根因是 coordinator 在 `forge-runtime/extensions/forge-runtime.ts:1284` 的 `!batch.mixed` guard 提前返回，沒有 same-identity follow-up；`continue` 沿用 `sourceRoundId`，3 + 5 次累計達 8 次上限不是根因。

正式修正只移除該 guard，保留 terminate=true、全部 settle barrier、followUpQueued、identity／active checks、mixed reject、completion-only、quota、fail-closed 與 `pi-main` 邊界。public-seam 測試位於 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts:1585,1836-1948`，固定兩筆 pure search 全 settle exactly once，以及 rejected／failed settled 後完成 exactly once。

驗證：PI TUI RED（`pi-grill-interactive.test.ts:681`，actual 3／expected 0）轉 GREEN 1/1；完整 PI 互動 11/11；新增兩測 2/2。extension 完整 assertions 68 pass／0 fail，但 summary 後背景程序未退出，180 秒中止。`npm run check` 與第二段 tsc 僅有既有 `pi-main` `highlight.js` 21 個 baseline 型別錯誤；bounded `npm test` 未觀察失敗，但 180 秒卡在既有 human-decision integration。兩份獨立 review 無阻擋 finding；剩餘低風險是 synthetic failed result 與真實 awaited `message_end`／tool-call ID 假設。

## Plan A：Deep Discovery fallback 與 human premise（2026-08-29）

### 狀態

`design-approved-ready-for-red`；設計已核准，尚未修改 production/test。唯一契約來源為 [`ADR-0021`](adr/ADR-0021-deep-discovery-fallback-human-premise.md)。

### 建置範圍

- Retrieval／Understanding 合併計 `needsDiscoveryCount`；第一次 `needs_discovery` 自動 Light Discovery→Grill。
 - 第二次及之後以 `kind=deep_discovery_fallback` 進 WAIT_USER，固定問題為「此專案資料來源不足，將以前次 grill/ 資料來源所得之證據進行後續開發，請確認」，只接受 trim 後整句「同意」／「確認」。
- 確認後 fresh `KNOWLEDGE_UNDERSTANDING`，只允許 `forge_deep_complete`；累積兩輪 evidence 依 evidenceId 去重，零外部來源建立 `human_premise`。由已驗證 evidence 直接成立的事實性 finding 可維持事實陳述；implementation inference 必須以「推論：」開頭並引用有效 ID。只引用 `human_premise` 且沒有 verified evidence 時，validator 強制「推論：」；混合 evidence 仍須標示實際推論，既有引用／ID 檢查不放寬。

### 檔案

Production：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/src/workflow/state-machine.ts`、`forge-runtime/src/ui/ui-state.ts`、`forge-runtime/src/evidence/evidence-engine.ts`。

Tests：`forge-runtime/tests/evidence/evidence-engine.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。

### 不建置與執行順序

不改 `pi-main/`、新 tool schema／Light Discovery tool／UI、validator、第三次自動 retry、CONTEXT_BUILD 下游或舊 WAIT_USER parser。每個 slice 先由獨立子代理寫測試，獨立 runner RED，再最小 production 實作、獨立 GREEN，最後分離 Standards／Spec review。本 ticket 只有 Plan A，沒有 Plan B；repo 既有的 `PLAN-B` 與本 ticket 無關，因本 ticket 沿用既有 `WAIT_USER` panel。

### 測試與驗證

Evidence 11+2=13；extension 68+6=74 assertions；PI 11+1=12。由 `forge-runtime/` 執行：

```text
npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/evidence/evidence-engine.test.ts
npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/extensions/forge-runtime-extension.test.ts
npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/extensions/pi-grill-interactive.test.ts
npm run check
npm test（180 秒有界）
```

期望依序為：Evidence `13 pass/0 fail`；extension `74 assertions/0 fail`（summary 後可能有背景 handle caveat）；PI `12 pass/0 fail`；`npm run check` 保留既有 21 個 `highlight.js` baseline；完整 `npm test` 保留既有 hang caveat，不宣稱完整 suite exit 0。

### 脆弱假設與下一步

`deliverAs: followUp` 必須只排隊不重入 active tool turn；evidenceId 必須跨 snapshot 穩定去重；fallback prompt／identity 不得成為 provider 自由文字路由。若不成立即停下，不放寬 gate。下一 session 先讀 handoff／CONTEXT／ADR-0021／PLAN-A，展示摘要並等待使用者確認。

### 實作與最終驗證（2026-08-30）

狀態：`completed`。已完成 `human_premise` Evidence Package、共用 `needsDiscoveryCount`、第一次正式 `tool_result` transform 的 Light Discovery→Grill、第二次精確 `WAIT_USER` 與 exact `同意`／`確認`、新 Knowledge Understanding identity 與 completion-only gate。evidence 跨 snapshot switch 累積並依 ID 去重，於 cancel、switch、new workflow、reset 清除；human premise 與 decision 引用、READY_FOR_DEEP settle handoff、WAIT_USER await publication、`message_end` ctx 與 fallback needs_decision accumulator keys 均已完成。

驗證：Evidence 13/13；Session State 22/22；Extension 142/142；PI interactive 12/12；`npm test` 248/248；Standards／Spec 獨立審查均 PASS。`npm run check` exit 1，但 Forge Runtime 自身零錯誤，唯一失敗為未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21` 缺少 `highlight.js` declaration（TS7016）。

## Plan A：Decision replay 的 UI-only stage 與 settled identity（2026-08-30）

### 狀態

`implementation-in-progress`；使用者已明確核准先更新文件再實作。只執行本 Plan A，沒有 Plan B，因為本 ticket 不改 UI 畫面，只隔離 stage message 的 transport，並修正 decision answer 後的 settled replay 時序。

### Building

- 在唯一 `publishState` 出口，讓所有 `forge-stage` 以正確 PI 契約 `ctx.ui.setStatus("forge-runtime", status)` 更新 UI，固定傳入 key 與 status text；不呼叫 `pi.sendMessage`，也不進 agent/provider context。
- needs_decision 回答後終止 current run，沿用既有 `agent_settled` + next task + ordinary user message；先送出新的 attempt identity，完成 matching `message_start` 後才允許後續 Deep tool call。
- 保留 pending marker、identity/stage/tools revalidation、stale reject 與 fail-closed tool gate。
- Retrieval completed 與 Deep `needs_decision` answer 只設定既有 `pendingSettledDeepInvocation`，待 `agent_settled` 後由既有 identity／active-tool／workflow guards 發送；這是 transport 修正，不改 state machine 或流程順序。

### Not Building

- 不修改 `session-state.ts`、state machine、evidence、validator、Grill、第一次 `needs_discovery` restart、READY_FOR_DEEP 語意、Context Build、UI 視覺或既有 WAIT_USER／cancel／retry／switch 流程。
- 不修改 `pi-main`，不新增 public API、delivery contract、tool schema、scheduler、替代 queue 或 Plan B。
- 不放寬 stale 或 fail-closed 條件，不以測試 workaround 改變正式契約。

### Approach

先以 `publishState` 的單一出口切斷純顯示 stage 的 agent-loop transport，讓所有 callers 一次受益；decision answer 則使用既有 settled handoff seam，避免在 current run 中提前重播。若現有 seam 不足以保證新的 identity 在首次 Deep call 前已進入 provider context，立即停下回報，不跨檔案或 public API 擴 scope。

### Fragile assumptions

- `ctx.ui.setStatus("forge-runtime", status)` 是純顯示通道，不會重新進入 agent loop；若缺少 key 或 text，footer provider 會刪除項目，此假設已被證偽。
- `agent_settled` 的 next task 與 ordinary user message 能在 matching identity 驗證後恢復工具；pending marker 期間舊 attempt 必須持續被 block。
- PI provider context 與 observable tool result 可可靠觀察 stage 未進 user-role context、首次 Deep call 與 blocked 次數。若上游時序或 API 改變，測試必須失敗，不可放寬 gate。

### Files

| 類別 | 檔案 | 預計變動 |
| --- | --- | --- |
| Production | `forge-runtime/extensions/forge-runtime.ts` | UI-only stage 出口與 settled decision replay 的最小修正 |
| Tests | `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | Extension pending decision replay 與 tool gate 回歸 |
| Tests | `forge-runtime/tests/extensions/pi-grill-interactive.test.ts` | 真實 PI provider context 與首次 Deep tool execution/result 回歸 |
| Documents | `CONTEXT.md`、本文件、ADR、ticket、agent-state、`docs/handoff.md` | 記錄契約、執行與狀態 |
| 不修改 | `pi-main/` | 維持上游原始碼不變 |

### Tests

依 vertical slices 執行，每個 slice 先由測試子代理新增測試並打 RED，主代理確認 RED 後才改 production；測試、production、驗證與 review 分工不可合併。

- Slice A1：Extension `observedStatuses` 收到固定 key `forge-runtime` 與正確的 `CONTEXT_BUILD` status text。
- Slice A2：真 PI trace 必須實際到達 Context Build，再驗證 provider context 沒有 user-role stage；不能只用「沒有 literal」假綠。
- Slice B：Retrieval accepted／terminate 後 trace 為 `callCount=5` 且 idle；needs_decision answer 後 fresh deep-2 首次 Deep call 成功一次，blocked=0。
- Slice C：Extension pending decision replay 期間，舊 attempt 仍被 `tool_call` gate 阻擋。

基線為 Extension 142、PI 12、全套 248；預估新增後目標為 Extension 144、PI 14、全套 252，實際數量以測試落地為準。

### Execution Order

1. 讀取本 handoff、CONTEXT、ADR、本 ticket、agent-state 與 Memory，檢查工作樹；本文件完成後同一 session 可直接進入 TDD，不需二次確認。
2. Slice A1 由 Extension 測試子代理先補 status regression 並執行 RED；主代理只修改 `forge-runtime/extensions/forge-runtime.ts` 的 stage publication。
3. Slice A2 由 PI 測試代理先補 provider context regression 並執行 RED；主代理確認 stage 不再進 agent loop。
4. Slice B 由 PI 測試代理先補 settled decision replay／tool execution-result regression 並執行 RED；主代理以既有 settled handoff 做最小修正。
5. Slice C 由 Extension 測試代理先補 pending gate regression 並執行 RED；主代理確認不需新增 production 檔後完成修正。
6. 由獨立驗證代理執行 targeted、完整 suite 與 check；再由獨立 review 代理檢查 Standards／Spec、scope 與其他流程不變量。
7. 驗證完成後同步更新 CONTEXT、ADR、本 Plan、ticket、agent-state、Memory 與 handoff。

目前 production 已完成 status key、`forge-stage` UI-only 與兩個 settled producer；C 舊 attempt gate 已 targeted 1/1 green。test-only Promise trace 已確認第一次 Deep `needs_discovery` 的精確根因：`agent_end → agent_settled → sendUserMessage` 的 Promise 已 resolve，但 provider `callCount=4`、`pendingResponses=4`；`pi.on("input")` 在沒有 marker且 stage=`GRILL` 時回 `handled`，因此 invocation 被吃掉，只有精確等於 `pendingReplayInvocation` 時才回 `continue`。下一步只在 Discovery timer 通過既有 settled guards、呼叫 `sendUserMessage` 前設定 `pendingReplayInvocation = pendingDiscovery.invocation`；沿用既有 `message_start` full exact match 清除與 tool_call fail-closed gate，sendUserMessage 失敗時保留 marker。Deep 邏輯、Grill WAIT_USER、needs_discovery 次數／人類確認規則、READY、validator、evidence、state machine、`pi-main` 均維持不變。

### Verification

驗收必須證明：stage 仍在 UI 可見但完全不進 provider/user-role context；decision answer 後第一次新 identity Deep call 即成功且無 blocked result；pending replay 期間舊 identity 仍 fail-closed。另須確認既有 Grill、WAIT_USER、第一次 `needs_discovery`、Context Build、cancel/retry/switch 與合法 Deep 後續測試維持綠燈，`pi-main` 無 diff。

第一次 `needs_discovery` 的 fallback targeted 必須證明 accepted tool result 後確實產生下一個 provider user turn，且只消費 matching `toolCallId`、`toolName`、`isError=false`、workflow／identity 邊界；不匹配或缺少 sendUserMessage 時維持 fail-closed。現況 Extension full 144/144、A2／B／C targeted 綠，PI full 因此 transport 缺口仍紅；修正後重跑 fallback targeted、PI full、Extension full、type/check 與 whole suite。

### Rollback

只撤回本 ticket 的 `forge-runtime/extensions/forge-runtime.ts`、兩個測試檔與本次文件段落；不還原其他 ticket 歷史，不修改 `pi-main`，不引入 migration。

## Plan A：Intent 到 Context 流程圖衍生視圖同步（2026-08-30）

### 狀態

`completed-with-browser-caveat`。本輪只執行單一 HTML／文件維護計畫，九列 baseline 不變；沒有 runtime 或架構決策變更，因此不拆 Plan B，也不建立新 ADR。

### 已執行

- 依目前 handler、session state、state-machine 與既有契約校正 `forge-intent-context-flow.html`：RECEIVE shortcut／`missingAssets`／fail-closed、WAIT_USER `displayOnly`／`transcript`、Deep stale identity 與兩種回流、Evidence `human_premise`／Finding-only `推論：`、CONTEXT_BUILD partial。
- 保持 `forge-runtime-flow.html`、`pi-main` 與 runtime 不變；該舊圖 before/after SHA-256 均為 `822ABDA78BB3C6DB7429C0D2365F56E15C97247B25E72279CBB3D7406C6249E0`，LastWriteTimeUtc 為 `2026-08-30T06:51:21.2337516Z`，且本輪開始前已 dirty。

### Verification

- 靜態 parser、純 HTML/CSS、semantic classes、九 state 通過；獨立內容 review P0=0、P1=0。
- 沒有可用 browser instance，故 1280×900、390×844、console、水平 overflow 與截斷的 runtime 視覺驗證未完成。
- 未解風險：CONTEXT_BUILD production 尚未接；Evidence Package 全空目前不被 validator 拒絕；匿名 handler mixed-batch 細節未完全展開，圖上未把未證實細節標成完成。

## 2026-08-30 Decision replay Discovery transport 覆核

真 PI test-only spy 已否決 `sendUserMessage(..., { deliverAs: "followUp" })`：雖確認 handler 被呼叫，卻沒有 `queue_update`，provider `callCount=4`、`pendingResponses=4`；whole-file targeted 13 pass/1 fail、blocked=0。後續只保留 `pendingDiscoveryRestart` 精準消費與既有 guards；match success 後呼叫既有 `restartLightDiscoveryAndGrill`，建立獨立 `pendingSettledDiscoveryInvocation`，由既有 `agent_settled` handler 以 0ms timer 重驗 activeWorkflow、GRILL stage、current round、Grill tool boundary、`sendUserMessage`，再用不帶 `deliverAs` 的正常 user message 開下一 provider turn。Discovery marker 與 Deep marker 分離，清理 pending state 時一併清除 marker／timer；不新增 PI event、不改其他既有流程。status 維持 `implementation-in-progress`，下一步先實作 settled Discovery marker，再重跑 fallback targeted、PI full、Extension full、check 與 whole suite。
## 完成與驗證（2026-08-30）

本計畫已完成。實作維持最小範圍：UI status 與 agent transport 分離；Deep decision / Retrieval completion 於 settled 後重播；第一次 discovery restart 使用獨立 settled marker，並在 settled 後重新驗證上下文再送正常 user message。既有 exact message-start 清除與 fail-closed tool gate 保留。

驗證已涵蓋 A1、A2、B、C、fallback、Extension helper；fallback 1/1、PI full 14/14、Extension 144/144、npm test 252/252。未改動 pi-main、狀態機、session-state、evidence/validator 或既有 WAIT_USER 語意。整體 typecheck 僅受既有 pi-main highlight.js 型別宣告缺失阻擋。

## Plan A：KNOWLEDGE_UNDERSTANDING→CONTEXT_BUILD 單一交付物（2026-08-30）

### 狀態

`implemented-verified-reviewed`。本段定義並實作完整資料契約與 consumer seam；不宣稱自動啟動 Context Build provider 已接上。

### Building

- 以單一 Forge-owned immutable `KnowledgeUnderstandingPackage` 延伸既有 Evidence Package；`decisions`、`findings`、`limitations` 為權威，新增必填 `knowledgeSummary`。
- summary trim 後非空、最多 4000 Unicode code points，不得增加結構化資料沒有的新事實。
- evidence IDs 由 runtime 從 validated evidence records 衍生為唯讀 `evidenceIds`，模型不得另傳第二份 IDs。
- 轉入 `CONTEXT_BUILD` 前完成建立、驗證、原子保存；失敗停留原 phase，不部分保存。
- Session state 只提供一個 Forge-owned getter；Context Build 不讀 tool-result details、UI prose 或 transport marker；new workflow/reset/switch/cancel/full cleanup 清除 package。

### Not Building

不修改 `pi-main/`、不新增依賴、不建立重複 DTO／第二真相來源、不放寬引用驗證或 blocking limitation fail-closed。自動啟動／排程 Context Build provider 是後續 continuation scope。

### Files

| 類別 | 檔案 | 預計變動 |
| --- | --- | --- |
| Production | `forge-runtime/src/evidence/evidence-engine.ts` | package／summary 驗證與衍生 IDs |
| Production | `forge-runtime/extensions/forge-runtime.ts` | completion schema／handler 與原子 handoff |
| Production | `forge-runtime/src/runtime/session-state.ts` | 保存、單一 getter、清理與 transition guard |
| Production | `forge-runtime/src/knowledge/context-builder.ts` | 消費單一 package 的 seam |
| Tests | `evidence-engine.test.ts`、`discovery-evidence.test.ts`、`forge-runtime-extension.test.ts` | schema、驗證、交付與清理回歸；cleanup 位置待 CodeGraph 窄查 |

### TDD Execution Order

1. RED：summary 必填／trim／4000 code points、derived IDs、blocking limitation 與引用驗證。
2. GREEN：重用既有 Evidence Package，完成 summary validation。
3. RED→GREEN：extension schema／handler；atomic session save + transition guard。
4. RED→GREEN：Context Build 取得 `decisions`、`findings`、`limitations`、`knowledgeSummary`、evidence IDs；cleanup isolation。
5. 由獨立角色驗證與 review；不得宣稱尚未執行的測試已通過。

### 驗收與風險

驗收必須證明五項資料完整交付且不可部分保存，舊 workflow package 不會出現在新 workflow。最脆弱假設是 provider 自動啟動且會讀取新 getter；本 Plan 不把這個後續缺口寫成已修復。
## Plan A 收尾：KNOWLEDGE_UNDERSTANDING→CONTEXT_BUILD 交付物（2026-08-30）

狀態：`implemented-verified-reviewed`。已完成單一 immutable EvidencePackage handoff：`decisions`、`findings`、`limitations`、`knowledgeSummary` 與 runtime-derived `evidenceIds`；summary trim 後非空且限制 4000 Unicode code points，package 與巢狀 metadata 深層 immutable。Session 在 transition 前 validate/save，transition 失敗 rollback；getter、reset／cancel／new snapshot cleanup 與 Context Builder 同一 package identity 均已完成。

驗證：session 27/27、evidence 18/18、全套 265/265、`npx tsc --noEmit -p tsconfig.json` exit 0；Standards／Spec 獨立 review 均 PASS。`npm run check` exit 1 僅因未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 缺少 `highlight.js` declaration（TS7016）。

本 ticket 明確不接自動續跑或排程 Context Build provider；該 continuation 需另案設計與使用者確認。未改變其他既有流程。

## Plan A：knowledgeSummary 非權威邊界（2026-08-31）

### 狀態

`implemented-verified-reviewed`。使用者已確認摘要矛盾時仍接受 package；實作、驗證與雙軸 review 均完成。無 Plan B，因本案沒有 UI。

### Building

- 在 `forge_deep_complete` schema 與 `EvidencePackage` 契約明確標示：`knowledgeSummary` 只能重述正式欄位，不得新增主張；矛盾時以 `decisions`、`findings`、`limitations` 為準。
- Context Builder 維持使用同一 package；正式 `items` 不得由摘要內容決定。
- 補兩個回歸測試：schema description 明確標示非權威用途；矛盾／新增主張摘要不改變正式 Context Builder items，且原摘要仍保留供閱讀。

### Not Building

不做自然語言語意 parser、矛盾阻擋或重試、runtime 重寫摘要、第二模型／DTO／依賴、自動續跑 Context Build、`pi-main` 修改或其他流程變更。

### Approach

沿用既有單一 immutable EvidencePackage 與 runtime-derived evidence IDs。先由測試代理建立 schema description RED，再加入最小 schema／型別說明；接著以固定結構欄位與兩個不同摘要建構 Context Builder，證明正式輸出相同。

### Files

| 類別 | 檔案 | 內容 |
| --- | --- | --- |
| Production | `forge-runtime/extensions/forge-runtime.ts` | completion schema 的摘要邊界說明 |
| Production | `forge-runtime/src/evidence/evidence-engine.ts` | EvidencePackage 非權威摘要契約註解 |
| Tests | `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | schema description 回歸 |
| Tests | `forge-runtime/tests/knowledge/discovery-evidence.test.ts` | 摘要矛盾不影響正式 items 回歸 |
| Documents | `CONTEXT.md`、ADR、ticket、agent-state、Memory、handoff | 記錄決策、執行與狀態 |

### Tests

基線為 265；新增兩個測試，預估全套 267。第一個測試必須先 RED（目前 schema description 尚缺），第二個固定正式欄位相同但摘要含新增主張／矛盾時，Context Builder items 必須相同。

### Execution Order

1. 新 session 先讀 `docs/handoff.md`、`CONTEXT.md`、ADR-0024、ticket、agent-state 與 Memory，展示 context 摘要並等待使用者確認。
2. 測試代理先新增 schema description 測試並執行 RED；主程式補最小 schema／型別契約。
3. 測試代理新增 Context Builder 正式輸出不受摘要影響的回歸，執行 targeted GREEN。
4. 執行相關測試、完整 suite 與 TypeScript 檢查；再做 Standards／Spec review。
5. 驗證後更新全部 durable 文件；若新增自動 Context Build 需求，另案停止並重新設計。

### Verification

驗收須證明：矛盾摘要仍可接受；正式欄位與 evidence IDs 不變；Context Builder items 對不同摘要完全相同；摘要原文仍可讀取；既有流程、fail-closed、`pi-main` 與自動續跑邊界不變。不得把「摘要內容正確」宣稱為可由程式完全驗證。

### 最脆弱假設

最脆弱假設是所有下游程式都遵守「結構欄位優先」，不直接用摘要控制流程。schema 說明與回歸測試能固定目前邊界，但無法證明未來新 caller 不會誤用自然語言摘要。

### 收尾驗證（2026-08-31）

schema description 與 `EvidencePackage` JSDoc 已明定摘要僅供人類閱讀、非權威、不得新增主張或控制流程。Context Builder regression 以否定正式 decision 與虛構 `authorityLevel` 的矛盾摘要證明 items 不受影響且摘要保留。

RED 145/1 後 GREEN 146/0；單檔 Context 測試 4/0；完整 `npm test` 266/266；Standards 與 Spec review PASS。`npm run check` 唯一既有阻塞為未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21` 的 `highlight.js` TS7016（21 個），與本輪無關；未修改 `pi-main`。自動排程 Context Build 與空 Evidence Package validation 仍 out of scope。狀態：`implemented-verified-reviewed`。

## 2026-08-31 Grill 軟上限與人類 checkpoint（direct Plan A）

使用者已核准 [`ADR-0025`](adr/ADR-0025-grill-soft-cap-human-checkpoint.md)；狀態 `implementation-complete-verified`。只沿用既有 WAIT_USER，沒有獨立 View/UI gap，故不建立 Plan B。

執行／TDD 狀態：`implementation-complete-verified`。兩條 converge 驗收、checkpoint、cancel、skill 與全套驗證均已完成。

精確 implementation files：`forge-runtime/skills/grilling/SKILL.md`、`forge-runtime/src/ui/ui-state.ts`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/runtime/session-state.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/grill/grill-skill.test.ts`。durable docs 是 repo-required status tracking，不是 runtime scope；`.pi` 僅可能是本機忽略的舊 mirror，不是來源。

契約：每條 chain 只計成功接受的人類 `grill_confirmation` 回答，`MAX_AUTOMATIC_GRILL_ROUNDS = 8`；retry、mismatch、stale/duplicate、checkpoint 選擇不計數，新 chain／READY／cancel/reset 清零。第 8 題先保存，隨後以既有 WAIT_USER 發布 `kind: "grill_checkpoint"`，不新增 state。固定 `continue_one`、`converge`、`cancel`；continue 只放行一題後再 checkpoint。converge 只啟動一次 convergence invocation：無真正知識盲點時模型提交 `READY_FOR_DEEP`，runtime 沿 `continueDeepKnowledge` 進入 `DEEP_KNOWLEDGE_RETRIEVAL`；有真正知識盲點時最多問一題，保存回答後直接沿 `continueDeepKnowledge` 進 Deep，不回 checkpoint、不再 Grill、不問第二題，且不得偽造 READY。真正知識盲點是 Deep Retrieval 所缺客觀知識／證據，不含可採用預設的 implementation detail。cancel 重用既有非 Deep cancel 回 RECEIVE；late/stale/duplicate 一律 fail-closed。`NEEDS_CONFIRMATION` 僅限 material boundary，非阻塞細節 READY_FOR_DEEP。

測試固定 12 個：Session-state 4（baseline 27→31）、Extension 6（146→152）、Skill 2（6→8）；其後補上 cancel、relevance bypass、blank/stale/duplicate 與 package path 回歸，最終完整 281/281。兩條 converge 驗收分別固定無盲點 0 題 READY→Deep，以及一個真正知識盲點問 1 題後直接 Deep；普通 empty-candidate 仍 `WAIT_USER`。

執行順序：不同測試子代理先補測試逐 slice 打紅，主代理看見精確紅燈後才改 production／skill；implementation 與 final review 由不同角色負責，每個 milestone 更新 agent-state。從 `forge-runtime/` 執行 targeted 三命令、`npm test`、`npm run check`；保留既有 pi-main `highlight.js` TS7016，禁止修改 pi-main 或新增 local TS error。

最脆弱假設：8 輪足以在一般案例前不干擾；模型能正確辨識真正知識盲點。runtime 只限制一次 invocation／一題上限，不替模型偽造 READY 或替人類做 material decision。

### Verification

```text
# 僅由獨立驗證子代理執行，從 forge-runtime/ 執行
npm exec -- tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/runtime/session-state.test.ts
npm exec -- tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/extensions/forge-runtime-extension.test.ts
npm exec -- tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/grill/grill-skill.test.ts
npm test
npm run check
```

### 最終收尾（2026-09-01）

Plan A 已完成。checkpoint bare `cancel` 與既有 cancel 共用完整 cleanup；session 對 blank answer no-op、舊 round replay no-op、cross-round duplicate fail-closed。converge 的明確兩入口跳過 relevance：0 題直接 Deep，1 題回答後直接 Deep；普通 empty-candidate 仍等待使用者。canonical skill 為 `forge-runtime/skills/grilling/SKILL.md`。

驗證：完整 281/281、精準 convergence/cancel/relevance 5/5、session 33/33、cancel 8/8、`quick_validate` 成功、pack dry-run 260 files、isolated tarball install/path resolution 成功、`git diff --check` exit 0。`npm run check` 只剩未修改 `pi-main` 的 `highlight.js` TS7016 baseline；package 仍含約 213 個 `.log`，true knowledge gap 仍由 prompt/skill 契約約束，未加入 runtime NLP classifier。

## Plan A：Deep Discovery fallback 選項與 full reset（2026-09-02）

### 狀態

（歷史狀態）設計完成後已獲核准並完成實作；本變更只建立單一 Plan A，未建立 Plan B。

### Building

- `deep_discovery_fallback` 可見 selector 僅「確認／取消」，共用 UI 追加「自行輸入…」。舊「同意」不顯示，但保留 trim 後精確相容輸入，等同確認。
- 選擇「取消」或自行輸入精確「取消」時，清除本輪所有輸入與證據，回初始 `RECEIVE`。
- 重用 `sessionState.reset()`（`forge-runtime/src/runtime/session-state.ts:720-741`）及 extension 外層既有清理；一般 `deep_decision` 的保留輸入取消契約不變。

### Not Building

不改 `pi-main/`、不重新定義自由輸入、不新增 state／tool schema／依賴、不沿用 `cancelDeepKnowledge()` 作 fallback 取消、不改一般 `deep_decision` 取消、不建立 Plan B。

### Approach

先由測試子代理新增 session option contract、extension selector full reset、typed input 精確「取消」reset、確認路徑不回歸，以及 stale／duplicate 不重複 reset 的 regression，執行第一個 RED；主代理確認紅燈後，才在兩個預期 production 檔做最小修正。沿用既有 reset 與 cleanup，不新增替代清理流程。

### Files

| 類別 | 檔案 | 內容 |
| --- | --- | --- |
| Production | `forge-runtime/src/runtime/session-state.ts` | fallback options 與 cancel/reset 分流 |
| Production | `forge-runtime/extensions/forge-runtime.ts` | selector／typed input cancel 的外層 cleanup 與 reset 呼叫 |
| Tests | `forge-runtime/tests/runtime/session-state.test.ts` | option contract、full reset、確認與一般 deep cancel 不變 |
| Tests | `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | selector／自行輸入精確取消、stale／duplicate guard |
| Documents | `CONTEXT.md`、ADR-0021、ticket、agent-state、`docs/handoff.md` | durable status |
| 不修改 | `pi-main/` | 上游原始碼維持不變 |

### Tests（已完成）

至少涵蓋：session option 只公開「確認／取消」且共用 UI 有「自行輸入…」；selector「取消」清空輸入／evidence 並回 `RECEIVE`；自行輸入 trim 後精確「取消」同樣 reset；「確認」仍建立 fresh Understanding；一般 `deep_decision` 取消仍保留資料；stale／duplicate input 不重複 reset。第一個測試必須由測試子代理先打 RED。

### Execution Order

1. 下一 session 先讀 `docs/handoff.md`、展示 context 摘要並等待使用者確認。
2. 使用者確認後，測試子代理先新增上述 regression 並執行第一個 RED；未見精確紅燈不得修改 production。
3. production worker 只修改兩個預期檔，重用 `sessionState.reset()` 與既有 extension cleanup。
4. 獨立驗證代理執行 targeted、完整 suite 與 check；再由獨立 review 代理檢查 scope、fail-closed 與一般 deep cancel 不變。
5. 驗證後更新 durable 文件與 handoff；不得把未執行結果寫成通過。

### Verification

由獨立驗證子代理從 `forge-runtime/` 沿用 repo 現有命令：

```text
npm exec -- tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/runtime/session-state.test.ts
npm exec -- tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/extensions/forge-runtime-extension.test.ts
npm test
npm run check
```

驗收須證明 full reset 清除 session input、evidence、fallback accumulator 與 extension markers，狀態為 `RECEIVE`；確認路徑與一般 `deep_decision` cancel 不回歸；stale／duplicate 不產生第二次 reset。保留既有 `pi-main` baseline error，不修改上游。

### Fragile assumption

最脆弱假設是共用 UI 的「自行輸入…」會將文字送入既有 typed input ingress，且外層 cleanup 可在 reset 前後安全重複呼叫；測試需以實際 selector／ingress 與 stale identity 證明，不以 mock 取代流程。

### Execution complete（2026-09-02）

Plan A 已完成 execution。production 檔案為 `forge-runtime/src/runtime/session-state.ts`、`forge-runtime/extensions/forge-runtime.ts`；測試檔案為 `forge-runtime/tests/runtime/session-state.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。可見 options 為「確認／取消」，共用 UI 保留「自行輸入…」；fallback cancel 與精確 typed cancel 清除所有輸入／證據並回 `RECEIVE`，確認及一般 `deep_decision` cancel 不變。

驗證：session-state 33/33、extension 153/153、真實 TUI 14/14、完整 `npm test` 282/282；完整 log `.tmp-deep-fallback-full-test-rerun.log`。review 已完成且無阻擋 finding，`git diff -- pi-main` 無輸出。`npm run check` 與第二段獨立 tsc 均 exit 2，僅因未修改的 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 缺少 `highlight.js` 語言模組型別 TS7016；不得寫成 check 通過。isolated verification 已完成：以 HEAD `fdccbd62403e40ba3400761bc0468668820a8059` 建 detached worktree，僅套用本 ticket 五個 code/test 檔 patch，未 install、未改 `pi-main`，`npm test` exit 0，282/282、0 fail/skip；worktree、junction 與 patch 已安全清理。

## Plan A：Spec Gap 探索性開發與驗證層級（2026-09-02）

### 狀態

`design-confirmed-not-implemented`。使用者已核准；只建立一份 Plan A，因本案是 Evidence／Workflow 契約，沒有獨立 UI 視圖或視覺驗收，故不拆 Plan B。

### Building

- 在既有 Evidence Package／limitation 契約中表達 `Spec Gap`：`target`、可選 `version`、`reason`、`missingEvidence`、`impact`。
- 固定 `exploratory`、`black_box_verified`、`spec_verified` 三層驗證；探索層允許本機實作、mock、模擬器與唯讀驗證，但不得宣稱相容／符合 spec。
- 黑箱層只有在目標、版本、環境、情境、日期齊全時成立，主張限定為指定環境實測；正式 spec 可核對時才成立 spec verified。
- 高風險真實操作在正式 spec 或對應真實驗證前標示禁止；本案只建立契約，不假稱具備任意 shell／外部操作 execution guard。
- 復用非 blocking limitation／`human_premise`，不新增完整 state，不修改 `pi-main/`。

### Not Building

- 不自動取得、繞過權限或推測正式 spec；不把 mock、推論或單次成功測試升格為完整相容性。
- 不新增完整 `SPEC_GAP` state、第二份 Evidence DTO、第二模型、依賴、UI 或 NLP classifier。
- 不實作任意 shell／外部操作 capability guard；可靠 enforcement 另案設計。
- 不放寬既有 fail-closed validator，不修改 `pi-main/`。

### Files

| 類別 | 檔案 | 預計變動 |
| --- | --- | --- |
| Production | `forge-runtime/src/evidence/evidence-engine.ts` | 延伸既有 limitation／Evidence Package 契約，保存 Spec Gap 與驗證層級並維持 immutable／引用驗證。 |
| Production | `forge-runtime/extensions/forge-runtime.ts` | 在 Knowledge completion schema／handler 接入 Spec Gap，保留探索型完成與主張限制。 |
| Tests | `forge-runtime/tests/evidence/evidence-engine.test.ts` | Spec Gap 欄位、層級、immutable 與升級條件。 |
| Tests | `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | schema／handler、exploratory completion、black-box binding 與 spec evidence regression。 |
| Documents | `CONTEXT.md`、本文件、ADR、ticket、agent-state、`docs/handoff.md` | 記錄決策、執行與狀態。 |
| 不修改 | `pi-main/` | 維持上游原始碼不變。 |

### 最小可獨立合併 slices

1. **S1 Evidence RED→GREEN**：先驗證五欄位、三層級與 immutable／引用邊界，再做最小 engine mapping。
2. **S2 Claim boundary RED→GREEN**：先驗證 exploratory 可完成但不可宣稱相容、black-box 欄位不完整拒絕升級、欄位完整限定指定環境實測，再接 extension schema／handler。
3. **S3 Regression／cleanup RED→GREEN**：先驗證 reset／new workflow／switch 不殘留 Spec Gap，確認既有 human premise、blocking limitation、正常 Deep 流程不回歸。

每個 slice 先由獨立測試角色新增測試並執行第一個 RED；確認後才由 production worker 做最小修改，最後由獨立驗證與 review 角色執行。主 context 不直接執行測試。

### Tests 與命令

第一個紅燈從 Evidence seam 開始；實際測試名稱與 API 以 CodeGraph 窄查結果為準，不先臆測：

```text
cd forge-runtime
npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/evidence/evidence-engine.test.ts
npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/extensions/forge-runtime-extension.test.ts
npm run check
npm test
```

驗收需證明：探索型 Knowledge 可完成但保留 Spec Gap；不完整黑箱 binding 不可升級；完整黑箱只產生指定環境實測主張；正式 spec 證據才可形成 spec verified；既有流程與清理契約不回歸。完整 log 不貼回父代理。

### 最脆弱假設

- 現有 Evidence Package 的 `limitations` 可承載五欄位與層級；若型別不足，先更新 ADR／Plan，不繞過契約。
- 高風險禁止目前只有資料／workflow 契約，沒有可靠 execution guard；不得把提示或欄位當成安全 enforcement。
- 缺任何黑箱 binding 欄位時維持 exploratory 或 needs discovery，不猜測補值；正式 spec 來源必須可核對。

### Rollback

只回退本 ticket 的 production／test 變更與本 Plan／ADR／ticket／state／handoff 新增段落；保留既有 human premise、Evidence Package、Knowledge Summary 與歷史紀錄，不修改 `pi-main`。若 S1 證明既有 seam 不足，停止並重新設計。

### Plan A 最終收斂（2026-09-02）

S1–S4e 全部完成。Evidence 28/28、`forge-runtime npm test` 292/292（0 fail／skip／cancelled／todo，約 30.15 秒）；`npm run check` 無本 ticket 診斷，僅有未修改上游 `pi-main` 的 21 個 TS7016；CodeGraph review 無阻擋 finding，diff check 無 whitespace error。

正式 spec 仍不可由 current runtime 驗證：可信 formal-spec importer、不可偽造 capability／來源綁定列為獨立後續 ticket；generic execution guard 亦為獨立後續工作。exploratory／black-box 可繼續，不能宣稱 `spec_verified` 已可用。Plan A 狀態：`implementation-complete-verified`。

### S1–S3 實作與驗證狀態（2026-09-02）

（歷史執行紀錄）S1–S3 已完成；後續 S4a–S4e 亦已完成。最終狀態與驗證以本文件「Plan A 最終收斂」為準。

### S4：Formal-spec trust boundary 與輸入安全（追加 slice）

#### Building

- （已被 S4e 收窄取代的中間方案）原先規劃由 runtime 另外傳入受信任 formal-spec validation context，包含 `evidenceId`、`target`、`version`、`locator`；現行 API 已移除 `TrustedFormalSpecContext` 與第二個 validator 參數，`spec_verified` 在 current runtime 固定 fail-closed。
- 驗證 context 的 `evidenceId` 必須指向 package 中可核對的正式 spec evidence；`formalSpecReference` 僅是主張，不得自行證明 spec。
- 對 `scenarios` 做深度 immutable，並讓新增欄位的 malformed runtime input 回傳 validation error、維持 fail-closed，不以 throw 結束流程。

#### Not Building

不建立 generic execution guard、不修改 `pi-main/`、不放寬 exploratory／black-box／spec_verified 的既有主張邊界、不新增完整 workflow state 或第二份 evidence 真相來源。

#### Files

沿用 `forge-runtime/src/evidence/evidence-engine.ts` 與其既有 focused tests；若 RED 證明 extension schema／handler 也需調整，才擴至 `forge-runtime/extensions/forge-runtime.ts` 及對應測試。文件同步檔仍為本 Plan、ADR-0026、ticket、agent-state、handoff、CONTEXT。

#### TDD／Verification

（歷史執行紀錄）先建立 remediation RED，再完成最小 production 修正、獨立驗證與 code review；S4a–S4e 已完成。

#### Fragile assumptions／Rollback

最脆弱假設是 runtime 能可靠區分受信任 formal-spec context 與模型提交的 reference；若無法建立此邊界，必須維持非 `spec_verified`，不得猜測升級。回滾只撤回 S4 production／test 與本次文件追加段落，保留已完成的 S1–S3 與既有 Spec Gap 契約。

### 二次 review 與 S4c 追加（2026-09-02）

- 目前 runtime 沒有 trusted formal-spec importer／context provider；live `spec_verified` 故意 fail-closed，`exploratory`／`black_box_verified` 不受影響。正式 source importer 另立 ticket，不宣稱正式升級已可用。
- S4c：若 `scenarios` 欄位存在，任何 verification level 均須為字串陣列，型別錯誤回傳 validation error 且不得 throw；`black_box_verified` 另須非空。
- S4a／S4b test context fixture 型別錯誤已修正，並已完成 S4c RED→GREEN、完整驗證與二次獨立 code/document review。
- Plan A 已完成；generic execution guard 仍維持後續 gap。

### 流程圖維護校正（2026-09-02）

本輪僅同步衍生視圖與文件：底層 Evidence engine 已完成，Spec Gap 欄位的 extension production wiring 尚未完成；`forge_deep_complete` 尚未傳 `verificationLevel`／`specGap`／`formalSpecReference`，trusted importer 未落地，`spec_verified` 維持 fail-closed。流程圖 parser、無 JS／外部依賴、9 rows、手機 CSS、Edge 1280×900／390×844、console 0 與 review P0/P1/P2=0 均通過。

## 2026-09-02 CONTEXT_BUILD production continuation（direct-plan）

### Building

完成 `CONTEXT_BUILD` production 接線、自動續跑、Context candidate 保存、`ADR_BUILD` 交接與 `Documents/` 原子提交。Grill 明確確認可建立具 round／decision provenance 的 `human_premise`；沒有外部文件不阻擋新產品，外部事實不足記完整 non-blocking Spec Gap。

### Not Building

不修改 `pi-main/`、不新增 dependency、不做 UI、Spec／TO_TICKET、trusted formal-spec importer 或 generic execution guard；不重做既有 Evidence Package 契約。

### Files

Production：`forge-runtime/skills/context-build/SKILL.md`（新增）、`src/knowledge/context-builder.ts`、`src/decision/adr-builder.ts`、`src/artifacts/documents-writer.ts`（新增）、`src/runtime/session-state.ts`、`extensions/forge-runtime.ts`。Tests：`tests/knowledge/context-builder.test.ts`、`tests/decision/adr-builder.test.ts`、`tests/artifacts/documents-writer.test.ts`（新增）、`tests/runtime/session-state.test.ts`、`tests/extensions/forge-runtime-extension.test.ts`。共 11 檔，超過 8 檔但不新增 service，因 stage、IO trust boundary 與測試必須分離；這仍是一個原子可用 slice。

### Tests（先 RED，再實作）

先由獨立子代理新增 11 個 PascalCase 測試並確認第一個紅燈；主代理再做最小 implementation。每個 slice 後由不同子代理重跑，final review 另派角色。測試覆蓋：human premise 建立／未確認不建立、Context／ADR 成功與 ambiguity／validation fail-closed、bundled skill 自動只呼叫一次／載入失敗、managed blocks 建立／保留 unmanaged content、cwd／base-hash 無效 rollback。

基線：evidence 32、state-machine 8、session-state 33、extension 167，共 240 passed；預期完成後 251 passed／0 failed。

### Execution Order

1. 子代理先新增／修改第一批測試。
2. 子代理執行確認紅燈並回報 failing test／原因。
3. 主代理確認紅燈後才做最小 production implementation。
4. 每個 slice 後由測試角色重跑。
5. 下一 slice 沒有紅燈就回步驟 1。
6. implementation 完成後由不同角色 final review。

### Verification

沿用既有 `forge-runtime` 驗證格式：`tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1`。Targeted batches 依序執行 context-builder／adr-builder／documents-writer、session-state、extension；最後執行相關全套，記錄實際 pass/fail，不在根目錄假設 npm workflow。

### Fragile assumptions

`human_premise` 只代表人類意圖，不得升格外部事實；完全無確認、material ambiguity 或 blocking limitation 必須停住。文件 writer 只能寫明確 `ctx.cwd/Documents/`，需 base-hash 與 rollback 保護。

### 2026-09-03 實作收斂與驗證

本 Plan A 已完成，狀態為 `implemented/verified`：bundled `context-build` skill 透過 `pi.skills` 掛載；`agent_settled` 各只啟動一次 `forge_context_complete`／`forge_adr_complete`。Context／ADR ambiguity 使用 fresh attempt 進 `WAIT_USER`，回答後 resume；三檔 managed Documents bundle 以 optimistic base hash、staging 與 atomic rollback 保護，成功後進 `TO_SPEC`。

Context／ADR ambiguity 可由 UI select 或一般文字 input 回答：UI 路徑在 `agent_settled` 排 fresh invocation，文字路徑立即 transform fresh invocation；兩者均保留 `sourceRoundId`／`humanDecisions`，不會卡住。

`human_premise` 與獨立 `humanDecisions` 保留 provenance。零可追溯證據、blocking limitation 或 material ambiguity 才 fail-closed；外部事實缺口保留為 non-blocking Spec Gap。handoff 使用 semantic secret/confidential 規則與 deterministic high-confidence PII redaction，輸出固定為 active PI project root 的 `Documents/`。production 入口已移除 `process.cwd()` fallback；只有非空 `ctx.cwd` 可啟動，缺失時 fail-closed。

驗證：`npm test` 324/324、base tsc pass、skill quick_validate pass、`git diff --check` pass。Pi-interactive tsc 的既有未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 缺 `highlight.js` 宣告（TS7016）仍為風險；不可寫成全綠。

## 2026-09-03 正式文件同步與停止邊界

本輪使用者取消目前實作任務，僅更新 AGENTS.md 規定的正式文件：root `CONTEXT.md`、`docs/adr/`、本 `docs/PLAN-A.md` 與 `docs/handoff.md`。`Documents/` 僅是未來 PI 使用者專案的生成產物，本輪不讀、不改，也不作為 canonical 真相來源。

本 Plan A 的已完成驗證史予以保留；但 `TO_SPEC` 只記為狀態節點存在／可轉入，TO_SPEC tool／handler 與後續工作尚未開始。流程交付停在 ADR 邊界，未獲使用者明確確認前不得開始 TO_SPEC、TO_TICKET 或其他後續實作。詳見 [`ADR-0028`](adr/ADR-0028-official-documents-and-to-spec-confirmation-boundary.md)。

## 2026-09-03 流程圖維護完成與現存 runtime gaps

- 本次維護完成：衍生圖已對齊 11 個真正 workflow state、7 種 WAIT_USER payload kind、Context／ADR production caller、Documents bundle 與 `human_premise` provenance。
- 目前邊界：`TO_SPEC` 僅是成功 ADR 後的 state node，沒有 executor；不得寫成 TO_SPEC 或 Plan B 已完成，且未獲使用者明確確認前停在 `adr-boundary-awaiting-user-confirmation`。
- 現存 gap：Evidence 空包仍需保留流程風險；`buildContextItems` production caller 尚未接入。這些不是本輪新增 runtime 修復範圍。
- 驗證證據：HTML parser、無 JS／外部依賴、11 rows、Edge 兩尺寸、console 0 與內容 review P0/P1/P2=0 PASS；未執行 runtime 測試。

## 2026-09-03 零候選探索性路由（唯一 Plan A）

### Building

Light Discovery `matches=[]` 時，不呼叫不存在 candidate 的 evidence tool；UI 固定選項為「同意／不同意」，runtime 沿用 `isApproval`，trim 後接受「好、可以、同意、照做、yes、ok、okay、y」（英文先 lowercase），含「確認」的其他字串不屬於此 opt-in；只有這些明確肯定才沿用既有 `human_premise` 進 exploratory，並建立 non-blocking `Spec Gap`。`resumeGrillWithAnswer` 在空 snapshot 保留已確認 premise，呼叫既有 `continueDeepKnowledge(..., true)`，沿用 `pendingKnowledgeRequest`。`forge_deep_complete` schema／params／`createEvidencePackage` 補接既有 `verificationLevel`／`specGap`／`formalSpecReference`。

### Not Building

有候選的既有 Light→Grill→Deep、不放寬 Evidence validator、不新增頂層 state／command／service、不修改 `session-state`／`evidence-engine`／`context-build-skill`、不做 UI、TO_SPEC／TO_TICKET、trusted importer、generic execution guard 或 `pi-main`。本案無 UI，因此不建 Plan B。

最高架構窄例外已明文化：僅空 `matches` 的固定探索 opt-in 明確肯定可由 `WAIT_USER` 直進既有 Deep；一般 `NEEDS_CONFIRMATION` 與有候選路徑仍須下一輪 Grill。

### Files

Production：`forge-runtime/extensions/forge-runtime.ts`。Tests：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。新增／修正測試：明確同意、拒絕、顯式 Spec Gap 傳遞、自動 Spec Gap、孤立 formalSpecReference 拒絕；後者另以非空 fixture 恢復三個既有 TUI grill-2／retry 契約，不是新增空知識 feature test。

五個新增 extension tests：`Extension_WhenDeepCompleteProvidesOnlyFormalSpecReference_ShouldRejectBeforeContextBuild`、`Extension_WhenDeepCompleteProvidesExploratorySpecGap_ShouldPropagateToEvidencePackage`、`Extension_WhenEmptySnapshotConsentAndDeepCompleteOmitMetadata_ShouldAddExploratorySpecGap`、`Extension_WhenEmptyDiscoveryHasHumanConfirmation_ShouldEnterDeepWithoutSecondGrillRound`、`Extension_WhenEmptyDiscoveryAnswerIsNotExplicitApproval_ShouldRemainWaiting`。`DeepCompletion_WhenOnlyGrillHumanPremiseExists_ShouldEnterContextBuild` 為修改既有測試；三個 TUI 測試為恢復既有契約。

### Execution Order

1. 子代理先新增兩個測試並打紅，記錄 failing test／原因。
2. 主代理確認紅燈後做最小 production implementation。
3. 不同子代理先執行實際 `tsx` 限定批次，再執行 `npm test`。
4. 完成驗證後更新 durable documents；任何未通過項目保留在 state，不寫成完成。

### Verification

以下命令均從 `forge-runtime` 目錄執行。以下 RED 1、RED 2 與 targeted 282 是核准時的歷史執行計畫；最終由正式 full 329/329 supersede，不代表本輪另有 targeted 282 實際結果：

1. RED 1：`.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 --test-name-pattern="Extension_WhenEmptyDiscoveryHasHumanConfirmation_ShouldEnterDeepWithoutSecondGrillRound" tests/extensions/forge-runtime-extension.test.ts`；期望先失敗。
2. RED 2：`.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 --test-name-pattern="Extension_WhenDeepCompleteProvidesExploratorySpecGap_ShouldPropagateToEvidencePackage" tests/extensions/forge-runtime-extension.test.ts`；期望先失敗。
3. 相關完整批次：`.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/discovery/light-discovery.test.ts tests/evidence/evidence-engine.test.ts tests/runtime/session-state.test.ts tests/extensions/forge-runtime-extension.test.ts tests/extensions/pi-grill-interactive.test.ts tests/grill/grill-result.test.ts tests/knowledge/discovery-evidence.test.ts`；歷史計畫預期 282 passed，本輪未另宣稱已執行。
4. 全套：`npm test`；期望 0 failed。
5. 靜態：`npm run check`；只允許既知未修改 `pi-main` 的 highlight.js TS7016，不得有新增 Forge Runtime error，也不得修改 `pi-main`。

### Fragile assumptions

`human_premise` 只證明意圖，不證明 API／協定／安全／相容性，不能升為 `spec_verified`。拒絕、空白或模糊回答維持 `WAIT_USER`；TO_SPEC 保留 ADR-0028 的人工確認邊界。

### Current status（歷史設計狀態）

歷史設計狀態為 `design-confirmed-not-implemented`；現況由下方 2026-09-04 收尾段落取代。

## 2026-09-04 零候選探索性路由收尾

現行執行紀錄（取代上述歷史計畫）：五個新增 extension tests 為明確同意進 Deep、拒絕仍等待、顯式 Spec Gap 傳遞、自動補 exploratory／Spec Gap、孤立 `formalSpecReference` 拒絕；實際 RED 為自動補 exploratory／Spec Gap 與孤立 `formalSpecReference` guard。最終以正式 full 329/329 為準，未將 targeted 282 寫成已執行。

- 狀態：implemented／verified／completed。UI 固定選項為「同意／不同意」；runtime 沿用 `isApproval`，trim 後接受「好、可以、同意、照做、yes、ok、okay、y」（英文先 lowercase），只有這些明確肯定才由空快照進既有 Deep；含「確認」的其他字串不屬於此 opt-in。拒絕／模糊回答停在 `WAIT_USER`，不記 premise；有候選流程不變。
- 空快照、無外部 evidence、有人類前提且三項 metadata 全省略時，runtime 自動補 exploratory 與 deterministic non-blocking Spec Gap；不完整 metadata 組合（含孤立 `formalSpecReference`）在 extension boundary fail-closed。
- 修改檔案：production `forge-runtime/extensions/forge-runtime.ts`；tests `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。後者以非空 fixture 恢復三個既有 TUI grill-2／retry 契約，不是新增空知識 feature test。不改 `pi-main`、Evidence validator、state machine、TO_SPEC。
- 正式 final5/check4 證據為歷史紀錄，已由下方 final10/check9 取代；final9/check8 亦為歷史紀錄。

- 最終文件同步：`npm test` 以 `.tmp/full-test-final10-0905.log` 為準，329 passed、0 failed、0 skipped、30778.2386 ms；`npm run check` 以 `.tmp/check-final9-0905.log` 為準，exit 2，21 個上游 TS7016，Forge Runtime 三個檔案 0 error。final9/check8、final8/check7 及更早僅為歷史紀錄，已由 final10/check9 取代。
- 修改範圍加入 `forge-intent-context-flow.html`，僅作衍生視圖同步，不是 runtime 行為來源；`.tmp/intent-flow-release-validation-20260904.log` 的 CDP、靜態與視覺驗證通過，mobile／desktop overflow 均為 0。歷史 targeted 282 為未執行預估，已由正式 329 全量測試取代。

## 2026-09-05 封版同步

- 狀態：`implemented-verified-completed`。最高架構窄例外已同步：只有空 `matches` 固定 opt-in 的明確肯定可由 `WAIT_USER` 直進既有 Deep；一般 `NEEDS_CONFIRMATION` 仍須下一輪 Grill，有候選流程不變。

## 2026-09-05 零候選同意範圍與 Context Build 過期結果復原

工作項目：`zero-candidate-context-build-recovery-20260905`

狀態：實作完成，正式 check 有既有外部阻塞。本案沒有 UI gap，不產生 Plan B。

## 2026-09-05 實作完成與驗證

- 狀態：實作完成，正式 check 有既有外部阻塞。
- workflow-scoped exploration consent 已在同一 workflow 跨兩個 gate 共用，並於 cancel、new workflow、switch、reset 清除；其他人類決策不沿用。
- stale completion 仍 fail-closed；第一次 stale 在下一個 `agent_settled` 只重播目前 identity 一次，第二次不循環，`/forge-runtime continue` 只人工重播目前 identity。
- 未修改 `session-state`、`pi-main`、queue 或 UI。
- 驗證：focused 4/4、`npm test` 333/333、主 tsconfig pass、兩個獨立 review PASS。`npm run check` 唯一阻塞是既有上游 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 的 highlight.js 子路徑缺少型別，共 20 個 TS7016；未修改 `pi-main`。

### Building

- exploration consent 只在同一 workflow 內有效，涵蓋缺少來源與空 snapshot gate；新 workflow、cancel、reset、switch 時清除。相同 workflow 重新搜尋仍為空時，沿用已記錄同意，不再重問。
- 保留 Context Build identity 比對與過期結果拒收。`agent_settled` 收到 stale completion 後，對目前 identity 自動 replay 一次；同一 identity 的自動重試耗盡後，不再自動迴圈，只允許 `/forge-runtime continue` 恢復。
- replay 使用既有 invocation／pending marker 與 settled 流程，不新增 state、queue 或背景流程。

### Not Building

- 不修改 `pi-main/`、session-state contract、Context builder／skill、Evidence validator 或 UI。
- 不放寬 stale identity guard，不接受舊 Context Build 結果；不新增 retry command、backoff、平行 queue 或永久 consent。
- 不處理與本 ticket 無關的 Grill、ADR、TO_SPEC／TO_TICKET 流程。

### Approach

1. 先由獨立測試子代理新增並執行三個 RED：`Extension_WhenMissingAssetApprovalLeadsToEmptySnapshot_ShouldNotAskConsentTwice`、`Extension_WhenContextBuildCompletionIsStale_ShouldRetryCurrentInvocationOnce`、`Extension_WhenContextBuildStaleRetryIsExhausted_ShouldReplayOnlyOnContinue`。
2. 主代理確認 RED 後，在既有 consent marker 與 Context completion handler 上做最小實作；不改上游與既有 fail-closed 條件。
3. 由獨立驗證子代理執行 targeted tests、既有 extension test 檔與 package check。

### Files

| 檔案 | 變動 |
| --- | --- |
| `forge-runtime/extensions/forge-runtime.ts` | workflow-scope consent 清理／重用，以及 stale Context Build 一次 replay 與 `/forge-runtime continue` 邊界。 |
| `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | 新增三個回歸測試，覆蓋重問、一次自動 replay、耗盡後僅 continue。 |

不新增檔案、不新增 dependency、不修改 `pi-main/`。

### Tests

- focused 驗證 4/4；完整 `npm test` 333/333；主 tsconfig pass；兩個獨立 review PASS。
- `npm run check` 唯一阻塞是既有上游 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 的 highlight.js 子路徑缺少型別，共 20 個 TS7016；未修改 `pi-main`。

### Execution Order

1. 下一 session 先讀 `docs/handoff.md`、本 Plan、`CONTEXT.md`、相關 ADR 與本 ticket 狀態檔，展示摘要並取得確認。
2. 獨立測試子代理新增三個 RED 並回報失敗證據。
3. 主代理只修改兩個指定檔案，先修 consent scope，再修 stale replay budget。
4. 獨立驗證子代理執行 targeted、既有 extension 檔案測試與 `npm run check`。
5. 驗證通過後更新 durable documents；未通過則保留實際錯誤與未解問題。

### Verification（已完成）

完成條件已達成：focused 4/4、完整 `npm test` 333/333、主 tsconfig pass、兩個獨立 review PASS。正式 `npm run check` 的唯一阻塞為既有上游 highlight.js 子路徑型別缺失（20 個 TS7016），沒有因此修改 `pi-main`。

### Fragile assumption

模型或 provider 可能重播舊 invocation identity；runtime 必須以目前 identity 判定並拒收舊結果。一次 replay budget 必須綁定目前 identity，並在新 workflow／cancel／reset／switch 清除；若無法可靠辨識目前 identity，維持 fail-closed 並停止。
