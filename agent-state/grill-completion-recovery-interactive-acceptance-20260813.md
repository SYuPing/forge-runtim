# Grill Completion Recovery 與互動驗收狀態

日期：2026-08-13

## 已完成項目

- 使用者已核准 completion omission recovery、正常自動轉移、輸出契約、prompt、discovery guard 與真實 PI TUI 驗收七項需求。
- 已建立 Accepted ADR-0008，並明確 supersede ADR-0007 的 omission `continue` replay 部分。
- 已將最高規範、術語、相關 ADR、Plan A、Plan B 互動驗收與 handoff 同步為同一 contract。
- 新 Plan A 已核准；Plan #1–#13 已完成 GREEN，`/forge-runtime retry` wiring 已完成；使用者於 2026-08-14 選擇 A 並授權 Plan #14 test-only seam，#14 準備 RED。
- 已完成第一個 TDD RED milestone：新增 completion omission recovery 紅燈測試，精準驗證 retry／cancel switch 與 settle 行為。
- 原測試已強化為實際透過 `runCommand("forge-runtime", "continue")`，並斷言 `sendUserMessage` followUp 不增加、re-entry 為零。
- 已完成第一個 TDD GREEN milestone：production 僅修改 `forge-runtime/extensions/forge-runtime.ts`；completion omission 會 settle pending、恢復工具並保留 GRILL round，`validationRepair` 標記為 `RECOVERY_REQUIRED`／`GRILL`，panel 提供 retry／cancel／switch；舊 `continue` 會被 recovery 狀態拒絕且不產生 followUp。
- 已完成第二個 TDD RED milestone：在 `forge-runtime/tests/runtime/session-state.test.ts:97` 新增 `SessionState_WhenCompletionOmissionFirstOccurs_ShouldEnterRecoveryOnce`，驗證首次 omission 進入 recovery 且只記錄一次。
- 已完成第二個 TDD GREEN milestone：production `session-state.ts` 新增 `recordCompletionOmission(): boolean` 與 private per-attempt omission flag；start/reset 會清除 flag，continue 不會清除，首次 omission 進 recovery 並回傳 `true`，同 attempt 重複 omission 回傳 `false` 且 no-op。
- 已完成同 attempt 重複 omission 的 GREEN 驗證：`SessionState_WhenSameAttemptOmissionRepeats_ShouldRemainSingleRecovery`；既有 idempotent implementation 已滿足，production 無新變更。
- 已完成 retry 行為的 TDD RED milestone：新增 `SessionState_WhenExplicitRetryRequested_ShouldRetainRoundAndSnapshotAndStartNewAttempt`，驗證明確 retry 保留 round／snapshot 並開始新 attempt。
- 已完成 retry session 的 GREEN milestone：`retryGrillRound()` 僅在 recovery 狀態可用，保留 round／immutable snapshot、清除 recovery marker 並重置 omission budget；extension `/retry` wiring 尚未實作。
- 已完成第四個 TDD RED milestone：extension retry wiring 測試已調整為公開 retry wiring；`continue` assertions 留待第六個 milestone。
- extension omission 已改用既有 session record seam（`recordCompletionOmission()`），並完成 retry wiring；不再於 extension 另造 omission 狀態。
- 已完成 #4 首次 GREEN 前的驗證修正：原先因錯誤期待 transform 失敗而未通過；hunt 證實 exact replay 的正確行為是 `continue`，測試一行修正後精準 1 pass／0 fail。
- 已刪除 ADR-0007 stale test `Extension_WhenTerminalMessageOmitsCompletion_ShouldPromptContinueAndSwitch`；其 `continue`／preserve tools 契約與 ADR-0008 矛盾，且已由 #4 取代。

## 重要決策

