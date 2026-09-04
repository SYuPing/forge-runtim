---
title: Forge Runtime v4 開發記錄
type: development-record
scope: 開發目標、重大決策、實作里程碑與目前狀態
updated: 2026-09-05
source: 本 repo 的架構文件、ADR、Plan、handoff 與 agent-state
status: complete
---

# Forge Runtime v4 開發記錄

## 2026-09-05 零候選同意與 Context Build 復原

- 目標：修正同一 workflow 內零候選 exploration consent 被重問，以及 Context Build stale completion 被拒收後無法續跑。
- 重大決策：consent 僅跨缺少來源與空 snapshot gate 有效，於新 workflow／cancel／reset／switch 清除；stale 結果維持拒收，agent_settled 對目前 identity 自動 replay 一次，耗盡後僅 `/forge-runtime continue`。
- 重大實作：`forge-runtime/extensions/forge-runtime.ts` 加入 workflow-scoped consent、目前 Context invocation 保留、stale fail-closed 後一次 settled replay，以及 exhaustion 後的條件式 `/forge-runtime continue`；`forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 覆蓋四個 public seam。
- 驗證：四個 public-seam 測試 RED→GREEN、focused 4/4、完整 333/333、主 tsconfig typecheck 與 standards/spec review PASS；`npm run check` 受 20 個既有 `pi-main` TS7016 阻塞。
- 目前狀態：implementation complete；外部 typecheck blocker 保留，未修改 `pi-main`。

## 2026-09-04 零候選探索性路由完成

- 目標：讓沒有知識文件的新產品在明確人類 opt-in 後進入既有 Deep exploratory 路徑，不影響已完成的有候選流程。
- 重大實作：UI 固定選項為「同意／不同意」；runtime 沿用 `isApproval`，trim 後接受「好、可以、同意、照做、yes、ok、okay、y」（英文先 lowercase），含「確認」的其他字串不屬於此 opt-in；拒絕／模糊回答停在 `WAIT_USER` 且不記 premise。Deep completion metadata 保持相容；空快照、無外部 evidence、有人類前提且 metadata 全省略時自動補 exploratory 與 deterministic non-blocking `Spec Gap`；不完整組合在 extension boundary fail-closed。
- 範圍：production 僅 `forge-runtime/extensions/forge-runtime.ts`；tests 為兩個 extension 測試檔；未修改 `pi-main`、Evidence validator、state machine 或 TO_SPEC。
- 驗證：final5/check4 為歷史紀錄，已由下方 final7/check6 取代。
- 狀態：本 ticket completed；TO_SPEC executor 仍需另案與使用者確認，未 commit／push。

## 文件用途

本文件只記錄開發目標、重大設計決策、實作過程、驗證結果與目前狀態。錯誤根因、修復方式與可重用教訓集中在 [`lesson_learn.md`](./lesson_learn.md)，避免兩份文件各自形成不同真相。

## 2026-09-02 CONTEXT_BUILD production continuation 設計

- 目標：接上既有 Evidence Package 契約的 `CONTEXT_BUILD` production caller、自動續跑、candidate 保存、`ADR_BUILD` 與 `Documents/` 原子文件提交。
- 重大決策：Grill 中使用者明確確認需求、範圍或選擇即可建立帶 round／decision provenance 的 `human_premise`；沒有外部文件的新產品仍可進 Context Build。外部事實不足記 non-blocking Spec Gap。
- fail-closed 只適用於完全無可追溯確認、material ambiguity 或 blocking limitation；不得把 human premise 當 API／相容性／法規／安全事實。
- 交付文件：ADR-0027、Plan A、ticket 與 agent-state 已建立；本輪狀態仍為 `design-approved-not-implemented`。

## 開發目標與架構基線

- 在 `forge-runtime/` 建立 Workflow Sovereignty、evidence-driven、knowledge-first 的 runtime。
- 由 Workflow 控制 state transition；LLM 只負責理解、推理、候選與寫碼；`WAIT_USER` 是人類決策邊界。
- 以 PI package、extension、skill 承載功能，預設不修改 `pi-main/`；只有明確核准的 test-only Terminal seam 與 ADR-0012 display-only core 路徑例外。
- 第一階段先完成 workflow kernel、state machine、mandatory stages、evidence traceability、validation loop；完整 UI 與大型知識平台不在第一階段。

主要依據：`FORGE_RUNTIME_Arch_v4.md`、`CONTEXT.md`、`docs/adr/ADR-0001-forge-runtime-v4-foundation.md`、`docs/PLAN-A.md`。

## 重大實作時間線

### 2026-08-07 至 2026-08-10：Foundation、Router 與最小 UI

- 建立 `forge-runtime/` package 與 workflow kernel。
- 固定 front-door router、單一 open workflow、`WAIT_USER` 優先、Light Discovery、Deep Knowledge gate 與 evidence traceability。
- 以 PI 既有 status、custom message 與 selector 完成 Plan B 最小 UI slice；固定 widget tree、完整 dashboard 與常駐 evidence/validation widget 留待後續決策。

### 2026-08-09 至 2026-08-16：Grill control、completion 與互動驗收

- 完成 active workflow control、candidate snapshot、唯讀 evidence verification、completion tool 與 completion omission recovery。
- `forge_grill_complete` 成為正常 completion 唯一入口；`NEEDS_CONFIRMATION` 進 `WAIT_USER`，`READY_FOR_DEEP` 通過 gate 後自動進 Deep。
- 完成 `/retry`、`cancel`、`switch` recovery 邊界、固定「自行輸入…」入口、四參數 `ctx.ui.custom` factory 與真實 PI TUI test-only Terminal seam。
- Plan A #1 至 #17 完成，包含真實 TUI、單次輸入 turn boundary 與 omission settled 驗收。

### 2026-08-17：Grill invocation transport

- 移除會把完整 Grill invocation 改寫回原始 request 的 `pendingUserMessageRewrite` 路徑。
- 讓完整 invocation 同時成為 finalized user message 與 provider payload，並以三條 provider-context 測試固定傳輸契約。

### 2026-08-19 至 2026-08-20：完成終止邊界與 display-only

- 使用者核准方案 C 與窄化 `pi-main` core 例外；支援基線為 coding-agent `0.83.0`、commit `321bbe6`、branch `main`。
- 成功 `forge_grill_complete` 回傳 `terminate: true`，移除只抑制完成 prose 的 `suppressCompletionTurn`。
- PI ExtensionAPI 新增 `deliverAs: "displayOnly"`：訊息進 UI、transcript、session persistence/reload，但不進 provider context，也不觸發 turn。
- 以 `excludeFromContext: true` 貫通 provider conversion、compaction rehydrate、branch summarization rehydrate 與 session-file round-trip；舊 session 缺 marker 時維持舊語意。
- Forge 只在成功 `NEEDS_CONFIRMATION` 的 `WAIT_USER` state message 使用 display-only；`READY_FOR_DEEP` 仍自動進 Deep。
- 人類回答流程固定為 `WAIT_USER → USER_CONFIRMED → GRILL`：先 resume、重用 `pendingReplayInvocation`，再送完整 follow-up invocation；direct human input 仍走 transform。

主要依據：`docs/adr/ADR-0011-grill-completion-terminal-boundary.md`、`docs/adr/ADR-0012-display-only-custom-message.md`、`agent-state/grill-completion-terminal-boundary-20260819.md`。

## 驗證與交付狀態

- Forge：`npm test` 132 passed；interactive 9 passed；post-review check/full exit 0。
- PI focused display-only 測試：76 passed／2 skipped；Biome 991 files exit 0；branch summarization final 1 passed。
- PI tsgo 僅剩 `packages/ai` 六個既有 baseline errors；canonical `npm run check` 未執行，因該命令含 `--write`，改用唯讀子命令。
- 最終 Standards／Spec review 均為 0 findings；Plan A 已完成，Plan B 未執行。

## 目前狀態與邊界

- 已完成：Plan A #1 至 #17、Grill invocation transport、completion terminal boundary、display-only contract。
- Plan B 僅完成 status/custom-panel/selector 最小 slice；固定 widget tree、常駐 evidence/validation/repair widget 與人工視覺驗收仍未完成。
- 不新增 top-level recovery stage、第三種 completion status、自動 retry、background steer、queue、parallel workflow 或 Deep 後新歧義轉移。
- `pi-main/` 只保留核准的 test-only Terminal seam 與 ADR-0012 display-only core 路徑；其他 core 變更禁止。
- 未解風險：queued steer、extension API fire-and-forget lifecycle、Node `DEP0190` warning、`packages/ai` 六個 baseline errors。

## 2026-08-22 Light Discovery 設計核准（當時設計階段狀態）

- 目標：建立 `start_forge → Light Discovery` 的單一可插入流程，依原始 `userMessage` 在 `wiki/` 與 `code_base/` 找出候選檔名／metadata。
- 重大決策：對外只有 workspace/root 與 raw message 的 public seam；內部固定 Input normalization → deterministic Core → Output normalization；每來源最多 3 筆且固定排序。
- 重大邊界：只輸出 matches 與 warnings/source availability；metadata 僅 `source`、`relativePath`、`fileName`、`extension`；不做全文、不回傳 full-content／summary／Pattern Card／Grill snapshot／決策；不搜尋 target source、docs、Memory、pi-main 或 OS。
- 相容決策：既有 Grill 所需 full-content/snapshot 由模組外部 adapter 暫時提供；既有 extension seed extraction 於實作時移入 Light Discovery module，caller 只傳 raw message。
- 當時設計階段狀態：設計已核准，尚未實作或驗證。後續 current completion 見下方「2026-08-22 Light Discovery 實作與驗證」。詳細決策見 [`ADR-0014`](../docs/adr/ADR-0014-light-discovery-file-metadata-module.md)，執行計畫見 [`docs/PLAN-A.md`](../docs/PLAN-A.md)。

## 來源索引

完整決策與證據見 `FORGE_RUNTIME_Arch_v4.md`、`CONTEXT.md`、`docs/PLAN-A.md`、`docs/PLAN-B.md`、`docs/adr/`、`docs/handoff.md` 與 `agent-state/`。本文件不重複收錄逐筆 bug；請查閱 [`lesson_learn.md`](./lesson_learn.md)。

## 2026-08-21 Intent route-only LLM

- 目標：將使用者輸入到 Intent Understanding 收斂為單一 route contract，降低修改 A 影響 B 的風險。
- 重大實作：LLM 僅輸出 `passthrough`／`start_forge`；路由規則與 raw input 分離，`IntentModelContext` 是唯一第二參數 seam，`IntentInput` 不含 model context；workflow guard、10 秒 fail-closed、rawText 保留、`/grill-run` canonical wrapper、extension handoff private seed helper 與 faux provider queue／route call-count 調整已完成；未修改 `pi-main/`。
- 驗證：intent 12/12、extension 91/91、loader 2/2、`npm run check` exit 0、`npm test` 146/146；證據位於 `.tmp/intent-route-only-systemprompt-*.log`。
- 2026-08-22 最終審查通過：Standards 與 Spec final review 均為 0 findings；本 ticket acceptance／closure 完成。下一步只能等待使用者確認後再進入 Light Discovery。詳細決策見 [`ADR-0013`](../docs/adr/ADR-0013-intent-route-only-llm.md)，狀態見 [`agent-state/intent-route-only-llm-20260821.md`](../agent-state/intent-route-only-llm-20260821.md)。

## 2026-08-22 Light Discovery 實作與驗證

- 使用者核准 ADR-0014 第一階段並完成實作：`wiki/`、`code_base/` metadata-only discovery，各來源最多 3 筆、相對路徑 deterministic，輸出 warnings/sourceAvailability；缺失來源人工核准流程保留。
- public seam 只收 rootDir 與 raw userMessage；相容 adapter 留在 `forge-runtime.ts` 外部，負責 Grill／Deep Knowledge 所需內容與 relevance 計算，未擴大 Light Discovery contract。
- 測試遷移清除 2 個 stale callers、移除 10 個淘汰測試、改寫／保留 5 個並還原 2 個強相關 Deep expectations。production bug 已修復：adapter 依 raw request seeds 計算 path/content、`matchedSeeds`、`score`。
- 驗證：互動 9/9、focused 79/79、`npm run check` exit 0、完整 `npm test` 140/140，0 fail/skip/todo；證據為 `forge-runtime/.tmp/review-fix-verify-*.log`。implementation、verification 與 two-axis review 均完成；僅有既有 Node `DEP0190` warning。
- 依使用者於 2026-08-22 核准的 v4 分階段交付例外，本輪僅完成 phase one 的 metadata-only discovery；v4 end-state 不變，完整多來源／Summary／Evidence ID 另案處理。
- 初次 Standards 與 Spec review 各有 3 個 findings；採納修正後 Spec re-review 為 0 findings，Standards re-review 的 stale counts 已完成文件修正。

## 2026-08-23 Grill 到 Deep Knowledge 交接策略核准

- 使用者核准保留 Grill → Deep Knowledge 階段分工：Grill 查證並取得人類決策，Deep 沿用同一 immutable snapshot 與決策，不重讀相同證據，只補後續明確需要的新來源。
- 核准 relevance clarification 回流 Light Discovery、正式 gate 統一 debug completion、round 單調遞增與 snapshot evidence 隔離；本 ticket 尚未實作。
- 詳細決策見 [`ADR-0015`](../docs/adr/ADR-0015-grill-deep-knowledge-handoff-boundary.md)，計畫見 [`docs/PLAN-A.md`](../docs/PLAN-A.md)，狀態見 [`agent-state/grill-deep-boundary-risk-20260823.md`](../agent-state/grill-deep-boundary-risk-20260823.md)。本輪沒有經測試證實的新 bug。

## 2026-08-24 Grill 到 Deep Knowledge 交接實作完成

- 依核准的 Plan A 完成 Grill → Deep Knowledge boundary：Grill 保留正式 completion gate 與人類決策邊界，Deep 只接收已核准的 immutable snapshot/evidence。
- 完成 relevance 不足時回到 Light Discovery、round 單調遞增、snapshot evidence 隔離，以及 Deep handoff 前同步釋放 pending/tool lease 的 lifecycle 修正。
- 使用者核准方案 A：decision 去重與 UI lease 使用 runtime-issued `roundId + kind + decisionId`；不以可碰撞的字串推測等待類型，也不替使用者完成 relevance clarification。
- 未修改 `pi-main/`，未新增 dependency；本輪變更集中於 `forge-runtime/` 與對應測試及交付文件。
- 驗證完成：`npm test` 157/157、兩份 tsconfig 的 `npm run check` 均通過；Standards 與 Spec 雙軸 review 均為 0 findings。完整證據與狀態見 [`agent-state/grill-deep-boundary-risk-20260823.md`](../agent-state/grill-deep-boundary-risk-20260823.md)；bug 根因與教訓見 [`lesson_learn.md`](./lesson_learn.md)。
- 本 ticket 已完成；後續不擴充 Deep semantic、Pattern Card、persistence 或第二 verifier，除非另案核准。

## 2026-08-24 Deep Knowledge Retrieval／Understanding 設計核准

## 2026-08-25 Deep Knowledge 實作與驗證完成

- 目標：完成 Deep Retrieval／Understanding、Evidence Package 與五個工具，維持 Workflow 對 state、證據與人類決策的最終控制權。
- 重大決策：identity=`attemptId+sourceRoundId+phase`；retry 新 attempt 並回原 Deep phase；cancel／continue 保留 input／evidence 並回原 Deep phase，不回 Grill；stale outcome quiet reject；active-tools capability fail-closed。
- 重大實作：人類決策以 `問題：…；決定：…` 保存且首筆 decisionId 不可覆寫；package 先注入 human decisions，再拒絕模型 duplicate；Deep 重用 Grill fetched evidence。固定上限為 query 1500、每 source／Grill round 8 次、單筆 256 KiB、整輪 2 MiB、各類 50 筆、每段 4,000 code points，超限不改 state，讀檔前先 stat。
- 初次 Deep 實作驗證為 `npm test` 208/208；identity handoff follow-up 完成後完整 suite 為 209/209，`npm run check` exit 0。logs 位置與 final review 判定見 [`docs/handoff.md`](../docs/handoff.md)。
- 狀態：初次 Deep 實作已驗證；後續 identity handoff follow-up 已於下方完成，目前未 commit、未 staged。

- 設計目標：在既有 Grill immutable snapshot 交接之上，建立 `Deep Retrieval → Knowledge Understanding → Evidence Package` 的最小完整流程，完成後轉入 `CONTEXT_BUILD`。
- 重大決策：Grill 只收集決策所需的最小證據；Deep 沿用 Grill 實際引用的完整 evidence 與 decisions，不重讀相同 evidence。客觀缺口可補查，新增 evidence 必須使用新 ID；新需求／取捨／矛盾由 Workflow 建立 `WAIT_USER`，來源整體不足回 `LIGHT_DISCOVERY`。
- 重大決策：Retrieval 可搜尋受限 `wiki/`／`code_base/` 並鎖定證據；Understanding 只能讀固定集合。三種 result 是 `completed`、`needs_decision`、`needs_discovery`；Evidence Package 僅含 evidence、decisions、findings、非阻擋 limitations，completed 由 deterministic validator 守門。
- 重大決策：沿用主 session active model；使用者撤回模型派發、fallback、custom loop 設計。本 ticket 不做 Pattern Card、持久化、第二 verifier、UI、外部來源或 `pi-main/`。
- 歷史快照（其後已完成）：當時狀態為 ready-for-implementation；實作範圍、測試與驗證命令記錄於 [`docs/PLAN-A.md`](../docs/PLAN-A.md)。初次完成狀態為 208/208，最新 handoff follow-up 與 209/209 驗證見下方「2026-08-25 Deep identity handoff 修正完成」及 [`docs/handoff.md`](../docs/handoff.md)。

## 2026-08-25 Deep identity handoff 修正完成

- 目標：讓首次 Grill READY→Deep handoff 將 runtime-issued `attemptId`、`sourceRoundId`、`phase` 傳入下一個模型回合，恢復 Deep search 依設計流程執行。
- 重大實作：`forge-runtime/extensions/forge-runtime.ts` 的三個 caller 以 closure-local setter 傳遞 `pendingReplayInvocation`；`continueDeepKnowledge` 建立 attempt 後設定 marker，再以既有 `pi.sendUserMessage(..., { deliverAs: "followUp" })` 傳送 identity-bearing invocation。
- 邊界：未修改 stale guard、tool schema、`pi-main/`，未新增 sequential 設定或 UI。
- 驗證：handoff regression 由 114 pass/1 fail（handoff undefined）修正為 115/0；聚焦 4/4；相關 147/147（`.tmp/deep-related-green-20260825.log`）；完整 209/209（`.tmp/deep-full-green-20260825.log`）；`npm run check` exit 0（`.tmp/deep-caller-check-20260825.log`）；final quick review 0 functional findings。
- 狀態：已完成實作與驗證；僅待使用者在真實 PI session 重跑原始情境，未形成 blocker。

## 2026-08-25 最後驗證與工作樹狀態

- 工作期間 HEAD 由外部移至並同步 `origin/main` 的 `324501a0412bbfdead9642aeb845bb26192b57cc`，不是本代理 commit；目前本 ticket 剩九檔 tracked 修改未提交。
- 隔離 detached worktree 只套用九檔 diff 後，`npm run check` exit 0，四個關鍵測試均 4/4 exit 0；證據：`forge-runtime/.tmp/deep-isolated4-check-20260825.log`、`forge-runtime/.tmp/deep-isolated4-targeted-20260825.log`。
- 主工作樹 full 仍 209/209。狀態維持已完成實作與驗證；唯一未解是使用者尚未在真實 PI session 重跑原始情境。

## 2026-08-26 Deep 階段輸出守門完成

- 目標：阻止 Deep Retrieval／Knowledge Understanding 在正式實作 gate 前輸出 RTL、程式碼或其他 implementation artifact，保留合法 Deep toolCall。
- 重大過程：確認原 assistant prose guard 只覆蓋 Grill；新增 `hasActiveDeepAttempt`，在 Deep active attempt 的 `message_update` 與 `message_end` 清空 `text`／`thinking`，final message 只保留 toolCall。未修改 `pi-main/`。
- 驗證：先由 `PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue` 以 `FORBIDDEN_IMPLEMENTATION_MARKER` 形成紅燈（exit 1），實作後 targeted 9/9；修正兩個 fixture／transition 測試契約後，`npm test` 209 passed/0 failed/0 skipped，`npm run check` exit 0；production review 零 functional findings，scope on target。
- 狀態：ticket `deep-stage-output-guard-20260826` 已完成並驗證。未解風險與後續邊界見 [`lesson_learn.md`](./lesson_learn.md) 與 [`docs/handoff.md`](../docs/handoff.md)。

## 2026-08-26 Deep identity handoff activation 修正完成

- 目標：避免 Grill completion 後 Deep tools 在 identity-bearing followUp 進入 `input` 前被提前啟用，造成舊 identity 呼叫先被 stale reject。
- 重大決策與實作：Deep Retrieval activation 已從 `continueDeepKnowledge` 延後至 exact `pendingReplayInvocation` input gate；gate 先清 marker，再啟用 Deep Retrieval tools，之後沿用 `{ action: "continue" }`。保留 identity 三元組、followUp transport、stale quiet reject、主 session 與既有 verifier，未修改 `pi-main/`。
- 驗證：新增 2 個 timing regression；targeted 117/117、完整 `npm test` 211/211、`npm run check` exit 0。
- 狀態：ticket `deep-followup-identity-activation-20260826` 已完成實作與驗證；本輪未發現新 bug。未解風險與證據見 [`docs/handoff.md`](../docs/handoff.md) 與 [`agent-state/deep-followup-identity-activation-20260826.md`](../agent-state/deep-followup-identity-activation-20260826.md)。

## 2026-08-26 Final review medium finding 修正完成

- 重大修正：`requireDeepToolBoundary` 必須同時具備 tool boundary 與 `sendUserMessage`，才能完成 Deep handoff；identity-bearing followUp 無法送出時不得形成半完成狀態。
- 修正後驗證：targeted 117/117、`npm test` exit 0、`npm run check` exit 0；本輪未發現新 bug。

## 2026-08-27 Deep stale-result loop 完成

- 目標：只修正 Deep Retrieval stale completion 反覆循環，保留其他 workflow 行為。
- 重大實作：Deep stage panel 改為 `displayOnly`；input 僅預載工具；matching user `message_start` 才消費 pending identity；pending 期間阻擋 Deep tool_call；工具預載與 delivery 授權分離。
- 驗證：真實 AgentSession／InteractiveMode／faux provider regression 未修版 RED 1 fail、修正版 GREEN 1 pass，後續合法 Deep search accepted；extension targeted 117/117、PI integration 10/10、完整 `npm test` 212/212、`npm run check` exit 0。logs 位於 `forge-runtime/artifacts/test-logs/`。
- 狀態：`deep-stale-result-loop-20260826` 已完成自動驗證，等待使用者在真實 PI session 重跑原始情境；review 僅限指定 scope，未改 `pi-main/`。
- 真實 PI v0.83.0 已從 repo root 以 `.\pi-main\pi-test.bat --approve` 啟動，啟動畫面列出 `forge-runtime.ts`；此為啟動 smoke check，尚未完成原始情境人工驗收。

## 2026-08-28 Deep completion stale termination 規劃

- 目標：補齊兩個 Deep completion 工具共六個 stale return 的 `terminate: true`，避免同批過期 completion 反覆進入 agent loop。
- 重大規劃：同一 active attempt 最多接受一個 `needs_decision`；接受後進 `WAIT_USER` 並清 attempt。使用者回答保留 `sourceRoundId`／`phase` 建立新 attempt，fresh attempt 可再次 decision。
- 交付範圍：production 只預計修改 `forge-runtime/extensions/forge-runtime.ts`，測試只預計修改 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`；不處理 `CONTEXT_BUILD` 或 scheduler。
- 狀態：Plan A 已產出但等待使用者核准；本輪無程式／測試修改，無測試結果。

