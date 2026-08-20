# Ticket 狀態：grill-completion-terminal-boundary-20260819

## 已完成項目

- 已完成方案 C 的 durable docs 同步：架構、Context、ADR-0011、ADR-0012、Plan A、handoff。
- Forge production 已完成：NEEDS_CONFIRMATION WAIT_USER 使用 displayOnly、成功回傳 `terminate:true`、移除 `suppressCompletionTurn`。
- Forge regression 已完成：`SuccessfulNeedsConfirmationCompletion_TerminatesTurnUntilUserAnswer` 與 READY characterization 均 GREEN。
- 使用者已明確確認依 Plan A 開始，並授權修改 `pi-main`。
- PI core 第一個 streaming tracer bullet 已完成有效 RED→GREEN。
- PI core provider conversion tracer bullet 已完成 RED→GREEN；display-only 訊息留在 session，但不送入 provider context。
- PI core compaction marker rehydrate 已完成 RED→GREEN；split-turn summarizer provider conversion 不再包含 display-only marker。
- PI core branch summarization marker rehydrate 已完成 RED→GREEN；branch summarizer provider conversion 不再洩漏 display-only marker。
- PI core session-file marker write/reopen 與 AgentSession persistence forwarding 均已完成 RED→GREEN。
- READY_FOR_DEEP regression 已完成 characterization GREEN：`SuccessfulReadyForDeepCompletion_ReturnsTerminatingResultWithoutConfirmationUi` 已存在於 `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`；未修改 production。
- NEEDS_CONFIRMATION milestone 已完成：初次 final focused red log `agent-state/logs/needs-confirmation-final-20260820.log` 回答前舊回合為 `second-call`。
- Forge root fix 已完成：成功 NEEDS WAIT_USER 將 `displayOnly` 沿 `publishWaitUser→handleWaitUserState→publishState→pi.sendMessage` 傳下；其他 state 不變。
- 回答後 resume 的 fire-and-forget race 以既有 `pendingReplayInvocation` 解決：UI/command 先 resume、設 replay、送完整 followUp invocation；一般 input 仍用 `transform`，避免巢狀 `emitInput`。
- 等待觀測點已修正：不再等待原 viewport 的 grill-2，改等 `runtime.session.messages` 第二則 user message 含 grill-2；WAIT_USER viewport 斷言保留。

## 重要決策

- PI coding-agent `0.83.0`、commit `321bbe69e909de9551906967629908a99167d11e`（`321bbe6`）、main 是唯一支援基線。
- `deliverAs: "displayOnly"` 只用於成功 `forge_grill_complete` 的 `NEEDS_CONFIRMATION` WAIT_USER state message；marker 為 `excludeFromContext?: boolean`。
- public `CustomMessage` 與 `CustomAgentMessages.custom` 維持 HEAD；`excludeFromContext` 僅在 internal intersection，不改 agent harness/public wire。
- 不降版、不回填舊 session；`packages/agent/src/harness/*` 不改，跨 package JSONL 不保證。

## 修改檔案

- 本輪文件：`FORGE_RUNTIME_Arch_v4.md`、`CONTEXT.md`、`docs/adr/ADR-0011-grill-completion-terminal-boundary.md`、`docs/adr/ADR-0012-display-only-custom-message.md`、`docs/PLAN-A.md`、`docs/handoff.md`、本檔。
- Forge 工作檔：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。
- PI core RED test：`pi-main/packages/coding-agent/test/suite/agent-session-queue.test.ts`。
- PI core tests：`pi-main/packages/coding-agent/test/suite/agent-session-queue.test.ts`、`pi-main/packages/coding-agent/test/suite/lax-message-content.test.ts`、`pi-main/packages/coding-agent/test/compaction.test.ts`、`pi-main/packages/coding-agent/test/session-manager/file-operations.test.ts`、`pi-main/packages/coding-agent/test/branch-summarization.test.ts`。
- PI core production：`pi-main/packages/coding-agent/src/core/agent-session.ts`、`pi-main/packages/coding-agent/src/core/extensions/types.ts`、`pi-main/packages/coding-agent/src/core/messages.ts`、`pi-main/packages/coding-agent/src/core/session-manager.ts`、`pi-main/packages/coding-agent/src/core/compaction/branch-summarization.ts`。
- 測試證據：`agent-state/logs/streaming-corrected-red-20260820.log`、`agent-state/logs/streaming-corrected-green-20260820.log`、`agent-state/logs/persistence-convert-red-fixed-import-20260820.log`、`agent-state/logs/persistence-convert-green-20260820.log`、`agent-state/logs/compaction-turn-prefix-20260820.log`、`agent-state/logs/compaction-green-20260820.log`、`agent-state/logs/session-file-red-fixed-fixture-20260820.log`、`agent-state/logs/session-file-green-20260820.log`、`agent-state/logs/agent-session-forwarding-red-20260820.log`、`agent-state/logs/agent-session-forwarding-green-20260820.log`。
- READY_FOR_DEEP regression 測試證據：`SuccessfulReadyForDeepCompletion_ReturnsTerminatingResultWithoutConfirmationUi`，`1 passed`、`0 failed`、`0 skipped`、exit 0；log：`agent-state/logs/ready-regression-final-20260820.log`。
- NEEDS_CONFIRMATION final GREEN 測試證據：`agent-state/logs/needs-confirmation-session-contract-20260820.log`，`1 passed`、`0 failed`、`0 skipped`、exit 0。

## 測試結果