- `RECOVERY_REQUIRED` 是 `GRILL` substate／marker，不是新的 top-level workflow stage。
- 每個 attempt 首次 completion omission 最多進 recovery 一次；相同 attempt 重複 terminal event no-op。
- 使用者於 2026-08-13 確認：`ForgeSessionState` 以私有 attempt 狀態維護 omission budget；公開 `recordCompletionOmission(): boolean` 首次記錄並進 recovery 回傳 `true`，重複事件回傳 `false` 且 no-op。
- 使用者於 2026-08-13 確認：`retryGrillRound(): GrillRound | undefined` 只在 recovery 使用，保留 roundId、request、immutable snapshot 並重置 omission budget；`GrillRound` 不公開 attemptId 或 omission marker，retry 後新 attempt 的首次 omission 可再次回傳 `true`。
- 此小 interface 是刻意的 deep module 邊界，避免測試耦合私有 attempt 狀態；`retryGrillRound()` 已完成 production 實作。
- omission 後不 steer、不自動 replay、不自動 Deep；只有明確 `/forge-runtime retry` 可用同 round／snapshot 建立新 attempt。
- `continue` 不再承擔 omission recovery。
- `NEEDS_CONFIRMATION` 立即進 `WAIT_USER`，回答後自動下一 Grill round；`READY_FOR_DEEP` 立即自動 Deep。
- 可見 panel 固定使用 `content: panelText`、`display: true`。
- 空 manifest 可零 evidence 提出唯一來源／scope 問題；relevance gate 失敗必須顯示可回答問題並進 `WAIT_USER`。
- 真實 PI TUI acceptance 是完成 gate；fake harness 不足以單獨宣告完成。

## 修改檔案

- `FORGE_RUNTIME_Arch_v4.md`
- `CONTEXT.md`
- `docs/PLAN-A.md`
- `docs/PLAN-B.md`
- `docs/adr/ADR-0003-active-workflow-control.md`
- `docs/adr/ADR-0004-knowledge-source-boundaries.md`
- `docs/adr/ADR-0005-grill-terminal-result-lifecycle.md`
- `docs/adr/ADR-0006-grill-readonly-candidate-verification.md`
- `docs/adr/ADR-0007-grill-completion-tool.md`
- `docs/adr/ADR-0008-grill-completion-recovery-and-interactive-acceptance.md`
- `docs/handoff.md`
- `agent-state/grill-resume-replay.md`
- `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md`
- `CONTEXT.md`（本次同步 interface 決策；實際檔案位於 repo root）
- `docs/adr/ADR-0008-grill-completion-recovery-and-interactive-acceptance.md`（本次同步 interface 決策）
- `docs/PLAN-A.md`（本次同步 interface 決策）
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts:648`（新增並強化紅燈測試）
- `forge-runtime/extensions/forge-runtime.ts`（第一個 GREEN production slice；omission settle、recovery 工具／狀態與 panel 行為）
- `forge-runtime/tests/runtime/session-state.test.ts:97`（第二個 RED slice；新增首次 completion omission state 測試）
- `forge-runtime/src/runtime/session-state.ts`（第二個 GREEN slice；新增 `recordCompletionOmission(): boolean` 與 private per-attempt flag）
- `forge-runtime/src/runtime/session-state.ts`（retry session GREEN；新增 `retryGrillRound()`，保留 round／snapshot、清 marker 並重置 omission budget）
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts:657`（第四個 RED slice；公開 retry wiring 的 followUp 斷言）
- `forge-runtime/extensions/forge-runtime.ts`（extension 重用 session omission record seam，完成 retry wiring）
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`（#4 GREEN 前修正 exact replay／`continue` 期待）
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`（刪除 ADR-0007 stale omission test）

## 測試結果