## 2026-08-28 Deep completion stale termination 實作與驗證完成

- 目標：補齊兩個 Deep completion 工具六個 stale return 的 `terminate: true`。
- 重大實作：Plan A 經核准；兩個 public fresh-attempt regression 先紅 `terminate undefined` 後綠；六個 stale return 全部補上 termination。四個 inner branch 不新增私有 mock／test hook。
- 驗證：focused 124/124、full 219/219、`npm run check` pass。證據：`forge-runtime/.tmp/deep-completion-stale-termination-focused-20260828.log`、`forge-runtime/.tmp/deep-completion-stale-termination-full-20260828.log`、`forge-runtime/.tmp/deep-completion-stale-termination-check-20260828.log`。
- 未改 `session-state.ts`、scheduler、UI、schema/API、`pi-main/`；mixed tool batch `every(terminate)` 風險保留在 scope 外；獨立 review 已完成，可交付／提交。

## 2026-08-27 Deep target source contract 設計核准

- 目標：修正 Grill→Deep Retrieval 的 target manifest 轉換與 `targetSource` 輸入契約，避免缺少檔名時誤耗用 Deep attempt，並封住同批 stale sibling。
- 核准決策：沿用 `workflow.snapshot.candidates` 列出 manifest；target 必填 `targetSource`；缺少時 retryable invalid 且保留 attempt，非唯一匹配才進 `WAIT_USER`；stale sibling 回 `terminate: true`。完整契約見 [`ADR-0017`](../docs/adr/ADR-0017-deep-target-source-contract.md)。
- 狀態：`design-approved-ready-for-red`。尚未修改 production code、尚未執行測試；下一步先 RED，再最小實作與獨立驗證。

