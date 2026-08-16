# Forge Runtime v4 開發記憶錄

## 1. 文件目的與涵蓋範圍

本文件把本專案現有 Markdown 中能確認的開發過程，依照時間與依賴順序整理成可交接的記錄。讀者假設是接手 Forge Runtime v4 的資深工程師，需要知道每次決策為何發生、哪個契約被改變、哪個錯誤曾經阻擋進度，以及哪些驗證結果是真實結果而不是預估值。

本記錄涵蓋架構基線、ADR-0001 至 ADR-0009、Plan A 的歷史與現行執行、Plan B 的最小 UI slice、四份 durable state，以及 handoff 所指定的目前狀態。紀錄截止於 2026-08-16。沒有文件證據的細節不在此補造；若某一階段的精確命令、完整 diff 或時間未被文件記錄，以下會明確標示。

本 repo 沒有 root-level Git baseline，因而不能把固定起點 diff 當作證據。這個限制在 `docs/handoff.md:47-55`、`agent-state/typebox-loader-compatibility.md:37-43` 與 Plan A 的 final review 記錄中都有說明。

## 2. 依賴順序與開發時間線

### 2.1 v4 架構基線

來源：`FORGE_RUNTIME_Arch_v4.md:49-175,338-504,1132-1289,1557-1666`。

目標是把 Forge 定義成 Workflow Sovereignty、evidence-driven、knowledge-first 的工程 runtime。Workflow 擁有 state transition 的最終控制權，LLM 只負責理解、推理、候選與寫碼；`WAIT_USER` 是真正的人類決策邊界，Recommendation 不等於 Decision。Grill 必須使用 structured output，且只能在候選 evidence 足夠時進入 Deep Knowledge。

初始架構也固定了 PI 的位置：PI 是承載 runtime，Forge 以 package、extension、skill 落地，不 fork PI core。v4 的第一階段應先做 workflow kernel、state machine、mandatory stages、evidence traceability 與 validation loop，UI 後置。這直接形成後續 ADR-0001、Plan A 及 Plan B 的邊界。

錯誤與教訓：這一階段的文件沒有記載可重現的程式錯誤。可確認的教訓是，若先把 UI 或 prompt 當成控制層，會違反 Workflow Sovereignty；因此所有後續 UI 只能讀取 state，不能自行推動 transition。

### 2.2 ADR-0001：Foundation，2026-08-07

來源：`docs/adr/ADR-0001-forge-runtime-v4-foundation.md:1-54`。

決策是把 Forge Runtime 建在獨立的 `forge-runtime/` package，先交付 workflow kernel，不先做完整 UI 或完整知識平台。第一階段固定 state machine、mandatory skill dispatch、Light Discovery、Deep Retrieval、`WAIT_USER`、evidence 到 Context/ADR 的 traceability，以及 implement gate 到 repair 的路徑。

實作方向是 PI package、extension、skill，而不是修改 `pi-main/`。UI 明確延後到 Plan B，subagent 只保留 Implementation、Test、Validation、Review、Judge/Repair 的最小角色隔離。

錯誤與教訓：文件沒有記載該階段的測試錯誤。教訓是先讓最小 integration slice 證明 extension 能表達 `WAIT_USER` 與 mandatory stage，若不能，必須停下來重新確認薄適配層，不能默默侵入 PI core。

### 2.3 ADR-0002：Front Door Router，2026-08-08

來源：`docs/adr/ADR-0002-forge-front-door-router.md:1-58`。

這一階段把一般自然工程請求的預設入口定為 Forge Router，保留 slash command bypass。每個 session 只允許一個 open workflow，不做 queue 或 parallel workflow。`WAIT_USER` 優先於新 intent 判定；`open_workflow` 遇到新題目不雙開，而是標記 `new-topic-conflict`。`INTENT_UNDERSTANDING` 只輸出五個欄位，工程請求不得被 passthrough 吞掉。

Light Discovery v1 只做薄探索，文件知識來源限定根目錄 `wiki/`，必要時才做窄 local code lookup 與 `code_base/` 候選摘要。歧義一律進 Grill，router 不替使用者做設計決策。

錯誤與教訓：文件沒有記載此 ADR 的單一失敗命令。明確的設計教訓是，前段 router 不能只做 input transform；原始使用者輸入仍要保留在 transcript，內部 orchestration prompt 不得外漏。這項澄清後來影響真實 TUI 驗收。