- 本輪只修改文件，未執行任何測試、type check、build 或 PI TUI 驗收。
- 既有 baseline 為先前獨立驗證的 99/99；新 Plan A 的 17 條測試與 116/116 目標尚未執行，不得視為實測結果。
- TDD RED：`node --import tsx --test --test-name-pattern='Extension_WhenCompletionOmissionOccurs_ShouldShowRetryCancelSwitchAndSettle' tests/extensions/forge-runtime-extension.test.ts`（workdir `forge-runtime`）exit 1；輸出缺少 `/forge-runtime retry`，且仍顯示舊 `/forge-runtime continue`。
- 精準重跑仍 exit 1；第一個 assertion 在 test line 648，panel 缺 `/forge-runtime retry` 且仍顯示 `continue/switch`。
- 由於 runner 停於第一 assertion，`continue` replay 斷言尚未抵達。
- 第一個 GREEN 精準驗證：`\.\\node_modules\\.bin\\tsx.cmd --test --test-name-pattern='^Extension_WhenCompletionOmissionOccurs_ShouldShowRetryCancelSwitchAndSettle$' 'tests/extensions/forge-runtime-extension.test.ts'`（workdir `forge-runtime`）exit 0；1 pass／0 fail。
- 本 milestone 完成 omission settle、恢復工具／狀態、保留 GRILL round、panel retry／cancel／switch，以及拒絕舊 `continue` 且不 followUp；retry wiring 隨後已完成。
- 精準命令（GREEN）：`\.\node_modules\.bin\tsx.cmd --test --test-name-pattern='^Extension_WhenCompletionOmissionOccurs_ShouldShowRetryCancelSwitchAndSettle$' 'tests/extensions/forge-runtime-extension.test.ts'`；exit 0，1 pass／0 fail。
- 第二個 TDD RED 精準命令：`node --import tsx --test --test-name-pattern='^SessionState_WhenCompletionOmissionFirstOccurs_ShouldEnterRecoveryOnce$' tests/runtime/session-state.test.ts`；0 pass／1 fail／0 skip。
- 第二個 RED 根因：`recordCompletionOmission` 不存在。
- 第二個 GREEN 精準驗證：`node --import tsx --test --test-name-pattern='^SessionState_WhenCompletionOmissionFirstOccurs_ShouldEnterRecoveryOnce$' tests/runtime/session-state.test.ts`；exit 0，1 pass／0 fail／0 skip。
- 同 attempt 重複 omission GREEN 精準驗證：`node --import tsx --test --test-name-pattern='^SessionState_WhenSameAttemptOmissionRepeats_ShouldRemainSingleRecovery$' tests/runtime/session-state.test.ts`；exit 0，1 pass／0 fail／0 skip。
- retry RED 精準驗證：`node --import tsx --test --test-name-pattern='^SessionState_WhenExplicitRetryRequested_ShouldRetainRoundAndSnapshotAndStartNewAttempt$' tests/runtime/session-state.test.ts`；執行 1，exit 1，0 pass／1 fail／0 skip。
- retry RED 根因：`retryGrillRound` 不存在（test line 161）。
- retry GREEN 精準驗證：`node --import tsx --test --test-name-pattern='^SessionState_WhenExplicitRetryRequested_ShouldRetainRoundAndSnapshotAndStartNewAttempt$' tests/runtime/session-state.test.ts`；executed 1，exit 0，1 pass／0 fail／0 skip。
- extension `/retry` wiring 已完成；#1–#7 精準單測均已通過。
- 第四個 TDD RED 精準驗證：extension retry wiring 測試（line 657）；executed 1，exit 1，0 pass／1 fail／0 skip；retry followUp actual 0、expected 1。
- #4 首次 GREEN 前曾因錯誤期待 transform 失敗而失敗；hunt 證實 exact replay 正確應為 `continue`，測試一行修正後精準驗證 exit 0，1 pass／0 fail。
- 刪除 ADR-0007 stale test 後，原先預估的 116 條測試為預估值；淨 count 會因刪除該測試而變動，不得把 116 視為固定實測總數。

## 未解問題