## 2026-08-27 Deep target source contract 實作與驗證完成

- 目標：完成 Grill→Deep Retrieval 的 target manifest 與 `targetSource` 契約，避免缺少檔名誤進 `WAIT_USER` 或耗用 attempt，並讓同批 stale sibling 正確終止。
- 重大實作：follow-up invocation 先提供由 `workflow.snapshot.candidates` 建立的 manifest；target 要求 `targetSource`；缺欄位保留 retry 額度；非唯一匹配才建立 `WAIT_USER`；stale sibling 回傳 `terminate: true`。
- TDD 與驗證：完成 RED→GREEN；targeted regression、schema phase 與完整套件驗證通過，完整 `npm test` 為 217/217，`npm run check` exit 0。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/.tmp/schema-phase-targeted-20260827.log`、`forge-runtime/.tmp/targeted-regression-20260827.log`、`forge-runtime/.tmp/post-schema-test.log`、`forge-runtime/.tmp/post-schema-check.log`。
- 審查與狀態：Standards／Spec 雙軸 re-review 均 PASS；ticket `deep-target-source-contract-20260827` 已完成，未修改 `pi-main/`。

## 2026-08-28 Deep completion stale termination review correction

## 2026-08-28 Deep retryable recovery contract 設計核准

- 目標：定義空 target manifest 與 duplicate decision invalid 後的可重試復原，避免 Deep 在 `WAIT_USER` 反覆詢問無候選 target，並確保 invalid 不誤進 `CONTEXT_BUILD`。
- 重大決策：`manifest=[]` 且 `source=target` 保留同一 identity 回 retryable invalid，要求模型自行改用 `wiki`／`code_base`；duplicate `decisionId` 拒絕並保留同一 Understanding attempt，要求同 identity 重送唯一 IDs。完整契約見 [`ADR-0018`](../docs/adr/ADR-0018-deep-retryable-recovery-contract.md)。
- 狀態：只完成設計文件，尚未實作；Plan A 已列出五個測試、baseline 與新 session 執行順序。

- 兩個 public regression 正式名稱為 `Extension_WhenRetrievalNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt` 與 `Extension_WhenUnderstandingNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt`；完整覆蓋 needs_decision、WAIT_USER/clear、舊 identity stale+terminate/state-tools 不變、fresh identity 保留與再次 needs_decision。既有三個 stale tests 補上 `terminate` assertion。
- 最終驗證：focused 124/124、full 219/219、check pass；logs 為 `forge-runtime/.tmp/final-focused-test.log`、`forge-runtime/.tmp/final-full-test.log`、`forge-runtime/.tmp/final-check.log`。PI smoke 成功啟動，真實模型回 `smoke ok`、exit 0（`forge-runtime/.tmp/pi-smoke.log`）。獨立 review 已完成，可交付／提交。

## 2026-08-28 Deep retryable recovery contract 實作與驗證

- 目標：讓空 target manifest 與 duplicate decision invalid 可在同一 Deep attempt 修正重送，避免 `WAIT_USER` loop，且只有驗證成功的 Evidence Package 才進入 `CONTEXT_BUILD`。
- 重大實作：production 僅修改 `forge-runtime/extensions/forge-runtime.ts`；空 manifest 回 retryable invalid、要求改用 `wiki`／`code_base` 且不呼叫 `handleDeepResult`；Evidence Package validator 只有錯誤包含 `決策 ID 重複` 時增加 `retryable:true`，其他 validation failure 維持原契約。tests 僅修改 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`，完成五個指定測試。
- 驗證：TDD RED 兩階段、focused 129/129、本地排除 interactive suite 214/214；標準 `npm test` 214 pass/1 fail（既存 qwen token-plan JSON 缺失）；`npm run check` exit 2、38 errors（既存 terminal 與 pi-main 依賴／型別問題）；測試型別修正後 `tsc` exit 0。證據見 ticket、ADR-0018、Plan A 所列 logs。
- 邊界與狀態：未改 `session-state.ts`、`pi-main`、API/schema/UI/scheduler/snapshot，未新增依賴、Plan B、自動 fallback 或模糊 matching。狀態為 `implemented-verified-reviewed`；真實 PI 原情境人工驗收尚待完成，Node `DEP0190` 為非阻塞 warning。