### 2.4 ADR-0003 與 ADR-0004：workflow control 與 knowledge boundaries，2026-08-09

來源：`docs/adr/ADR-0003-active-workflow-control.md:1-56`、`docs/adr/ADR-0004-knowledge-source-boundaries.md:1-76`。

ADR-0003 把 active workflow 從被動硬擋改成 command-first 控制：一般 workflow 有 `continue`、`cancel`、`switch <request>`；後來明確補上 completion omission 應改由 `retry` 處理。`cancel` 回到 `RECEIVE`，`switch` 固定是 cancel 加上正式 ingress 的新 request，不引入 queue。

ADR-0004 把來源分為 `wiki/` 文件知識、`code_base/` 代碼知識與當前專案原始碼。`Target Gap` 可以繼續，真正的 `Target Conflict` 才必須停下來詢問。metadata 是 optional acceleration layer，不是運作前置條件。Deep Knowledge 前必須通過 candidate relevance gate；候選不足時要把問題帶回 `WAIT_USER`。

錯誤與教訓：這些文件沒有列出早期實作的逐筆錯誤。最重要的後續教訓是不能把 `code_base` 當成 target truth，也不能因為有少量候選就跳過 relevance gate；空 manifest 若仍強制 evidence，會產生永遠無法完成的 Grill，這在 ADR-0008 被正式修正。

### 2.5 2026-08-10：Plan B UI 最小 slice

來源：`docs/PLAN-B.md:1-131`。

Plan B 原始目標是 workflow status、`WAIT_USER` panel、evidence/decision 摘要，以及 validation/repair 狀態的可視化。Not Building 包含重做 PI 全域 TUI、完整 Web、複雜動畫、dashboard 與跨專案 observability。

已完成的最小 slice 是 extension 透過 `ctx.ui.setStatus()` 發佈 status line，透過 custom message 顯示 `WAIT_USER` panel，並新增 `ui-state.ts`、status、wait-user、evidence summary、validation repair 等文字 builder。後續也補上 payload 化 `grill ambiguous`、structured `grill-result`、schema、`grill-run`、selector interaction 與 reject 路徑。

這一階段的完成界線很重要：文件明確記錄目前只有 status/custom-panel + selector，還沒有固定 widget tree，也沒有常駐 evidence、validation、repair widget。這不是 Plan A 的失敗，而是刻意保留的 Plan B 未完成界線。錯誤方面，文件未記載逐筆錯誤；可學到的教訓是先利用既有 UI surface，避免為了視覺層重做 PI TUI。

### 2.6 ADR-0005：Grill terminal result lifecycle

來源：`docs/adr/ADR-0005-grill-terminal-result-lifecycle.md:1-23`。

PI 對每個 assistant response，包括 tool-call iteration，都會發出 `message_end`。因此只有不含 `toolCall` 的終局 assistant message 才能視為可解析的終局 Grill result；含工具呼叫的訊息必須保留 `pendingGrillRun`。這個做法保留 Workflow 對 `WAIT_USER` 與 Deep transition 的控制權，且不需修改 `pi-main/`。

曾考慮在第一個 `message_end` 解析或等到 `agent_end` 聚合，最後選擇只解析無 toolCall 的終局訊息，因為改動最小。後來文件補充，completion omission recovery 已由 ADR-0008 取代，streaming `message_end` 不得觸發 steer 或 follow-up replay。

教訓：不能把 terminal event 和 completion success 混為一談。tool iteration 不是終局，缺少 completion tool 也不能被當成正常 completion。

### 2.7 ADR-0006：唯讀候選查核、snapshot 與多輪決策

來源：`docs/adr/ADR-0006-grill-readonly-candidate-verification.md:1-76`。

Grill 只能查核 Light Discovery 明確產出的候選，工具 deny-by-default。使用者確認後仍留在同一決策迴圈，只有正式 scope change 才重跑 Discovery。snapshot contract 隨後固定：candidate id 是由 canonical metadata 與內容計算的 `ev-<完整 SHA-256>`，snapshot 建立時 deep-freeze，只收錄實際選出的 wiki、code_base 與 target source；未知 candidate 固定拒絕，不讀檔、不改 state。

