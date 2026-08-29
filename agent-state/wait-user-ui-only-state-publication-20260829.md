---
title: WAIT_USER UI-only state publication agent state
type: agent-state
scope: wait-user-ui-only-state-publication-20260829
updated: 2026-08-29
source: docs/tickets/wait-user-ui-only-state-publication-20260829.md、ADR-0020、docs/PLAN-A.md
status: implementation-complete-with-known-caveats
---

# Agent State：WAIT_USER UI-only state publication

## 已完成

- Plan A ticket implementation 已完成：WAIT_USER `displayOnly` forge-stage 不再進入 agent delivery，但 state、status、selector、custom editor、followUp 與 recovery 保留。
- omission trigger 已修正：omission message_end 的 UI-only state 不再形成 steer，panel 送出設為 `triggerTurn: false`，避免自動 replay。
- `pi-grill-interactive.test.ts` 的 10 個 harness callsites 已改用目前 `InteractiveMode` API：test-local attach `VirtualTerminal`、`await mode.init()` 與首次 render readiness。
- 已加入明確 retry contract test，驗證 omission recovery 只執行一次且 settle。
- `pi-main` 維持 0 diff；未修改全域 PI 或 project `.pi`。

## 重要決策

- 採單一 Plan A：停止 WAIT_USER `forge-stage` custom message 投遞，不新增替代 UI 或 persistence。
- `publishState` 在 `setStatus` 後對 `deliverAs === "displayOnly"` early return；omission path 另以 UI-only delivery 與 `triggerTurn: false` 關閉非預期 steer。
- retry／continue／followUp／Deep 的正式流程未改動；測試使用註冊的 `forge_grill_complete` 公開工具入口與 test-local TUI seam。

## 修改文件

本 ticket direct files：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。`pi-main`：0。

## 測試結果

RED 已確認。命令：`Push-Location forge-runtime; npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 --test-name-pattern="ForgeStage_WhenPublishingWaitUserState_ShouldNotQueueUnsupportedDelivery" tests/extensions/forge-runtime-extension.test.ts`；exit code 1。failing test：`ForgeStage_WhenPublishingWaitUserState_ShouldNotQueueUnsupportedDelivery`；原因：仍觀察到 `displayOnly forge-stage`，`true !== false`。Log：`C:\Users\User\AppData\Local\Temp\run_wait_user_red_test_20260829.log`。

GREEN 第一次嘗試因測試錯誤時序失敗：fire-and-forget 後同 key 重入，被 `activeWaitUserUiLeaseKey` 擋住。Log：`C:\Users\User\AppData\Local\Temp\run_wait_user_green_target_20260829.log`。測試已改為等待第一次公開 `ctx.ui.select` callback；重跑同名定點測試 exit code 0，1 passed／0 failed。Log：`C:\Users\User\AppData\Local\Temp\run_wait_user_green_target_retry_20260829.log`。

PI GREEN 第一顆已完成：使用者已授權只處理 `pi-grill-interactive` test harness。已確認測試傳入不存在的 `InteractiveModeOptions.terminal`；runtime 使用 `ProcessTerminal`，input 卻送到尚未啟動的 `VirtualTerminal`。在 test-local attach `VirtualTerminal` 並 `await mode.init()` 後，第一次只等待 `waitForRender` 仍失敗；改等待公開 init 後，`SuccessfulNeedsConfirmationCompletion_TerminatesTurnUntilUserAnswer` exit code 0，1 passed／0 failed。Log：`C:\Users\User\AppData\Local\Temp\green_first_virtual_terminal_harness_retry_20260829.log`。本顆未修改 production 或 `pi-main`。

PI GREEN 第二顆已完成：`PiTui_WhenNeedsConfirmationCompletes_ShouldShowQuestionAndAdvanceAfterAnswer` 已完成 test-local `VirtualTerminal` attach、`await mode.init()` 與首次 render readiness 修正，exit code 0，1 passed／0 failed。Log：`C:\Users\User\AppData\Local\Temp\green_second_virtual_terminal_harness_20260829.log`。