### 初次 review 修正里程碑（已修）

- Standards P1 durable state 已補齊；P2 重複 setup 已抽為單一 `prepareDeepRetrieval` helper。Spec P1 已補至少 9 次 empty target 仍回 `target_manifest_empty` 的 budget assertion，並將 retryable 從通用 validation branch 縮到 duplicate error；Spec P2 stale state 已修；Plan A 已將 209 pass/1 fail 標為實作前基線。
 - Review-fix 驗證：focused 129/129、本地 214/214；標準 `npm test` 214 pass/1 fail，唯一為既存 qwen 缺檔；`npm run check` 38 個 baseline errors 且未指向本 ticket 兩檔。證據：`forge-runtime/.tmp/deep-recovery-review-focused.log`、`deep-recovery-review-local.log`、`deep-recovery-review-npm-test.log`、`deep-recovery-review-check.log`。

### 最終雙軸 re-review 里程碑

- Final test refactor 後 extension 129/129（`forge-runtime/.tmp/deep-recovery-final-refactor-focused.log`）；本地排除 interactive suite 214/214（`forge-runtime/.tmp/deep-recovery-review-local.log`）；標準 `npm test` 214 pass/1 fail，唯一為既存 qwen 缺檔（`forge-runtime/.tmp/deep-recovery-review-npm-test.log`）；final check 為 38 個既存 baseline errors，沒有錯誤指向本 ticket 修改的 `forge-runtime.ts` 或 `forge-runtime-extension.test.ts`（`forge-runtime/.tmp/deep-recovery-final-check.log`）。`pi-grill-interactive.test.ts` 不是本 ticket 修改檔。
- 最終 re-review 結果：Standards P0/P1/P2=0；Spec P0/P1/P2=0。Ticket 已可交付；剩餘工作只有真實 PI 原情境人工驗收與使用者決定是否提交。

## 2026-08-29 Deep mixed-tool batch termination barrier 設計里程碑

- 使用者已核准 Forge-only 修補方向；本 session 只完成設計文件，狀態為 `design-approved-ready-for-red`，未實作、未測試、未 commit。
- 核准以 extension-local ephemeral `DeepRetrievalBatch` 按 tool-call ID 建立 transport barrier，mixed completion retryable reject，search 全部 terminate，settle 後只 queue 一個同 identity follow-up；完整決策見 [`ADR-0019`](../docs/adr/ADR-0019-deep-mixed-tool-batch-termination-barrier.md)。
- Plan A 預定先由獨立測試角色新增 6 個 regression 並跑 RED，再由 implementation／驗證／final review 角色分工完成；不改 PI、telemetry、scheduler、session-state、public schema/API 或依賴。Ticket 與新 session 起點見 [`deep-mixed-tool-batch-termination-20260829`](../docs/tickets/deep-mixed-tool-batch-termination-20260829.md) 與 [`docs/handoff.md`](../docs/handoff.md)。

## 2026-08-29 Deep mixed-tool batch termination barrier 收尾