2026-08-13 的 safety completion 再補上 capability gate、離開 Grill 時恢復 active tools、首輪 evidence invariant、relevance failure 的可見來源/scope 問題，以及非 domain tool 阻擋。

錯誤與教訓：文件未記載每個早期 RED 命令，但後續 Plan A #12 與 #13 顯示兩個實際邊界問題。首輪 evidence guard 不能套用到空 manifest；relevance gate 失敗不能只留錯誤字串，必須產生可回答 decision 並進 `WAIT_USER`。

### 2.8 ADR-0007：completion tool 與 TypeBox loader compatibility

來源：`docs/adr/ADR-0007-grill-completion-tool.md:1-71`、`agent-state/typebox-loader-compatibility.md:1-43`。

正常 Grill completion 改由專用 `forge_grill_complete` tool 提交，與 `forge_grill_evidence` 分離。payload 使用 runtime-issued `roundId`、`status`、`questions`、`recommendation`、`evidence`、`requiresUserConfirmation`；只有 `NEEDS_CONFIRMATION` 與 `READY_FOR_DEEP` 兩種結果。前者恰好一題，後者零題，assistant prose 與終局文字 JSON 不再是正常控制路徑。

早期 safety slices 已驗證 domain tool allowlist、非 domain deny gate、immutable snapshot、candidate provenance、cancel/switch tool restore、completion 後 prose suppression、answer/resume 與 review-derived safety。這些記錄在 `docs/PLAN-A.md:288-370` 與 `agent-state/grill-resume-replay.md:1-43`。

接著發生 TypeBox loader 錯誤。實際 PI 啟動時，loader 對 `typebox/schema` 找不到 `typebox/build/index.mjs/schema`。CodeGraph 確認 PI loader 公開 alias 只有 `typebox`、`typebox/compile`、`typebox/value`。原本直接載入 PI source CLI 的兩個 assertions 卻在舊程式碼即 2/2 通過，形成無效的假紅燈入口，因此不能拿 direct `tsx` import 證明 loader compatibility。

修正方式是只在 Forge package 將 `Schema.Compile` 改為 `typebox/compile` 的 `Compile`，不修改 `pi-main` loader 或 TypeBox dependency。改用 global compiled `pi` 明確載入 `.pi/extensions/forge-runtime.ts` 建立有效 regression seam。修正後 loader focused 2/2、完整 `npm test` 99/99、type check 與 compiled PI probe 均通過。這段的關鍵教訓是測試必須通過真正失敗的 distribution path；source CLI、virtual module 與 global compiled loader 不等價。

### 2.9 ADR-0008：completion recovery 與真實互動驗收，2026-08-13

來源：`docs/adr/ADR-0008-grill-completion-recovery-and-interactive-acceptance.md:1-80`。

ADR-0008 正式 supersede ADR-0007 的 completion omission `continue` replay。每個 Grill round 的執行都是有界 attempt；首次 omission 記錄一次並進 `GRILL + RECOVERY_REQUIRED`，同 attempt 後續終局事件 no-op。recovery panel 只提供 `/forge-runtime retry`、`cancel`、`switch`，session 必須 settled，不得 background steer、auto replay 或 auto Deep。`continue` 保留一般 active workflow 語義，但不再是 omission recovery。

使用者確認的 deep module seam 是 `recordCompletionOmission(): boolean` 與 `retryGrillRound(): GrillRound | undefined`。attemptId 與 omission marker 不進公開 `GrillRound` contract；retry 保留 round、request、immutable snapshot 並重置 omission budget。正常 `NEEDS_CONFIRMATION` 自動進 `WAIT_USER`，回答後自動下一 round；`READY_FOR_DEEP` 通過 gate 後自動 Deep。空 manifest 可用零 evidence 提出唯一 scope 問題，relevance failure 也必須可見且可回答。

### 2.10 ADR-0009：WAIT_USER 固定自行輸入入口，2026-08-15 至 2026-08-16

來源：`docs/adr/ADR-0009-wait-user-fixed-custom-input.md:1-41`、`agent-state/wait-user-fixed-custom-input-20260815.md:162-211`。

ADR-0009 固定由 runtime 在每個 TUI selector 最後提供「自行輸入…」，不依模型文案猜測。選取後沿 PI 既有 `ctx.ui.custom` 四參數 factory 與 `Editor` 接受文字。非空答案 trim 後寫入同一 `decisionId` 並沿既有 resume path；空白 Enter 不送出，Escape 返回 selector。options 必須是可直接記錄的完整答案。

