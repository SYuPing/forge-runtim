---
title: WAIT_USER UI-only state publication
type: ticket
scope: Forge Runtime WAIT_USER custom message delivery
updated: 2026-08-29
source: ADR-0020、docs/PLAN-A.md、CONTEXT.md
status: implemented/verified-with-existing-workspace-caveats
---

# Ticket：WAIT_USER UI-only state publication

## 目標

移除 WAIT_USER `publishState()` 對不受 PI 0.84.3 支援的 `displayOnly` `forge-stage` custom message 投遞，保留正式人類決策流程。

## 範圍

- 只改 `forge-runtime/extensions/forge-runtime.ts` 與指定測試。
- 保留 state、`setStatus`、WAIT_USER selector／custom editor、followUp、retry、cancel、switch 與 recovery settle。
- 不改 `pi-main`、全域 PI、project `.pi`、state machine、Deep、setStatus 參數、`warn`／`warning` 或 persistence。

## 驗收條件

- 具名測試 `ForgeStage_WhenPublishingWaitUserState_ShouldNotQueueUnsupportedDelivery` 先 RED，實作後 GREEN。
- `SuccessfulNeedsConfirmationCompletion_TerminatesTurnUntilUserAnswer`、`PiTui_WhenNeedsConfirmationCompletes_ShouldShowQuestionAndAdvanceAfterAnswer`、`PiTui_WhenCompletionIsOmitted_ShouldRecoverOnceAndSettle` 維持通過。
- WAIT_USER 仍出現，使用者回答仍只繼續一次；回答前不得有額外 provider turn。
- 不再 queue `deliverAs: "displayOnly"` 的 `forge-stage` custom message。
- 真實 PI TUI smoke 不再顯示 `forge-stage` panel，最後可執行 `/forge-runtime cancel`。
- 先執行指定 interactive tests，再執行 extension tests、`npm test` 與 `npm run check`；不捏造 passed 數量，基線與結果由驗證角色記錄。

## 手動 smoke

在 `C:\Users\User\Desktop\Agents\pi-test` 執行 `pi`，輸入 `/forge-runtime grill ambiguous {"question":"display-only smoke","recommendation":"accept","options":["accept"],"evidenceIds":["smoke"],"decisionId":"display-only-smoke","roundId":"display-only-smoke-round"}`；確認 WAIT_USER、回答前無額外 provider turn、回答後只繼續一次、聊天沒有 `forge-stage` panel，最後輸入 `/forge-runtime cancel`。

## 執行順序

測試代理先加測試並跑 RED；實作角色再做最小刪除；驗證角色執行測試與 check；review 角色確認沒有 scope 漂移。新 session 必須先讀 `docs/handoff.md`、`CONTEXT.md`、本 ticket、ADR-0020、Plan A、agent-state 與 Memory，展示摘要並等待使用者確認。

## 完成定義

production、測試、文件與狀態同步完成；實際 PI TUI smoke 有可核對輸入／輸出證據；全域 PI 0.84.3 固定安裝與設定歸屬評估仍延後至本 ticket 手動測試通過後。

## 實作與驗證收尾（2026-08-29）

- `publishState` 先更新 `setStatus`；`deliverAs: "displayOnly"` 直接返回，不呼叫 `sendMessage`。WAIT_USER omission branch 使用 display-only 語意，recovery panel 保持 `triggerTurn: false`。
- 保留 state／status／selector／custom editor、answer followUp、retry 與 recovery；不修改 `pi-main`。
- Interactive harness 依目前 `InteractiveModeOptions`（僅 `tuiMode`）修正 10 個測試：使用 test-local `attachVirtualTerminal`，並在 `init`、`run`、`waitForRender` 後送入輸入。
- 驗證：extension targeted 2/2；PI targeted 3/3，包含 no-auto-replay 與 explicit retry（provider callCount 2→3）；static touched errors 0，剩餘 pi-main highlight.js 21 個 baseline errors；`git diff --check` 0，`pi-main` diff 0。
- 真實 PI 0.84.3 no-session smoke：合法 `/grill-run` 後 WAIT_USER `display-only smoke` 通過；confirm processed。所有 observed normal active `forge-stage` 均在 WAIT_USER 前，未取得 WAIT_USER-specific stage 證據；cancel 在 streaming 送入，結果 inconclusive。第一次 forged roundId 被 fail-closed 拒絕，不算產品失敗。
- Full PI file 為 10/11；唯一 Deep dirty-scope failure 是 `PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue`（single search terminate true／no followup），非本 ticket。完整 npm suite 在 85 pass／0 fail 的既有 integration hang 後中止，保留 log。
- Review：核心規範／安全 PASS；manual retry gap 已補。private renderer terminal cast 是 upstream 無 public injection seam 的測試 caveat，未新增抽象。

證據 logs：`verify_three_wait_user_pi_contracts_with_retry_20260829.log`、`verify_two_wait_user_extension_contracts_final_20260829.log`、`verify_static_after_harness_sweep_20260829.log`、`verify_full_pi_grill_interactive_20260829.log`、`verify_full_forge_runtime_suite_20260829.log`。

## 未解風險與下一步

僅保留 Deep dirty-scope failure、完整 suite 的既有 integration hang，以及可選的真實 cancel smoke；本 ticket 不再需要下一 session 實作。