- 目標：在不修改 `pi-main`、不放寬正式 fail-closed gate 的前提下，完成 Deep mixed-tool batch barrier，並移除不需要人類決策的自動 stage panel 訊息副作用。
- 重大實作：Forge extension 以 call ID 維護 mixed batch、search settle 與單一同 identity follow-up；自動 stage panel 移除 `sendMessage`，保留 `setStatus`；`WAIT_USER` 等需要人類決策的面板維持原流程。
- 安全邊界：曾嘗試的 pending-gate 放寬已撤回；以 string content 判斷 replay／route 的假設已由 RED 證偽並撤回；沒有把 workaround 放進正式流程，也未修改 `pi-main`。
- 驗證：AgentSession targeted 1/1（`C:\Users\User\AppData\Local\Temp\forge-agent-session-after-panel-deletion-20260829.log`）、extension isolated 67/67（`C:\Users\User\AppData\Local\Temp\forge-final-extension-isolated-20260829.log`）；自動 stage panel RED/GREEN 分別見 `C:\Users\User\AppData\Local\Temp\forge-auto-deep-panel-red-20260829.log` 與 `C:\Users\User\AppData\Local\Temp\forge-auto-deep-panel-green-20260829.log`。check／回歸仍有既有 TUI terminal／highlight.js caveats（`C:\Users\User\AppData\Local\Temp\forge-final-check-isolated-20260829.log`），因此不宣稱全域 green。可核對實作與測試：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。
- 狀態：本 ticket `completed-with-caveats`；後續另開 TUI terminal／highlight.js ticket。若仍需正式 `displayOnly` contract，另案設計與授權，不在本 ticket 擴大範圍。

## 2026-08-29 WAIT_USER UI-only state publication 設計

- 目標：在不修改 `pi-main`、全域 PI 或 project `.pi` 的前提下，移除 WAIT_USER `publishState()` 對不受支援 `displayOnly` `forge-stage` custom message 的投遞副作用。
- 決策：下一 session 採單一 Plan A，保留 state、`setStatus`、WAIT_USER selector／custom editor、回答 followUp 與 recovery；不新增替代 UI、persistence 或 core delivery contract。
- 狀態：文件已更新，實作與測試均尚未開始；等待使用者更換 session 後確認。全域 PI 0.84.3 固定安裝與設定歸屬評估延後至手動 PI TUI 測試通過後。

## 2026-08-29 WAIT_USER UI-only state publication 實作與驗證

- 目標：在不修改 `pi-main`、不放寬正式 fail-closed gate 的前提下，修正 WAIT_USER `forge-stage` 投遞與 PI interactive harness，保留 state、status、selector、custom editor、followUp、retry 與 recovery。
- 重大實作：`publishState()` 對 `deliverAs: "displayOnly"` 直接停止 `pi.sendMessage`，仍更新 state/status；omission recovery 的純顯示訊息使用 `triggerTurn: false`；PI TUI 測試改用現行 `InteractiveMode` API 的 test-only VirtualTerminal attach/init/render barrier，並修正 retry fixture 使用目前 `grill-1` round。
- 驗證：WAIT_USER strict RED 先觀察實際 call count `4`、預期 `2`，修正後 GREEN；PI interactive 3/3、extension focused 2/2；static check 對本輪 touched files 為 0 errors；`git diff --check` 與 `pi-main` hygiene 通過。證據：`C:\Users\User\AppData\Local\Temp\run_wait_user_red_test_20260829.log`、`C:\Users\User\AppData\Local\Temp\verify_wait_user_extension_contracts_20260829.log`、`C:\Users\User\AppData\Local\Temp\green_first_virtual_terminal_harness_retry_20260829.log`、`C:\Users\User\AppData\Local\Temp\green_second_virtual_terminal_harness_20260829.log`、`C:\Users\User\AppData\Local\Temp\green_third_virtual_terminal_harness_20260829.log`。
- 完整套件與邊界：完整 package／Deep suite 仍受既有 Deep 測試與 TUI terminal／highlight.js baseline caveats 影響，不能宣稱全域 green；真實 PI smoke 僅證明啟動與 extension 載入，未取代原始情境人工驗收。未修改 `pi-main/`。
- 狀態：`implemented-targeted-verified-with-caveats`；本輪 ticket 已完成指定 Forge/UI-only 修正與 targeted 驗證，剩餘 caveats 另見 [`docs/handoff.md`](../docs/handoff.md)、[`docs/PLAN-A.md`](../docs/PLAN-A.md)、[`ADR-0020`](../docs/adr/ADR-0020-wait-user-ui-only-state-publication.md) 與 [`agent-state/wait-user-ui-only-state-publication-20260829.md`](../agent-state/wait-user-ui-only-state-publication-20260829.md)。

## 2026-08-29 Deep Discovery fallback 與 human premise 設計核准

- 使用者核准 ticket `deep-discovery-fallback-human-premise-20260829`：第一次 `needs_discovery` 自動重用 Light Discovery→Grill；第二次起固定問題進 `WAIT_USER`，確認後進 `KNOWLEDGE_UNDERSTANDING`，完成且 validator 通過才進 `CONTEXT_BUILD`。
- Retrieval／Understanding 合併計數；同一 workflow 的 Grill／Deep evidence 依 evidenceId 去重並跨 snapshot 保留。零外部來源以 `human_premise` Evidence 記錄原始 goal、固定問題與明確回答。由已驗證 evidence 直接成立的事實性 finding 可維持事實陳述；implementation inference 必須以「推論：」開頭並引用有效 Evidence ID。只引用 `human_premise` 且沒有 verified evidence 時，validator 強制「推論：」；混合 evidence 仍須標示實際推論，既有引用／ID 檢查不放寬。
- 狀態為 `design-approved-ready-for-red`，尚未修改 production/test。詳細契約見 [`docs/adr/ADR-0021-deep-discovery-fallback-human-premise.md`](../docs/adr/ADR-0021-deep-discovery-fallback-human-premise.md)。

## 2026-08-29 Deep pure-search continuation 修正

- 目標：修正 pure `forge_deep_search` 批次在 search 後沒有 same-identity follow-up 的流程中斷。
- 重大實作：只移除 `forge-runtime/extensions/forge-runtime.ts:1284` 的 `!batch.mixed` 提前返回；保留 terminate、settle barrier、followUpQueued、identity／active checks、mixed reject、completion-only、quota、fail-closed 與 `pi-main` 邊界。
- 驗證：PI TUI 回歸 1/1、完整 PI 互動 11/11、新增 extension 回歸 2/2；extension assertions 68 pass／0 fail 但程序於 summary 後 180 秒未退出。check／第二段 tsc 僅剩既有 21 個 `pi-main` `highlight.js` baseline 型別錯誤；bounded npm test 卡在既有 human-decision integration。兩份獨立 review 無阻擋 finding。
- 狀態：`implemented/verified-with-existing-workspace-caveats`；不宣稱完整 suite 正常退出。

## 2026-08-30 Forge Runtime intent→Context_build 流程圖交付（已更正）

- 目標：細掃 `forge-runtime/` 的 intent→`CONTEXT_BUILD` 完整連線，整理 state transition、等待邊界、PI parallel 與 Forge barrier、identity、Evidence／Context Build 邊界，並以白話文輸出可閱讀的 HTML 流程圖。
- 重大過程：使用者更正交付形式，改為獨立的 `forge-intent-context-flow.html`；流程圖改成自上而下九列、每列一個 state，併發與等待在旁路呈現，交接文字精簡化。原 `forge-runtime-flow.html` 已復原且無 diff。
 - 交付判定：Browser 1280×900 與 390×844 均 PASS；手機支線寬 289-296px，console 0。流程圖以橘色標出已確認的空 Evidence Package 風險，未修改 runtime 來掩蓋缺口。
- 修改範圍：本輪唯一 HTML 交付為 `forge-intent-context-flow.html`；`forge-runtime-flow.html` 已復原、無 diff。未修改 `pi-main/` 或 Forge Runtime production code。缺口與後續狀態見 [`lesson_learn.md`](./lesson_learn.md) 及 [`agent-state/forge-intent-context-flow-20260830.md`](../agent-state/forge-intent-context-flow-20260830.md)。原交付紀錄已由本段更正取代。

## 2026-08-30 Forge intent→Context Build 維護 Skill 建立