production path 已完成四參數 factory、host `Theme` 到 `EditorTheme` adapter、trim、blank Enter 與 Escape focused coverage；Forge package 使用已核准的 `@earendil-works/pi-tui@0.83.0`。current full suite 與真實 PI TUI acceptance 仍未完成，固定 widget tree 也未完成；OOM 根因未知，ticket 不得標記完成。

## 3. 現行 Plan A，嚴格依 #1 至 #17

本節的編號就是後續工程師搜尋的定位索引。每一步都記錄目標、決策、修改、錯誤、修正、驗證與教訓。Plan A 的正式測試表在 `docs/PLAN-A.md:114-124`，最終狀態與證據在 `docs/PLAN-A.md:126-155`。

### #1：首次 completion omission state

目標是為每個 attempt 記錄首次 omission。RED 原因是 `recordCompletionOmission` 不存在，精準測試 0 pass、1 fail。修正是在 `session-state.ts` 加入 private per-attempt flag 與 `recordCompletionOmission(): boolean`；start/reset 清 flag，continue 不清除，首次回傳 true，重複回傳 false 且 no-op。精準驗證 1 pass、exit 0。教訓是 omission budget 應藏在 session state，不能讓測試依賴私有 attemptId。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:14-15,76-78`。

### #2：同 attempt omission idempotence

目標是證明同 attempt 的第二個 omission 不新增 recovery。既有 #1 的 idempotent implementation 已滿足需求，沒有新增 production code；精準測試 1 pass、exit 0。教訓是先用同一個狀態 seam 驗證重複事件，不要另加第二個 marker。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:16,79`。

### #3：explicit retry 保留 round 與 snapshot

RED 原因是 `retryGrillRound` 不存在，0 pass、1 fail。修正是在 `ForgeSessionState` 加入只在 recovery 可用的 `retryGrillRound()`，保留 roundId、request、immutable snapshot，清除 recovery marker 並重置 omission budget。精準測試 1 pass、exit 0。教訓是 retry 是新 attempt，不是新 round，也不是新 snapshot。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:17-18,80-82`。

### #4：extension omission recovery wiring

目標是讓 extension 以既有 session seam settle omission、恢復工具並顯示 retry/cancel/switch。初始 RED 的 panel 仍顯示舊 `continue`，缺少 `/retry`。實作後完成 retry wiring、工具恢復與 recovery marker；`continue` 在 recovery 中拒絕且不產生 follow-up。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:13,19-20,70-75,83-84`。

中途曾因測試錯誤期待 transform 失敗而失敗。Hunt 查明 exact replay 的正確歷史語義是 `continue`，一行修正測試後 1 pass、exit 0。後來 ADR-0007 的 stale test `Extension_WhenTerminalMessageOmitsCompletion_ShouldPromptContinueAndSwitch` 被刪除，因為它與 ADR-0008 的 retry/cancel/switch 契約衝突。教訓是先判定測試是在驗當前 contract，還是在保留已 supersede 的歷史行為。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:21-22,85-86`。

### #5：公開 omission/retry 狀態契約整合

此步把 extension wiring 與 session-level omission seam 接合，確認 production 不在 extension 另造 omission 狀態。文件只記載 #1 至 #7 精準測試均通過，沒有另外列出一個新的獨立失敗命令。教訓是同一個狀態只應有一個 owner，extension 透過 session API 使用它。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:20,62,83,123`。

### #6：recovery 後工具與 active workflow 保留

此步沿用既有 active workflow 控制與 tool restore safety，確保 cancel/switch/retry 的邊界不會留下錯誤工具。文件記錄 #1 至 #7 均 GREEN，未記載新的錯誤。教訓是 recovery 只增加 Grill 內部 marker，不要擴張 top-level state machine。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:26,31,93,123`、`agent-state/grill-resume-replay.md:12-15`。

### #7：completion needs confirmation 的新命名與 WAIT_USER