- 真實 PI TUI 需要可控的 completion／omission 回應 seam；若 provider 不穩定，仍須保持真 PI TUI／extension lifecycle，不得用 fake harness 取代。
- workspace root 沒有 Git baseline，無法做 root-level diff-based review。
- 第一個 production slice 與 `/forge-runtime retry` wiring 已修改並完成 GREEN；下一個 TDD RED 聚焦 #8 使用者回答後自動開新 round。
- `ForgeSessionState.retryGrillRound()` 與公開 retry wiring 均已完成；同 attempt 重複 omission no-op 亦已完成精準 GREEN。
- ADR-0007 stale test 已移除；#4 已取代其與 ADR-0008 衝突的 `continue`／preserve tools 期待。

## 下一步

1. 新 session 先讀 `docs/handoff.md`、`CONTEXT.md`、ADR-0008 與 `docs/PLAN-A.md`。
2. 向使用者展示 context 摘要並等待確認。
3. 下一 session 從 #8 `Extension_WhenUserAnswersQuestion_ShouldAutomaticallyStartNextGrillRound` 開始；不可跳過 #8 進入 #9。

## Milestone：Plan #7 GREEN 停點（2026-08-13）

### 已完成項目

- Plan #1–#7 已完成；#7 等價測試已改名為 `Extension_WhenCompletionNeedsConfirmation_ShouldDisplayQuestionAndEnterWaitUser`。
- ADR-0007 stale `Extension_WhenTerminalMessageOmitsCompletion_ShouldPromptContinueAndSwitch` 已刪除。

### 重要決策

- 使用者要求本 session 做完 #7 後停止；#8 留待下一 session，#9–#17 pending。
- `116` 僅為預估，不是硬 gate；刪除 stale test 後淨測試數不固定。

### 修改檔案

- `forge-runtime/src/runtime/session-state.ts`：private per-attempt omission budget、`recordCompletionOmission()`、`retryGrillRound()`。
- `forge-runtime/extensions/forge-runtime.ts`：omission session seam、settle／restore tools、recovery continue 拒絕、明確 retry 一次 followUp。
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`：#7 測試改名；刪除 stale test。
- 本次 durable docs：`CONTEXT.md`、`docs/adr/ADR-0008-grill-completion-recovery-and-interactive-acceptance.md`、`docs/PLAN-A.md`、`docs/handoff.md`、本檔。

### 測試結果

- #1、#2、#3、#4、#5、#6、#7 精準單測各 1 pass、exit 0。
- 尚未執行 focused batch、完整 suite、typecheck、真 PI TUI 或 review；不得宣稱整體 acceptance 完成。

### 未解問題

- 真 PI TUI 仍缺可控 completion／omission seam；workspace 無 Git baseline。

### 下一步

- 新 session 先讀 docs/handoff、CONTEXT、ADR-0008、PLAN-A 與本 state；用 `execute-designed-plan`／TDD 恢復。
- 先 CodeGraph 唯讀探索，再由測試角色對 #8 打 RED、執行角色確認，production role 做最小 GREEN；#8 完成前不得開始 #9。
## Milestone #5

- 已完成項目：新增 test。
- 重要決策：production 無變更。
- 修改檔案：本 milestone 新增 test；本次代理僅更新此 durable state 檔。
- 測試結果：executed 1、exit 0、1 pass / 0 fail / 0 skip。
- 未解問題：無。
- 下一步：#6 continue no replay。

## Milestone #6

- 已完成項目：第一組 #1-#6 完成。
- 重要決策：production 無變更。
- 修改檔案：本次代理僅更新此 durable state 檔。
- 測試結果：executed 1、exit 0、1 pass / 0 fail / 0 skip。
- 未解問題：無。
- 下一步：#7 needs-confirmation RED。

## Milestone #8

- 已完成項目：新增 `Extension_WhenUserAnswersQuestion_ShouldAutomaticallyStartNextGrillRound`，覆蓋使用者透過 `sendInput("confirm")` 回答問題後，自動由 grill-1 進入 grill-2。
- 重要決策：公開流程維持同一 request、同一 candidate，產生 decision summary，且不產生 `continue`；production 既有行為已直接符合需求，無需修改。
- 修改檔案：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts:331-381`；本次代理僅更新此 durable state 檔。
- 測試結果：`npx tsx --test --test-name-pattern='^Extension_WhenUserAnswersQuestion_ShouldAutomaticallyStartNextGrillRound$' tests/extensions/forge-runtime-extension.test.ts`（workdir `forge-runtime`）exit 0，1 pass／0 fail。
- 未解問題：focused batch、完整 suite、typecheck、真 PI TUI 與 final review 尚未完成。
- 下一步：Plan A #9。