- 目標：建立個人 Skill `C:\Users\User\.codex\skills\forge-intent-context-flow\`，讓後續維護自動辨識目標 HTML `forge-intent-context-flow.html`，不誤用舊 `forge-runtime-flow.html`。
- 重大實作：Skill 固定真相優先序、由上到下每列一個 state 的垂直版型、併發／等待／barrier 的旁路表達、fragile junction 標記、桌機／手機驗證與舊檔護欄。
- 驗證：`quick_validate` UTF-8 PASS；獨立 review 無 P0/P1/P2。Skill 位於 repo 外，未修改 Forge Runtime 或 `pi-main/`。

## 2026-08-30 建立通用程式流程圖 HTML Skill

- 目標：建立獨立且適用任何程式碼專案的 `C:\Users\User\.codex\skills\code-flowchart-html`，依實際執行路徑產出或維護垂直 HTML 流程圖，不綁定 Forge、PI 或特定 state 名稱。
- 重大決策：以 `Node／Edge／Wait／Parallel` 關聯模型保存來源與交接；主線每列一個真正狀態，等待、條件、錯誤、回流與併發在旁路呈現；純 HTML／CSS，不加入外部依賴或 agent loop。
- 交付內容：`SKILL.md`、`agents/openai.yaml` 與 `assets/vertical-flow-template.html`；模板包含主線、等待恢復、fork→branches→join/barrier 與手機版旁路連線。
- 驗證：`quick_validate` UTF-8 PASS；模板於 1280×900／390×844 瀏覽器驗證 PASS、console 0；synthetic forward-test 以 10 nodes／12 edges／2 waits／1 parallel PASS。未修改 runtime、`forge-runtime-flow.html` 或 `forge-intent-context-flow.html`。
- 相容邊界：既有 `forge-intent-context-flow` 保留為 Forge 專用維護入口，`agents/openai.yaml` 設定 `policy.allow_implicit_invocation: false`，只有明確指定才使用，避免與通用 Skill 觸發衝突。

## 2026-08-30 Deep Discovery fallback 與 human premise 完成

- 目標：在不修改 `pi-main` 的前提下，讓 Retrieval／Understanding 對 `needs_discovery` 安全 fallback，保留跨 snapshot evidence，並在使用者精確確認後以 `human_premise` 支援後續 Knowledge Understanding。
- 重大實作：Evidence Package 支援並驗證 `human_premise`；第一次正式 `tool_result` transform 自動重跑 Light Discovery→Grill；第二次進精確 `WAIT_USER`，只接受 trim 後完整 `同意`／`確認`。確認後建立新 Knowledge Understanding identity，只允許 `forge_deep_complete`。Grill／Deep evidence 依 ID 去重，於 cancel、switch、new workflow、reset 清除；human premise 記錄 goal、question、answer、`needsDiscoveryCount`、兩輪 `sourceRoundIds` 並由 decision 引用。
- 重大實作：READY_FOR_DEEP 使用 terminate 與 pending settled invocation，在 `agent_settled` 的下一個 task 送普通 user message，再重驗 identity／stage／tools；pending handoff 關閉 Deep tool gate；WAIT_USER publication await；`message_end` callback 帶 ctx；fallback 無 locked evidence 的 `needs_decision` 將兩個 accumulator keys 視為合法 evidence。
- 驗證：Evidence 13/13、Session State 22/22、Extension 142/142、PI interactive 12/12、`npm test` 248/248；Standards／Spec 獨立審查均 PASS。`npm run check` exit 1，但 Forge Runtime 自身零錯誤，唯一失敗為未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21` 缺少 `highlight.js` declaration（TS7016）。
- 狀態：ticket 已完成，目前無待做 production 項目，只剩上游 check baseline；未修改 `pi-main`。

## 2026-08-30 Intent 到 Context 流程圖同步

- 目標：依 current runtime 更新唯一衍生視圖 `forge-intent-context-flow.html`，維持九列 baseline 與既有架構邊界。
- 重大變更：校正 RECEIVE shortcut／`missingAssets`／fail-closed、WAIT_USER `displayOnly`／`transcript`、Deep stale identity 與回流、Evidence `human_premise`／Finding-only `推論：`，並保留 CONTEXT_BUILD partial 與空包風險。
- 驗證與狀態：靜態 parser、純 HTML/CSS、semantic classes、九 state 通過；獨立內容 review P0=0、P1=0。瀏覽器 instance 不可用，視覺 runtime 驗證未完成。未修改 `forge-runtime-flow.html`、runtime、`pi-main`；無新 ADR 決策。
## 2026-08-30：Deep decision replay UI-only stage 完成

- 目標：修正 `forge-stage` custom message 造成 provider context/steering 與重複 blocked，並讓 settled replay 在正確事件邊界繼續流程。
- 重大實作：`publishState` 改為 `ui.setStatus("forge-runtime", text)`；Deep decision 與 Retrieval completion 使用 `pendingSettledDeepInvocation`；第一次 `needs_discovery` 使用獨立 settled marker，settled 後驗證上下文再送正常 user message。保留 exact message-start 清除與 fail-closed tool gate。
- 驗證：fallback 1/1、PI 14/14、Extension 144/144、npm test 252/252；final review 無阻擋 finding。一般 typecheck 通過；整體 check 只受既有 pi-main highlight.js TS7016 阻擋。
- 狀態：已完成。細節與可重用教訓見 [Memory/lesson_learn.md](lesson_learn.md)。

## 2026-08-30 流程圖維護紀錄

- 本輪目標：依目前 `forge-intent-context-flow.html` 更新 Markdown 維護紀錄，固定 WAIT_USER、Deep 併發／重播與 CONTEXT_BUILD 的現況。
- 重大變更：WAIT_USER 的 `publishState` 只更新 `ctx.ui.setStatus()`；mixed batch 已記錄 call-ID 聚合、all-settled barrier 與單次 follow-up；Deep `needs_decision` 已記錄 settled replay 與 stale identity；`CONTEXT_BUILD` 明確標示 production builder 尚未接入。
- 驗證：核對 `forge-intent-context-flow.html:28-32`；本輪只修改 `Memory/record.md`、`Memory/lesson_learn.md` 與 `agent-state/forge-intent-context-flow-20260830.md`，未修改 HTML、`forge-runtime/` 或 `pi-main/`。
- 狀態：Markdown 維護完成；空 Evidence Package 風險與 Context Build production wiring 仍是未解邊界，留待另案處理。

## 2026-08-30 KNOWLEDGE_UNDERSTANDING→CONTEXT_BUILD 交付契約設計確認

- 使用者確認以單一 Forge-owned immutable package 原子交付 `decisions`、`findings`、`limitations`、`knowledgeSummary` 與 runtime 衍生的唯讀 evidence IDs；structured fields 是權威，summary 不得新增事實。完整決策見 [`ADR-0023`](../docs/adr/ADR-0023-knowledge-understanding-context-build-deliverable.md)。
- 狀態：設計已確認、尚未實作；自動啟動／排程 Context Build provider 明確保留為獨立 continuation gap。

## 2026-08-31 knowledgeSummary 非權威邊界設計確認

- 目標：固定 `knowledgeSummary` 僅供閱讀，並確保 Context Builder 正式輸出只依結構欄位與 runtime-derived evidence IDs。
- 決策：摘要矛盾時仍接受 package；`decisions`、`findings`、`limitations` 為權威；不做語意 parser、阻擋重試、runtime 重寫、第二模型／DTO／依賴、`pi-main` 或自動續跑 Context Build。
- 狀態：設計確認、尚未實作；下一步先做 schema description RED。詳見 [`ADR-0024`](../docs/adr/ADR-0024-knowledge-summary-authority-boundary.md)。
## 2026-08-30 KNOWLEDGE_UNDERSTANDING→CONTEXT_BUILD 單一交付物完成

- 目標：讓 KNOWLEDGE_UNDERSTANDING 以單一 immutable EvidencePackage 交付 `decisions`、`findings`、`limitations`、`knowledgeSummary` 與 runtime-derived `evidenceIds` 給 Context Build。
- 重大實作：summary trim／非空／4000 Unicode code points；EvidencePackage 與巢狀 metadata 深層 immutable；session validate/save-before-transition 並在 transition 失敗 rollback；getter 與 reset／cancel／new snapshot cleanup；Context Builder 保留同一 package identity。
- 驗證：session 27/27、evidence 18/18、全套 265/265、`npx tsc --noEmit -p tsconfig.json` exit 0；Standards／Spec review PASS。`npm run check` 僅因未修改 pi-main 的 `highlight.js` declaration（TS7016）失敗。
- 範圍：未接自動續跑或排程 Context Build provider；需另案設計與確認。未修改 `pi-main`，其他既有流程不變。

## 2026-08-31 knowledgeSummary 非權威邊界完成