目標是確認有效 completion 立即顯示唯一問題並進 `WAIT_USER`。原有等價測試改名為 `Extension_WhenCompletionNeedsConfirmation_ShouldDisplayQuestionAndEnterWaitUser`，並刪除與新 recovery 契約衝突的 ADR-0007 stale test。#1 至 #7 精準單測均通過。教訓是文件、測試名稱與 runtime contract 必須同時更新，否則 stale contract 會把正確修正誤判成回歸。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:106-123`。

### #8：回答後自動開始下一 Grill round

目標是使用者回答問題後不需要 `continue` 就進入下一 round。測試位於 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts:331-381`，以 `sendInput("confirm")` 驗證 grill-1 到 grill-2。production 不需修改，精準測試 1 pass、exit 0。教訓是既有 resume path 已足夠時不要新增另一條 replay API。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:154-157`。

### #9：READY_FOR_DEEP 自動進 Deep

目標是有效 READY completion 通過 gate 後自動進 Deep，沒有 `continue`。測試位於 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts:1049`，驗證 `KNOWLEDGE_UNDERSTANDING` 與 active tools restore。既有 production 行為已符合，精準測試 GREEN。教訓是以 stage 與 tool restore 的可觀察結果驗證，不把 command absence 當成唯一證據。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:163-166`。

### #10：visible panel content contract

RED 顯示 panel `content` 只有 `WAIT_USER` 且 `display` 不是 true。修正 `forge-runtime/extensions/forge-runtime.ts:267-270,676-679,793-795` 的三個 panel 出口，統一使用完整 `panelText` 與 `display: true`；測試在 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts:760` 捕獲 raw payload。GREEN 為 1 pass。教訓是 UI contract 要測 raw payload，不只測轉換後的文字。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:172-175`。

### #11：completion-tool-only prompt

RED 原因是舊 prompt 仍含「請只輸出一個最阻塞的確認問題」。修正 `forge-runtime/src/grill/grill-skill.ts:27`，只允許 `forge_grill_evidence` 與 `forge_grill_complete`，禁止 assistant prose 與終局 JSON；`NEEDS_CONFIRMATION` 維持一題，READY 維持零題。測試 `tests/grill/grill-skill.test.ts:28-37` GREEN。教訓是 prompt 只能引導，runtime validator 與 tool gate 才是強制層；測試也不能把「禁止 prose」句子誤當成允許 prose。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:181-184`。

### #12：空 manifest 的 completion guard

RED 為 1 pass、1 fail，因為原本首輪 evidence guard 無條件拒絕空 manifest。修正 `grill-result.ts:34,141`，加入 `snapshotManifest` context；只有空 manifest、首輪、`NEEDS_CONFIRMATION`、無 evidence 時例外放行。非空 manifest、READY、未提供 manifest 仍拒絕。caller `forge-runtime.ts:202` 傳入 round snapshot manifest，測試 `grill-result.test.ts:229,267` 驗證 2/2。教訓是 invariant 必須精確限定適用集合，不能把安全條件寫成不可完成的總規則。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:190-193`。

### #13：relevance gate failure 的 WAIT_USER 出口

RED 的第一次命令參數順序錯誤，實際跑成整個測試檔，不能視為 focused evidence。修正為正確 `--test-name-pattern` 命令後，測試仍先證明 gate failure 停在錯誤路徑。production `forge-runtime/extensions/forge-runtime.ts:675` 改為沿用 roundId 與 fetched evidence，建立帶 reason 的來源/scope question、options 與 recommendation，發布 state 並進 `WAIT_USER`。精準 GREEN 為 1/1。教訓是驗證命令本身也是測試前提，必須確認 pattern、順序與實際執行數。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:199-203`。

### #14：真實 PI TUI 的最小 test-only seam

這是唯一跨越原本 PI boundary 的決策點。使用者選擇方案 A，核准在 `pi-main/packages/coding-agent/src/modes/interactive-mode.ts:313-331,489-493` 增加 optional `terminal?: Terminal`，由 constructor 轉給既有 `createInteractiveTui`；省略時仍建立 `ProcessTerminal`。不注入 TUI factory、不加依賴、不改 workflow 語意。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:206-217`。