最終 extension 兩顆契約測試 exit code 0，2 passed；Log：`C:\Users\User\AppData\Local\Temp\verify_wait_user_extension_contracts_20260829.log`。

第三顆 `PiTui_WhenCompletionIsOmitted_ShouldRecoverOnceAndSettle` 已完成相同的 `VirtualTerminal` attach、init 與首次 render readiness 修正，已越過原始 `GRILL_COMPLETION_REQUIRED` 輸入失敗。進一步 runtime diagnostic 證實，手動 retry 前 `callCount=4`、`pending=0`、`idle=true`，transcript/scroll 已已有 `retry-attempt-completed`；diagnostic 已移除。Log：`C:\Users\User\AppData\Local\Temp\diagnose_third_retry_runtime_retry_20260829.log`。

依 PLAN-A「recovery once and settle、不得自動 replay」，第三顆測試收斂為兩個 scripted responses，等待 idle 並嚴格 assert `callCount === 2`；初始 RED 為 actual 4、expected 2，位置 `pi-grill-interactive.test.ts:782`。Log：`C:\Users\User\AppData\Local\Temp\verify_third_recovery_contract_20260829.log`。

已證實 root cause：omission message_end 的兩個 UI send 未停用 trigger，streaming 轉為兩個 steer，`callCount` 由 2 增至 4；證據為 `forge-runtime.ts:1349-1357` 與 PI 上游 read-only trace。修正為 `forge-runtime.ts:1351` 的 `publishState({deliverAs:"displayOnly"})`，以及 `:1356` 的 panel `{triggerTurn:false}`；合法 retry／continue／followUp／Deep 未變動。manual retry 1/1 通過；GREEN 為 sandbox 外相同測試 exit 0，Log：`C:\Users\User\AppData\Local\Temp\green_third_recovery_contract_elevated_20260829.log`。環境 caveat：sandbox 內 Node v24.14.0 的 `os.userInfo`／tsx 會出現 `uv_os_get_passwd ENOMEM`；sandbox 外驗證成功，這不是已證實的 Windows 資源耗盡根因。

hunt probes 均維持相同失敗：暫時恢復 displayOnly delivery、startup delay 100→2000ms；last-non-empty viewport 只有 PI idle UI，沒有 user/provider/tool/select。`terminal.start` wrapper probe 未解且已停止。所有 probes 與殘留程序已清理，source/test 無 probe diff。

驗證摘要：PI interactive 3/3、extension contract 2/2、manual retry 1/1；static touched 0/21 highlight baseline；full PI 10/11，唯一 Deep failure 屬 out-of-scope；full suite 85 pass、0 fail 後因 hang 中止；`git diff --check` 0。Logs：`C:\Users\User\AppData\Local\Temp\pi-baseline-wait-user-tests-{1,2,3,4}.log`。

真實 PI TUI smoke：WAIT_USER question pass；normal stage messages 均在 boundary 前出現；confirm 已處理，但 exact count 以 automated test 為準；cancel 在 streaming 時送入，結果 inconclusive；no-session path 未納入全綠判定。

## 未解問題

- Deep dirty failure：屬 out-of-scope，另開 ticket 處理。
- Full suite 在 85 pass／0 fail 後 hang；需另行定位。
- test-local private renderer cast 有維護風險；可考慮未來由正式 API 取代。
- optional future idle cancel smoke 尚未覆蓋；cancel streaming smoke 目前 inconclusive。
- static check 保留 21 個既有 highlight.js baseline errors；sandbox 有 `uv_os_get_passwd ENOMEM` caveat。

## 下一步

下一步：完成 final re-review、git check 與文件同步後交付；Deep failure 另列 ticket。全域 PI 0.84.3 設定歸屬評估延後。