- 目標：固定 `knowledgeSummary` 僅供人類閱讀，確保 Context Builder 正式輸出只依 `decisions`、`findings`、`limitations` 與 runtime-derived `evidenceIds`。
- 重大實作：補上 schema description 的非權威契約，並維持摘要與結構欄位矛盾時仍接受 package；未新增語意 parser、第二 DTO、依賴、`pi-main` 修改或自動續跑。
- 驗證：`forge-runtime/extensions/forge-runtime.ts:1256`、`forge-runtime/src/evidence/evidence-engine.ts:33`；兩個指定回歸測試（`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/evidence/evidence-engine.test.ts`）；`npm test` 266/266；Standards／Spec review PASS。`npm run check` 仍受既有 `pi-main` `highlight.js` declaration blocker 影響。
- 狀態：本 ticket 已完成實作、驗證與 review；自動／排程 Context Build 仍是另案範圍。

## 2026-08-31 Grill 軟上限與人類 checkpoint 設計核准

- 目標：終止 Grill 自動續問無上限問題，以成功接受的人類 `grill_confirmation` 回答計算 8 輪 soft cap，達上限後交給既有 WAIT_USER checkpoint。
- 重大決策：第 8 題先保存；checkpoint 固定 `continue_one`、`converge`、`cancel`；不新增 workflow state；`NEEDS_CONFIRMATION` 僅限 material decision boundaries。詳見 [`ADR-0025`](../docs/adr/ADR-0025-grill-soft-cap-human-checkpoint.md) 與 [`docs/PLAN-A.md`](../docs/PLAN-A.md)。
- 目前狀態：implementation-complete-verified；runtime、test、skill 與 durable docs 均已同步。

## 2026-09-01 Grill 軟上限與人類 checkpoint 完成

- 目標：終止 Grill 無上限自動續問，並讓 converge 在最多一題真正知識盲點後直接交接 Deep。
- 重大實作：新增 `grill_checkpoint` UI state；session-state 完成有效回答計數、重設與正式 `beginGrill` transition；extension 完成 `pendingConvergenceRoundId`、convergence prompt 與 final-answer guard；grilling skill 更新 frontmatter／material decision 文案。
- 規則：第 8 個有效回答後 checkpoint；`continue_one` 恰一正常 round；無盲點需模型 `READY_FOR_DEEP` 後進 `DEEP_KNOWLEDGE_RETRIEVAL`；有盲點最多一題且答完直接進 Deep；`cancel` 回 RECEIVE／恢復工具。
- 驗證：GrillCheckpoint 4/4；三檔 189/189；grill skill 8/8；`quick_validate` valid；完整 `npm test` 276/276；`git diff --check` exit 0。check 僅剩未修改 pi-main 的 highlight.js TS7016 baseline。
- 狀態：complete；final review／交付所需驗證已完成。

## 2026-09-01 Grill checkpoint 最終收尾

- 目標：終止 Grill 無上限續問，讓 converge 在 0 題或最多 1 題真正知識盲點後直接交接 Deep。
- 重大實作：兩個 convergence 入口跳過 relevance；普通 empty-candidate 保留 `WAIT_USER`；bare cancel 重用完整 cleanup；session 加入 blank/stale/duplicate 防護；canonical skill 改為 `forge-runtime/skills/grilling/SKILL.md`。
- 驗證：完整 281/281、精準 convergence/cancel/relevance 5/5、session 33/33、cancel 8/8、`quick_validate` 成功、pack dry-run 260 files、isolated tarball install/path resolution 成功、diff check 0。check 僅剩未修改 `pi-main` baseline。
- 狀態：complete。package 約 213 個 `.log` 與 semantic true-gap classifier 是已知後續風險，未納入本輪。

## 2026-09-02 Deep Discovery fallback 選項與 full reset 完成

- 目標：將 `deep_discovery_fallback` 可見選項修正為「確認／取消」，並讓取消清除本輪所有輸入與證據後回到初始 `RECEIVE`。
- 重大實作：`session-state.ts` 固定 fallback options；shared resume ingress 在 selector／typed input 精確「取消」時執行 fallback-specific cleanup、`sessionState.reset()` 與 active workflow 清除。舊「同意」只保留隱藏相容輸入；一般 `deep_decision` cancel 不變。
- 修改檔案：production 為 `forge-runtime/src/runtime/session-state.ts`、`forge-runtime/extensions/forge-runtime.ts`；tests 為 `forge-runtime/tests/runtime/session-state.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。
- 驗證：session-state 33/33、extension 153/153、真實 TUI 14/14、完整 `npm test` 282/282；review 無阻擋 finding，`git diff -- pi-main` 無輸出。完整 log：`.tmp-deep-fallback-full-test-rerun.log`。
- 目前狀態：實作與主要驗證完成；isolated verification 亦已完成：以 HEAD `fdccbd62403e40ba3400761bc0468668820a8059` 建 detached worktree，僅套用本 ticket 五個 code/test 檔 patch，未 install、未改 `pi-main`，`npm test` exit 0，282/282、0 fail/skip；worktree、junction 與 patch 已安全清理。`npm run check` 與第二段獨立 tsc 均 exit 2，僅因未修改 `pi-main` 的 `syntax-highlight.ts` 缺 `highlight.js` TS7016；若處理 blocker，需另獲使用者授權修改 `pi-main`。

## 2026-09-02 Spec Gap 探索性開發完成

- 目標：缺 formal spec 時允許完整 non-blocking Spec Gap 繼續 exploratory 開發，並以驗證層級與主張邊界避免誤稱正式相容。
- 重大實作：完成 `exploratory`／`black_box_verified`／`spec_verified`；black-box 要求 version、environment、非空字串 scenarios、verifiedAt；存在的 scenarios 必須為字串陣列，新增欄位 clone/freeze，壞資料回 validation error 不 throw；formalSpecReference 四欄位安全驗證為非空字串。
- 安全決策：移除公開 `TrustedFormalSpecContext` 與第二個 validator 參數。Current runtime 無可信 formal-spec importer／不可偽造 capability／來源綁定，因此 `spec_verified` 固定 fail-closed；exploratory／black-box 不受影響。
- 驗證：evidence 28/28；`forge-runtime npm test` 292/292，0 fail／skip／cancelled／todo，約 30.15 秒；`npm run check` 無本 ticket 診斷但保留上游 `pi-main` 21 個 TS7016；CodeGraph review 無阻擋 finding；`git diff --check` 無 whitespace error。
- 目前狀態：本 ticket／Plan A 已完成；可信 importer、來源綁定與 generic execution guard 為獨立後續工作。

## 2026-09-02 Intent 到 Context 流程圖同步

- 目標：依 current runtime 更新唯一衍生視圖的維護紀錄，保持九列 baseline 與安全邊界。
- 重大變更：文件確認 checkpoint／converge、五種 WAIT_USER、status-only delivery、fallback 確認／取消、identity／barrier／batch；Spec Gap 僅宣稱底層 Evidence engine 完成，extension wiring 與 Context builder production caller 仍未完成。
- 證據與驗證：`forge-intent-context-flow.html:24-32,35,37`；review P0/P1/P2=0；parser、無 JS／外部依賴、9 rows、手機 CSS、Edge 兩尺寸與 console 0 PASS。舊流程圖 SHA-256 前後均為指定值，本輪未修改。
- 狀態：文件同步完成；trusted importer／來源綁定與 Context builder production wiring 留待另案。

## 2026-09-03 CONTEXT_BUILD production continuation 完成

- 目標：將既有 Evidence Package 與 Grill 的人類確認接上 `CONTEXT_BUILD → ADR_BUILD → TO_SPEC` production 流程，並把候選設計決策原子提交至使用者專案的 `Documents/`。
- 重大實作：`human_premise` 與 `post-package humanDecisions` 均保留 round／decision provenance；新增 Context／ADR completion tools、相應 skill invocation、material ambiguity 的 `WAIT_USER` resume、stale identity guard，以及成功後 `TO_SPEC` transition。
- 重大實作：新增 `context-build` package skill；Context、ADR、handoff 僅攜帶結構化事實與證據 metadata，不複製 raw evidence／`knowledgeSummary`，並在 handoff renderer 進行 PII／敏感資料遮罩。
- 重大實作：新增 managed-block `Documents/CONTEXT.md`、`Documents/ADR.md`、`Documents/handoff.md` writer；提交前以 base hash 偵測衝突，同目錄暫存、備份與跨檔 rollback 保證 atomic bundle，並保留使用者非 managed 內容。
- 驗證：完整測試 322/322；base typecheck 通過；skill validator 通過；`git diff --check` 通過。PI interactive typecheck 仍因未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 缺少 `highlight.js` declarations（TS7016）未通過，維持既有上游 baseline，不修改 `pi-main/`。
- 狀態：本 ticket 實作與文件交付完成；後續僅保留上游型別 baseline 與真實 PI session 的人工驗收風險。

## 2026-09-03 CONTEXT_BUILD 最終根目錄邊界同步

- 使用者專案的交付根目錄固定取自非空 `ctx.cwd`，輸出位置為 `<ctx.cwd>/Documents/CONTEXT.md`、`<ctx.cwd>/Documents/ADR.md` 與 `<ctx.cwd>/Documents/handoff.md`；不得以 `process.cwd()` 補值，避免未來使用 PI 開發其他專案時寫錯根目錄。
- 最終驗證：完整測試 323/323；`Extension_WhenProjectCwdIsMissing_ShouldFailClosedWithoutStartingWorkflow` 證實缺少專案根目錄時不啟動 workflow；extension tests 162/162。此段為目前狀態，不改寫前述歷史測試數字。

## 2026-09-03 CONTEXT_BUILD 文字回答續跑同步

- 一般文字輸入現在也能回應 Context／ADR ambiguity；回答會消耗目前 pending invocation，建立新的 attempt，並立即轉換成 fresh invocation，避免沿用舊 identity。
- 最終驗證更新為完整測試 324/324、extension tests 163/163；保留 `ctx.cwd` 必須明確存在的 fail-closed 邊界與既有上游 `pi-main` 型別 baseline。

## 2026-09-03 取消後續實作與正規文件邊界同步

- 目標：依使用者最新決定停止目前後續開發，只同步狀態／知識庫文件。
- 重大決策：本 ticket 的正式交付邊界停在 `ADR_BUILD`／ADR；`TO_SPEC` 尚未開始，等待使用者明確確認。`Documents/` 是生成產物，本輪不更新；依 `AGENTS.md`，repo 正規文件以根目錄 `CONTEXT.md`、`ADR.md`、`PLAN-A.md`、`handoff.md` 與 `docs/` 為準。相關決策證據見 `ADR-0028` 與 `AGENTS.md:29-34`。
- 實際狀態：程式碼已完成 CONTEXT_BUILD、ADR_BUILD 與 Documents writer；成功 ADR 後目前 runtime 會切至 `TO_SPEC` state，但沒有 TO_SPEC tool／handler，因此沒有 TO_SPEC executor，不能宣稱已執行 TO_SPEC。runtime 邊界證據為 `forge-runtime/src/runtime/session-state.ts` 與 `forge-runtime/extensions/forge-runtime.ts`。
- 本輪僅更新 ticket、agent-state、record、lesson；未修改 `Documents/`、程式碼或測試，未重新執行驗證。
- 狀態：WAIT_USER。

## 2026-09-03 Intent 到 Context 流程圖 current-runtime 對齊

- 目標：更新唯一衍生流程圖的 Markdown 維護紀錄，反映 11 個 workflow state、7 種 WAIT_USER、Context／ADR production 與 ADR 後人工確認邊界。
- 重大變更：記錄 Documents bundle 與 `human_premise` provenance 已接線；`TO_SPEC` 僅 state node、未有 executor；Evidence 空包與 `buildContextItems` production caller gap 保持未解。
- 證據與驗證：`forge-intent-context-flow.html:25-35,38-40`；內容 review P0/P1/P2=0；parser、無 JS／外部依賴、11 rows、Edge 1280×900／390×844、console 0 PASS；舊流程圖 before/after SHA-256 均為 `153841F436081711694834EF464F9DB82C5D8B41D4028426F480A04EDC19EBE8`，原先已有工作樹修改，本輪未碰。未宣稱 runtime 測試已執行。
- 狀態：文件同步完成，`adr-boundary-awaiting-user-confirmation`；下一步等待使用者明確確認 TO_SPEC。

## 2026-09-03 零候選探索性路由設計核准

- 目標：Light Discovery `matches=[]` 時不呼叫不存在 candidate 的 evidence tool，經明確人類確認後沿用既有 `human_premise` 進 exploratory，並建立 non-blocking `Spec Gap`。
- 重大決策：拒絕、空白或模糊回答維持 `WAIT_USER`；有候選流程不變；不放寬 Evidence validator、不新增頂層 state／command／service。`human_premise` 只證明意圖，不得升為 `spec_verified`；TO_SPEC 另案保留 ADR-0028 人工確認。
- Plan A scope：production 僅 `forge-runtime/extensions/forge-runtime.ts`，測試僅 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`；狀態為 `design-confirmed-not-implemented`。
- 驗證計畫：baseline 277 passed，實作後預期 279 passed／0 failed；先由子代理打 RED，再跑實際 `tsx` 限定批次與 `npm test`。目前未修改 production／test，未執行測試。