先前真正的 upstream seam 測試為 RED 4/4，`npm run check` 出現 terminal option 型別錯誤；修正後 Vitest 4/4，terminal option 錯誤消失，但 upstream check 仍有既存 `packages/ai/test/*` 型別錯誤。真實 TUI 初次遇到 loader distribution 與 input/intent fixture 問題，修正 fixture 後 1/1 GREEN。教訓是 fake extension harness 不能取代真 TUI，test seam 必須小到只提供可控 Terminal。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:228-237`。

### #15：真實 TUI READY 自動前進

初始 RED 的 viewport 沒有 KNOWLEDGE，probe 顯示 manifest 非空但 `evidence=[]`，因首輪 invariant 進入 recovery。修正不是放寬 production guard，而是 test-only 使用 `runLightDiscovery(['test'])` 取得真實 candidate，Faux 回應順序改為 evidence、READY completion、settle。測試 `pi-grill-interactive.test.ts:123` GREEN 1/1。教訓是 fixture 必須滿足 production invariant，不能為了讓測試通過而削弱 invariant。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:244-264`。

### #16：completion omission recovery settled

真實 PI TUI 測試 `pi-grill-interactive.test.ts:229` 只回傳一段無 tool prose，驗證一次 `GRILL_COMPLETION_REQUIRED`、retry/cancel/switch、panel 只出現一次、user 只出現一次、queue 耗盡，settled 後 assistant 不再增加。測試 1/1、約 7.5 秒自行 exit。沒有 production 修改。教訓是 omission 的驗收核心是停止背景活動，不是自動補送一輪。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:274-294,322`。

### #17：單次輸入的 assistant turn 邊界

測試 `pi-grill-interactive.test.ts:317` 驗證單次 input 在 omission terminal boundary 後，短暫 quiescence 期間 faux callCount 與 assistant count 不再增加，`pending=0`、`user=1`。首次命令曾 pass 後 timeout；獨立重跑後 #16、#17 都約 7.5 秒自行 exit 0，#17 為 1/1。教訓是要驗證穩定 terminal boundary，而不是硬編固定 assistant turn 數。直接證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:304-322`。

## 4. Plan A 完整驗證、final review 與最後修正

來源：`docs/PLAN-A.md:126-155`、`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:332-355` 的 Plan A 完成 milestone。

既有 94/94 suite 曾通過；後續完整 suite 的 loader smoke 在並行負載下觸發 30 秒 timeout，改為 `--test-concurrency=1` 後最終 114/114。真實 TUI 檔 4/4。文件沒有提供足夠精度說明失敗的 loader 測試數量，因此本記錄不再細分為兩個測試，也不把 timeout 描述成 loader logic failure。直接證據：`docs/PLAN-A.md:370`、`docs/PLAN-A.md:126-132`、`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:340,352-355`。

採最小修正，把 `forge-runtime/package.json` test runner 改為 `--test-concurrency=1`，不放寬 loader timeout。最終 `npm test` 114/114 exit 0，`npm run check` exit 0，P1 focused 修正 1/1，真實 TUI 4/4。Plan A final review 找到一個 Standards P1 與兩個 Spec 缺口：非 active Grill attempt 的工具未 fail-closed、正常 TUI 尚有 `continue` 語義、omission 後可能自動 retry。修正後所有 finding 關閉。直接證據：`docs/PLAN-A.md:126-132`、`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:336-340,352-355`。

最後 upstream seam Vitest 4/4；upstream `npm run check` 仍只剩既有 `packages/ai` 測試型別錯誤，與 terminal seam 無關。這是已知未解風險，不可寫成整個 upstream check 通過。直接證據：`docs/PLAN-A.md:132`、`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:230-237,355`。

## 5. 重要錯誤索引與已 supersede 契約