- 最終驗證：Forge `npm test` 132 passed、exit 0（`agent-state/logs/forge-full-test-green-final-20260820.log`）；Forge post-review check/full 均 exit 0（`forge-check-after-review-20260820.log`、`forge-full-after-review-20260820.log`）；Forge interactive 9 passed（`forge-pi-interactive-full-green-20260820.log`）。PI focused 5 files 76 passed／2 skipped、exit 0（`pi-display-only-five-files-final-20260820.log`）；PI Biome 991 files exit 0（`pi-readonly-biome-final-final-20260820.log`）。branch summarization RED／GREEN：`branch-summary-displayonly-red-20260820.log`、`branch-summary-displayonly-green-final-20260820.log`。pinned／ts imports／shrinkwrap／install-lock 均 exit 0。
- PI tsgo 本次 CustomMessage／SessionEntry errors 已清，仍有 `packages/ai` 六個 untouched baseline errors（`agent-state/logs/pi-readonly-tsgo-after-fix-20260820.log`）；canonical `npm run check` 未跑，因含 `--write`，改跑唯讀子命令。
- 最終契約：READY 自動進 Deep、不要求 idle；NEEDS 以 session/provider marker 觀測，不以 roundId viewport 作唯一等待點。人類回答為 WAIT_USER→USER_CONFIRMED→GRILL；UI/command 先 resume、重用 `pendingReplayInvocation` 後送完整 followUp invocation；direct input 用 transform，避免 nested `emitInput`。

- 歷史 RED：NEEDS focused 首次曾為 actual=`second-call`、expected=`idle`；已由 displayOnly／terminal boundary 修正並 GREEN，保留此項只作 RED→GREEN 證據。
- 初版 PI core streaming test 的 tool-call fixture 會自然產生 tool-result continuation；runtime probe 證實第二次 context 為 `user, assistant, toolResult` 且沒有 display-only custom message，因此該證據已作廢。
- 修正後 PI core streaming RED（workdir `pi-main/packages/coding-agent`）：同一 focused test，exit 1；`providerCalls` actual=`2`、expected=`1`，非環境或編譯 blocker。
- 套用最小 display-only route 後，同一 focused test GREEN：exit 0，`1 passed`、`14 skipped`，約 4.70 秒。
- Provider conversion RED：`keeps display-only custom messages visible without sending them to the provider`，exit 1；provider payload 實際包含 `WAIT_USER_DISPLAY_ONLY_TEST`。
- 加入 marker 與 `convertToLlm` filter 後同一測試 GREEN：exit 0，`1 passed`、`6 skipped`，約 4.36 秒。
- Compaction RED：`excludes display-only custom messages from provider conversion`，exit 1；split-turn provider conversion 仍包含 `DISPLAY_ONLY_COMPACTION_MARKER`。
- `CustomMessageEntry → CustomMessage` marker rehydrate 後同一測試 GREEN：exit 0，`1 passed`，約 4.2 秒。
- Session-file RED：`round-trips display-only custom entries without provider conversion`，exit 1；raw JSONL marker actual=`undefined`、expected=`true`。加入 optional write field 後 GREEN：exit 0，`1 passed`、`26 skipped`。
- AgentSession forwarding RED：`forwards displayOnly marker to persisted custom message entries`，exit 1；entry marker actual=`undefined`、expected=`true`。傳入第五參數後 GREEN：exit 0。
- READY_FOR_DEEP regression 的斷言僅涵蓋 `terminate=true`、`status=READY_FOR_DEEP`，以及沒有確認 UI／`displayOnly` WAIT_USER；不把 READY 自動進入 Deep 的 queued steer 當成 idle 邊界。
- NEEDS_CONFIRMATION 未擴大 `displayOnly` 到其他 state，未修改 PI `sendUserMessage` async 契約。
- 舊 state 的 vitest/deadline/9.6 秒證據已過期，不再採用。
- 本輪文件角色未執行測試或程式檢查；最終驗證由獨立代理完成。

## 未解問題

- PI core display-only 的 streaming、live provider conversion、compaction rehydrate、branch summarization rehydrate、persisted entry write 與 session-file round-trip 均已完成 focused 驗證。
- READY_FOR_DEEP regression 已記為 characterization GREEN；沒有 production 修改。queued steer 導致的 READY→Deep 不屬於本回歸的 idle 邊界。
- `terminate` 仍可能被 queued steer 延續；extension API send/sendUserMessage fire-and-forget lifecycle、深度知識後新歧義轉移及跨 package JSONL 不在 scope；Node DEP0190 warning 與 PI packages/ai 六個 baseline errors 仍存在。

## 下一步

- targeted final review：Standards 0 findings、Spec 0 findings；P2 public union 與 hard `any` finding 均已解決。
- branch summarization final GREEN：`agent-state/logs/branch-summary-final-final-green-20260820.log`，1 passed、0 failed、exit 0；no-`any` 後驗證已完成。
- 最新 PI tsgo：`agent-state/logs/pi-tsgo-final-six-baseline-20260820.log`，僅剩 `packages/ai` 六個 untouched baseline errors。
- 新測試使用具體 `Model<"openai-completions">`，無 `any`；`Model.cost`／`Usage.cost` fixture 正確。
- modified files 清單確認包含 `pi-main/packages/coding-agent/src/core/compaction/branch-summarization.ts` 與 `pi-main/packages/coding-agent/test/branch-summarization.test.ts`。
- Plan A completed，無待實作；下一步僅使用者決定 commit／PR，或後續處理 baseline／out-of-scope 風險。Plan B 未執行。