## 2026-09-04 零候選探索性路由實作完成

- 目標：在不影響既有有候選流程的前提下，讓零候選經明確 opt-in 後進入 exploratory Deep，並保留可追溯的 non-blocking Spec Gap。
- 重大實作：空快照只有明確「同意」才沿用 `human_premise` 直接進 Deep；拒絕／模糊回答留在 `WAIT_USER`。Deep metadata wiring、空快照 metadata 預設與不完整組合的 extension boundary fail-closed 已完成；未修改 `pi-main`、Evidence validator、state machine 或 TO_SPEC。
- 測試清單：新增五個 extension tests：`Extension_WhenDeepCompleteProvidesOnlyFormalSpecReference_ShouldRejectBeforeContextBuild`、`Extension_WhenDeepCompleteProvidesExploratorySpecGap_ShouldPropagateToEvidencePackage`、`Extension_WhenEmptySnapshotConsentAndDeepCompleteOmitMetadata_ShouldAddExploratorySpecGap`、`Extension_WhenEmptyDiscoveryHasHumanConfirmation_ShouldEnterDeepWithoutSecondGrillRound`、`Extension_WhenEmptyDiscoveryAnswerIsNotExplicitApproval_ShouldRemainWaiting`；`DeepCompletion_WhenOnlyGrillHumanPremiseExists_ShouldEnterContextBuild` 為修改既有測試；三個 TUI 測試恢復既有契約。
- 驗證：final5/check4 為歷史紀錄，已由下方 final7/check6 取代。
- 狀態：本 ticket 完成；TO_SPEC executor 與上游型別 blocker 留待另案，未 commit／push。

## 2026-09-04 零候選探索性路由最終同步（歷史證據，已由 2026-09-05 取代）

- 目標：在不影響已完成有候選流程的前提下，完成空 manifest opt-in、探索性 Deep 與可追溯 Spec Gap，並同步唯一衍生流程圖。
- 重大實作：明確同意才由空快照以既有 `human_premise` 直進 Deep；拒絕／模糊留在 `WAIT_USER`；metadata wiring、自動 exploratory Spec Gap 與 extension boundary fail-closed 完成。`forge-intent-context-flow.html` 只同步行為視圖，不是 runtime 行為來源；`forge-runtime-flow.html` 未修改。
- 驗證：`.tmp/full-test-final8-0904.log` 為 329 passed、0 failed、0 skipped、34635.325 ms，僅既有 DEP0190 warning；`.tmp/check-final7-0904.log` 為 exit 2，21 個 TS7016 全在未修改上游 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21`，本輪三個 Forge 檔 0 error。HTML release validation 為 `.tmp/intent-flow-release-validation-20260904.log`，CDP、靜態與視覺 PASS，兩尺寸 overflow 0；舊 final6/check5/final7/check6 為歷史紀錄，已由 final8/check7 取代。
- 狀態：`implemented-verified-completed`；TO_SPEC 無 executor、upstream TS7016、未 commit／push。歷史 targeted 282 是未執行預估，已由正式 329 全量測試取代。

## 2026-09-05 零候選路由封版同步

- 重大決策：`FORGE_RUNTIME_Arch_v4.md` 明文化窄例外；只有空 `matches`、runtime 固定探索 opt-in marker 與既有 `isApproval` 明確肯定同時成立時，回答才作為 `human_premise` 由 `WAIT_USER` 直進既有 Deep。一般 `NEEDS_CONFIRMATION` 與有候選流程仍須下一輪 Grill，拒絕／模糊仍等待。
- 驗證：`.tmp/full-test-final10-0905.log` 為 329 passed、0 failed、0 skipped、duration_ms 30778.2386；`.tmp/check-final9-0905.log` 為 exit 2，21 個 TS7016 僅在未修改上游 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21`，Forge 三檔 0 error。
- 狀態：`implemented-verified-completed`；TO_SPEC 無 executor，未 commit／push。