1. 假綠燈：PI source CLI direct import 的 loader assertions 在舊程式碼即通過。修正為 global compiled `pi` bootstrap probe，見 `agent-state/typebox-loader-compatibility.md:14-29`。
2. stale contract/test：舊測試期待 omission 顯示 `continue` 並可 replay；ADR-0008 改成 retry/cancel/switch，stale test 已刪除，見 `docs/adr/ADR-0007-grill-completion-tool.md:1-9`、`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:21-22,85-86`。
3. focused test 參數順序錯誤：#13 初次命令執行整檔，不能當作 focused RED/Green；改正 pattern 後才採用 1/1，見 `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:199-203`。
4. type errors：Plan #14 的 upstream terminal option 型別錯誤在 seam 加入後出現；修正後 terminal 相關錯誤消失，留下既存 `packages/ai/test/*` 錯誤。不能把剩餘錯誤歸因於 Forge seam，見 `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:228-237`。
5. loader distribution：source CLI、global compiled CLI 與 virtual module 分支不相同；真正 regression 必須走使用者實際的 compiled loader path，見 `agent-state/typebox-loader-compatibility.md:14-29,33,37-43`。
6. fixture evidence invariant：#15 的非空 manifest 加空 evidence 觸發首輪 guard；正確修法是補真實 candidate/evidence fixture，不是放寬 guard，見 `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:248-264`。
7. pass 後 hang：`InteractiveMode.run()` 是 production 永久 loop，測試 assertions 通過後仍可能不退出；runner 需使用 `--test-force-exit`，這不是 runtime abort seam，見 `docs/PLAN-A.md:63-67`。
8. full-suite 30 秒 timeout：完整 suite 的 loader smoke 在並行負載下觸發 30 秒 timeout；採 `--test-concurrency=1`，保留 timeout 安全界線，見 `docs/PLAN-A.md:131`、`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:340`。
9. 非 active attempt 未 fail-closed：final review 發現兩個 Grill tool 的 gate 不完整；補上 `pendingGrillRun && stage===GRILL` 共同 gate 與 execute guard，P1 1/1 通過，見 `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:336-338,352`。
10. panel payload 不可見：#10 raw payload 顯示 `content` 與 `display` 不符合契約；三個出口統一使用完整 `panelText` 與 `display: true`，見 `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:172-175`。
11. prompt 與 validator drift：#11 舊 prompt 要 assistant 輸出問題；改成 completion-tool-only，並以 runtime validator 強制 question cardinality，見 `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:181-184`。
12. 空 manifest 不可完成：#12 將 evidence invariant 精確限定於非空 manifest 首輪；空 manifest 改走唯一 scope question，見 `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md:190-193`。

歷史契約的明確 supersede 關係如下：ADR-0007/ADR-0003 的 omission `continue` replay 被 ADR-0008 取代；一般 active workflow 的 `continue` 仍保留，但 recovery 下必須拒絕。正常 completion 的 assistant terminal JSON 被 `forge_grill_complete` 取代；`/forge-runtime grill-result` 只留 debug injection。Plan B 的固定 widget tree 仍未完成，不能用 Plan A 的 TUI acceptance 宣稱 UI tree 已完成。直接證據：`docs/adr/ADR-0008-grill-completion-recovery-and-interactive-acceptance.md:1-14`、`docs/adr/ADR-0007-grill-completion-tool.md:1-9,21-29`、`docs/PLAN-B.md:116-127`。

## 6. 目前狀態與未完成項目

截至 2026-08-16，Plan A #1 至 #17 已完成；其完整 suite、Plan A final review、真實 PI TUI 與 upstream seam 證據仍屬已完成的歷史 milestone。直接證據：`docs/PLAN-A.md:120-138`、`docs/PLAN-A.md:434-447`。

Plan B 只有 status/custom-panel/selector 的最小 slice。固定 widget tree、常駐 workflow stage、evidence 摘要、validation/repair 摘要，以及 selector 與固定 widget 共存尚未完成，見 `docs/PLAN-B.md:116-127`。Plan B 的文件仍有設計衝突：原始方向要求 UI layer，然而 handoff 的 Not Building 要求不實作固定 widget tree；這是人類決策邊界，不能自行把 Plan B 寫成完成。直接證據：`docs/PLAN-B.md:5-32,105-127`、`docs/handoff.md:40-45`。

ADR-0009 的「自行輸入…」production path、四參數 custom factory、Theme adapter、trim、blank Enter 與 Escape focused coverage 已完成；focused regression tests 3/3，`npm run check` exit 0。current `npm test` 為 44/47，約 123 秒後因 heap OOM 終止，另有兩個 loader timeout。真實 PI TUI acceptance、固定 widget tree 與 `selectList` 實際 autocomplete render coverage 仍未完成，OOM 根因未知。直接證據：`CONTEXT.md:147-154`、`docs/adr/ADR-0009-wait-user-fixed-custom-input.md:35-41`、`docs/handoff.md:9-52`。