## Milestone #9

- 已完成項目：新增 `Extension_WhenCompletionReadyForDeep_ShouldAutomaticallyEnterDeepKnowledge`，覆蓋 completion accepted、`READY_FOR_DEEP`、`proceed_deep` gate、最終 `KNOWLEDGE_UNDERSTANDING`、active tools 恢復，且無 `continue`。
- 重要決策：production 既有行為已直接符合需求，無需修改。
- 修改檔案：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts:1049`；本次代理僅更新此 durable state 檔。
- 測試結果：`npx tsx --test --test-name-pattern='Extension_WhenCompletionReadyForDeep_ShouldAutomaticallyEnterDeepKnowledge' tests/extensions/forge-runtime-extension.test.ts`（workdir `forge-runtime`）exit 0，GREEN。
- 未解問題：focused batch、完整 suite、typecheck、真 PI TUI 與 final review 尚未完成。
- 下一步：Plan A #10。

## Milestone #10

- 已完成項目：完成 `Extension_WhenPanelIsEmitted_ShouldUseVisibleContentContract`，三個 panel 出口皆使用完整 `panelText`／`content` 與 `display: true`，並由測試直接捕獲 raw payload。
- 重要決策：可見 panel 的輸出契約固定為完整內容與 `display: true`；production 修正三個 panel 出口。
- 修改檔案：`forge-runtime/extensions/forge-runtime.ts:267-270,676-679,793-795`；`forge-runtime/tests/extensions/forge-runtime-extension.test.ts:331,760`；本次代理僅更新此 durable state 檔。
- 測試結果：RED 命令 `npx tsx --test --test-name-pattern='^Extension_WhenPanelIsEmitted_ShouldUseVisibleContentContract$' tests/extensions/forge-runtime-extension.test.ts` exit 1，原因 content 是 `WAIT_USER` 且 display 非 true。GREEN 同命令 exit 0，1 pass／0 fail。
- 未解問題：focused batch、完整 suite、typecheck、真 PI TUI、final review 尚未完成。
- 下一步：Plan A #11。

## Milestone #11

- 已完成項目：新增 `GrillSkill_WhenInvocationBuilt_ShouldRequireCompletionToolWithoutAssistantProse`，驗證 grill invocation 只允許 completion evidence／completion 工具，禁止 assistant prose 與終局 JSON；保留 `NEEDS_CONFIRMATION` 一題及 `READY_FOR_DEEP` 零題。
- 重要決策：production `forge-runtime/src/grill/grill-skill.ts:27` 僅允許 `forge_grill_evidence`／`forge_grill_complete`，禁止 prose／終局 JSON；`NEEDS_CONFIRMATION` 維持一題，`READY_FOR_DEEP` 維持零題。
- 修改檔案：`forge-runtime/src/grill/grill-skill.ts:27`、`forge-runtime/tests/grill/grill-skill.test.ts:28-37`；本次代理僅更新此 durable state 檔。
- 測試結果：RED 命令 `npx tsx --test --test-name-pattern='GrillSkill_WhenInvocationBuilt_ShouldRequireCompletionToolWithoutAssistantProse' tests/grill/grill-skill.test.ts` exit 1，舊 prompt 含「請只輸出一個最阻塞的確認問題」；GREEN 同命令 exit 0，1 pass／0 fail。
- 未解問題：focused batch、完整 suite、typecheck、真實 PI TUI、final review 尚未完成。
- 下一步：Plan A #12。

## Milestone #12

- 已完成項目：完成空 manifest 首輪 snapshot round 的精確 completion 例外；空 manifest 且無 evidence 可進入 `NEEDS_CONFIRMATION`，非空 manifest 首輪無 evidence 仍拒絕。
- 重要決策：`snapshotManifest` 作為 grill completion context；僅在空 manifest、首輪、`NEEDS_CONFIRMATION` 且無 evidence 時允許，`READY_FOR_DEEP`、未提供 manifest 與非空 manifest 仍拒絕。
- 修改檔案：`forge-runtime/src/grill/grill-result.ts:34,141` 新增 `snapshotManifest` context 與精確例外；`forge-runtime/extensions/forge-runtime.ts:202` 唯一 caller 傳入 `round.snapshot.manifest`；`forge-runtime/tests/grill/grill-result.test.ts:229,267` 新增／驗證測試；本次代理僅更新此 durable state 檔。
- 測試結果：RED `npx tsx --test --test-name-pattern='^GrillCompletion_When(EmptyManifestFirstSnapshotRoundNeedsConfirmationWithNoEvidence|NonEmptyManifestFirstSnapshotRoundHasNoEvidence)_Should(Parse|Reject)$' tests/grill/grill-result.test.ts` exit 1（1 pass／1 fail；空 manifest 仍被無條件 guard 拒絕）；GREEN 同命令 exit 0（2 pass／0 fail）。
- 未解問題：focused batch、完整 suite、typecheck、真實 PI TUI、final review 尚未完成。
- 下一步：Plan A #13。

## Milestone #13

- 已完成項目：完成 relevance gate fail 的互動驗收；顯示含 relevance reason 的 scope question，進入 `WAIT_USER`，並提供可信來源與縮小需求範圍選項。
- 重要決策：沿用既有 `roundId`／`getFetchedEvidenceIds()`；relevance gate fail 不改算法、stage 或 Deep 流程，recommend 固定為縮小需求範圍，並發布 state。
- 修改檔案：`forge-runtime/extensions/forge-runtime.ts:675`；`forge-runtime/tests/extensions/forge-runtime-extension.test.ts:122`；本次代理僅更新此 durable state 檔。
- 測試結果：RED 正確 focused 目標為 `Extension_WhenRelevanceGateFails_ShouldDisplayScopeQuestionAndEnterWaitUser`；GREEN 精準命令 `npx tsx --test --test-name-pattern='^Extension_WhenRelevanceGateFails_ShouldDisplayScopeQuestionAndEnterWaitUser$' tests/extensions/forge-runtime-extension.test.ts`，exit 0，1/1。
- 未解問題：focused batch、完整 suite、typecheck、真實 PI TUI、final review 尚未完成。最初參數順序錯誤曾執行整檔，非有效 focused 結果，已由正確命令取代。
- 下一步：Plan A #14。

## Milestone #14：真實 PI TUI seam GREEN（2026-08-14）

### 已完成項目

- 使用者選擇 A；已完成 upstream seam RED／GREEN，並完成真實 PI TUI acceptance：question visible、可回答、進入 grill-2 且不 continue。
- production upstream seam 位於 `pi-main/packages/coding-agent/src/modes/interactive-mode.ts:313-331,489-493`：optional terminal 轉送至既有 TUI；省略時 fallback `ProcessTerminal` 不變。
- 真實 acceptance 測試位於 `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`，設定檔為 `forge-runtime/tsconfig.pi-interactive.json`。

### 重要決策

- 使用者選擇 A，授權最小 test-only terminal injection seam；B 不納入本計畫。
- seam 僅注入 optional terminal，不注入 TUI factory、不新增依賴、不改 runtime workflow 語意；fallback `ProcessTerminal` 維持原行為。

### 修改檔案

- `pi-main/packages/coding-agent/src/modes/interactive-mode.ts:313-331,489-493`
- `pi-main/packages/coding-agent/src/modes/interactive-tui.test.ts:6,28-36`
- `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`
- `forge-runtime/tsconfig.pi-interactive.json`
- `agent-state/plan14-green-vitest.log`
- `agent-state/plan14-green-check.log`

### 測試結果

- upstream seam RED：Vitest 4/4；`npm run check` exit 1，但僅剩 terminal option 相關 TypeScript errors。
- upstream GREEN：Vitest 4/4；terminal option errors 消失，但 `npm run check` 仍 exit 2，原因是既存 `packages/ai/test/*` type errors。
- 真實 TUI 初始 RED 為 loader dist，後續修正 input／intent fixture；最終 `npx tsx --tsconfig tsconfig.pi-interactive.json --test tests/extensions/pi-grill-interactive.test.ts` exit 0，1/1。
- 詳細輸出已保存於 `agent-state/plan14-green-vitest.log` 與 `agent-state/plan14-green-check.log`。

### 未解問題

- upstream 完整 check 仍受既存 `packages/ai/test/*` type errors 阻擋；非本 seam 變更。
- #15–#17、focused/full/typecheck/review 仍 pending。

### 下一步

- 下一步：Plan A #15。

## Milestone #15：READY_FOR_DEEP completion 自動前進（2026-08-14）

### 已完成項目

- 完成 `PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue`，驗證 READY_FOR_DEEP completion 後可自動前進，且單一 user prompt 不產生 `continue`。
- 初始 RED 的 viewport 沒有 KNOWLEDGE；probe 顯示 manifest 非空但 `evidence=[]`，被首輪 invariant 拒絕並進入 `RECOVERY_REQUIRED`。
- 以 test-only root fix 使用 `runLightDiscovery(['test'])` 取得真實 candidate；Faux 回應順序為 evidence → READY_FOR_DEEP completion → settle。

### 重要決策

- 本 milestone 僅採 test-only root fix；無 production 修改。
- READY_FOR_DEEP completion 維持自動前進語意，不加入 `continue` replay 或額外 user prompt。

### 修改檔案

- `forge-runtime/tests/extensions/pi-grill-interactive.test.ts:123`（test-only root fix 與 acceptance test）；本次代理僅更新此 durable state 檔。

### 測試結果

- 精準命令：`npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-name-pattern='^PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue$' tests/extensions/pi-grill-interactive.test.ts`。
- GREEN：exit 0，1/1 pass；Faux 順序為 evidence → READY_FOR_DEEP completion → settle，單一 user prompt 且無 `continue`。

### 未解問題

- Plan A #16–#17 尚未完成；focused/full、typecheck、review 與 upstream 既存 AI errors 仍未解決。

### 下一步

- Plan A #16。

## Milestone #16：completion omission recovery 真實 PI TUI acceptance（2026-08-14）

### 已完成項目

- 完成 `PiTui_WhenCompletionIsOmitted_ShouldRecoverOnceAndSettle`，位於 `forge-runtime/tests/extensions/pi-grill-interactive.test.ts:229`。
- Faux 僅回傳單一無 tool prose，觸發 completion omission；後續沒有 response 或 input。
- 驗證顯示 `GRILL_COMPLETION_REQUIRED`，並提供 retry／cancel／switch；panel 只出現一次，user 首輪只出現一次；settle 後 assistant 訊息不再增加，且 queue 耗盡。

### 重要決策

- 本 milestone 僅驗收既有 omission recovery contract，不新增 production 行為或改變 recovery 流程。
- 單一無 tool prose 後沒有後續 response／input，確保 omission recovery 只觸發一次並 settle。

### 修改檔案

- `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md`（本次僅更新 durable state；無 production 修改）。

### 測試結果

- 精準命令：`npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-name-pattern='^PiTui_WhenCompletionIsOmitted_ShouldRecoverOnceAndSettle$' tests/extensions/pi-grill-interactive.test.ts`。
- exit 0，1/1 pass；驗證 `GRILL_COMPLETION_REQUIRED`、retry／cancel／switch、panel 一次、user 首輪一次、settle 後 assistant 不增與 queue 耗盡。

### 未解問題

- Plan A #17 尚未完成；focused/full、typecheck、review 與 upstream 既存 AI errors 仍未解決。

### 下一步

- 執行 Plan A #17。

## Milestone #17：單一 input omission terminal boundary acceptance（2026-08-14）

### 已完成項目

- 完成 `PiTui_WhenSingleInputRuns_ShouldBoundAssistantTurns`，位於 `forge-runtime/tests/extensions/pi-grill-interactive.test.ts:317`。
- 驗證單一 input 在 omission terminal boundary 後可記錄 faux callCount／assistant count；短暫 quiescence 後數量不再增加，且 `pending=0`、`user=1`。

### 重要決策

- assistant count 不硬編固定 N，只驗證 terminal boundary 後穩定不再增加；判定此情境不可重現，沒有持續 open-handle blocker。
- 作者首次原命令曾 pass 後 timeout；獨立驗證已重跑 Plan A #16／#17，兩者皆約 7.5 秒、自行 exit 0；#17 為 1/1。

### 修改檔案

- `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md`（本次僅更新 durable state；無 production 修改）。

### 測試結果

- #16 獨立驗證約 7.5 秒、自行 exit 0；#17 獨立驗證約 7.5 秒、自行 exit 0，1/1；詳細記錄見 `agent-state/plan16-exit-check.log` 與 `agent-state/plan17-exit-check.log`。

### 未解問題

- focused／full／typecheck／review 與 upstream 既存 AI errors 尚未解決或完成；目前無持續 open-handle blocker。

### 下一步

- 進行 Plan A 完整驗證。

## Milestone：Plan A 完成與 final review（2026-08-14）

### 已完成項目

- Plan A #1–#17、focused／TUI／完整驗證與 final review 全部完成；當前 0 open findings。
- Standards P1 已修正：非 active Grill attempt 的兩工具以 `pendingGrillRun && stage===GRILL` 共同 gate 加 execute guard fail-closed。
- Spec 兩個驗收缺口已補：正常 TUI 明確排除 `continue`；omission 靜置不自動 retry，僅 `/forge-runtime retry` 建立下一 attempt。
- `forge-runtime/tsconfig.pi-interactive.check.json` 已加入 Plan A 文件邊界；upstream 測試路徑修正為 `pi-main/packages/coding-agent/test/interactive-tui.test.ts`。
- runner 因 full-suite 並行造成 loader 30s timeout，`package.json` test 改為 `--test-concurrency=1`，未放寬 timeout。

### 重要決策

- Plan A 已完成；下一步自動執行 Plan B。Plan B 尚未完成，不得提前宣稱完成。（歷史紀錄，已被後續決策取代。）

### 修改檔案

- 本 milestone 僅同步 durable docs；production／test 修改詳見 Plan A 與 review 證據。

### 測試結果

- P1 1/1 exit 0：`agent-state/plan-a-review-p1-green.log`。
- TUI 4/4 exit 0：`agent-state/plan-a-review-tui-green.log`。
- `npm run check` exit 0：`agent-state/plan-a-final-check.log`。
- `npm test` 114/114 exit 0：`agent-state/plan-a-final-suite-after-review.log`。
- upstream seam Vitest 4/4；upstream `npm run check` 僅剩既有 `packages/ai` 測試型別錯誤，非此次 terminal seam。

### 未解問題

- 無 Plan A open findings；upstream 既有 `packages/ai` 測試型別錯誤仍存在，非本次 terminal seam 範圍。

### 下一步

- 等待使用者決定是否進入 Plan B 人工視覺驗收；維持 Plan B 未完成且未核准狀態。