目前不應新增 top-level recovery stage、第三種 completion status、自動 retry、background steer、queue、parallel workflow，也不應擴大 Deep Knowledge、candidate scoring 或知識來源。`pi-main/` 只保留核准的 Plan A #14 test-only Terminal seam。直接證據：`docs/PLAN-A.md:27-35`、`docs/adr/ADR-0008-grill-completion-recovery-and-interactive-acceptance.md:66-80`、`CONTEXT.md:49-59`。

## 7. Lesson learned

- 先依 host 的真實 callback contract 驗證 `ctx.ui.custom` 四參數，再建立 `Theme → EditorTheme` adapter；不可只依名稱或本地手寫型別假設介面形狀。來源：`docs/adr/ADR-0009-wait-user-fixed-custom-input.md:15-20,35-40`。
- 測試必須實際執行 factory 與 render path；只讓 fake 回傳最後答案，只能驗證 wiring，不能證明 TUI 可用。來源：`docs/PLAN-A.md:92-96`。
- 取消輸入與 transport failure 不共用 `continue`：Escape 只返回 selector；follow-up bridge 不存在時維持 `WAIT_USER` 並結束 command。來源：`agent-state/wait-user-fixed-custom-input-20260815.md:17-22`、`CONTEXT.md:108-110`。
- focused test、full suite、真實 runtime／TUI acceptance 是三層不同證據；歷史 slice 通過不能代替 current full 或 runtime 驗收。來源：`CONTEXT.md:149-154`、`docs/handoff.md:26-48`。
- OOM 根因未被證明前，只記錄觀察到的失敗與已排除項目，不把假設寫成結論。來源：`docs/handoff.md:33-39`。

## 8. 來源文件索引與排除項

本記錄使用的 19 份本專案 Markdown 來源如下：

1. `FORGE_RUNTIME_Arch_v4.md`：v4 架構與最高邊界。
2. `CONTEXT.md`：當前 contract、Plan A 狀態與已知風險。
3. `docs/PLAN-A.md`：現行 Plan A、歷史 Plan A、#1 至 #17、驗證與 review。
4. `docs/PLAN-B.md`：UI 最小 slice、未完成界線與互動 acceptance。
5. `docs/handoff.md`：session handoff、目前狀態、下一步與風險。
6. `docs/adr/ADR-0001-forge-runtime-v4-foundation.md`：foundation。
7. `docs/adr/ADR-0002-forge-front-door-router.md`：front door router。
8. `docs/adr/ADR-0003-active-workflow-control.md`：active workflow control。
9. `docs/adr/ADR-0004-knowledge-source-boundaries.md`：knowledge boundaries。
10. `docs/adr/ADR-0005-grill-terminal-result-lifecycle.md`：terminal lifecycle。
11. `docs/adr/ADR-0006-grill-readonly-candidate-verification.md`：candidate verification 與 snapshot。
12. `docs/adr/ADR-0007-grill-completion-tool.md`：completion tool 與 loader follow-up。
13. `docs/adr/ADR-0008-grill-completion-recovery-and-interactive-acceptance.md`：recovery 與 TUI acceptance。
14. `docs/adr/ADR-0009-wait-user-fixed-custom-input.md`：WAIT_USER 固定自行輸入入口。
15. `agent-state/wait-user-fixed-custom-input-20260815.md`：本 ticket 的 durable state、驗證與阻塞。
16. `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md`：Plan A #1 至 #17 的 durable milestone、錯誤與最終證據。
17. `agent-state/grill-resume-replay.md`：被 ADR-0008 部分取代的歷史 resume/replay ticket。
18. `agent-state/typebox-loader-compatibility.md`：loader 錯誤、有效 regression seam 與修正。
19. `AGENTS.md`：repo 工作規則、角色隔離、驗證委派與文件交付規則，不是功能決策來源，但列入以說明本記錄的交接與證據格式邊界。

排除項：`pi-main/**` 上游文件只用於已記錄的 API 或 loader 事實，未納入本記錄來源索引；`node_modules`、`.codegraph`、`wiki`、`code_base` 與所有 `.log` 均排除。它們不是本次開發決策的 Markdown 紀錄。程式碼與測試檔只在本文作為 `file:line` 證據引用，沒有把它們當成第 20 份以上的文件來源。

本文件的文字只記錄上述來源能確認的內容。未在來源中出現的精確 commit、完整 diff、個別代理名稱、Plan B 後續決策與某些早期測試命令，均未猜測補寫。
