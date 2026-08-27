---
title: Deep stale-result loop 修正
type: ticket
scope: forge-runtime Deep Retrieval stale-result loop
updated: 2026-08-27
source: CONTEXT.md、ADR-0015、docs/PLAN-A.md、docs/handoff.md
status: implemented-and-automated-verified-awaiting-real-session
---

# deep-stale-result-loop-20260826

## 目標

只修正「過期的 Deep Retrieval 完成結果已忽略。」反覆循環，不改其他流程。

## 根因與修正

Deep identity followUp 在 input preflight 就清 pending；Deep stage panel streaming 可成為 steer 並先 drain，舊 identity completion 因而先執行並被 stale guard 忽略。修正為初始 Deep stage panel 使用 `displayOnly`；input 只預載本回合 Deep tools，不清 pending；matching user `message_start` 才清 pending；pending 期間阻擋 Deep tool_call。工具預載與 delivery 授權分離，避免 identity 到達時工具尚未註冊。

## 驗證

- 真實 AgentSession／InteractiveMode／faux provider regression：未修版 RED 1 fail；修正版 GREEN 1 pass，後續合法 Deep search accepted。
- extension targeted 117/117、PI integration 10/10、完整 `npm test` 212/212、`npm run check` exit 0。
- TUI 以 `waitForScrollBuffer` 驗證 displayOnly stage，避免 viewport 假陰性。
- 真實 PI v0.83.0 已從 repo root 以 `.\pi-main\pi-test.bat --approve` 啟動，啟動畫面列出 `forge-runtime.ts`；這只是 smoke check，沒有捕捉原始 stale 情境輸入／結果。
- logs：`forge-runtime/artifacts/test-logs/deep-final-formal-red-20260827.log`、`deep-final-formal-green-20260827.log`、`deep-target-extension-suite-20260827.log`、`deep-target-pi-integration-rerun-20260827.log`、`deep-final-full-npm-test-20260827.log`、`deep-final-npm-check-20260827.log`。

## 邊界與未解風險

未修改 `pi-main/`，無暫時 debug probe，review 僅針對指定 scope。blocked tool result `terminate=false` 可能讓模型持續重試而延遲 followUp；其他 Deep `/continue` panel 預設 sendMessage 仍可能形成 steer；兩者均未宣稱已修。Grill `message_end` sibling risk 不在本 ticket。尚待使用者在真實 PI session 重跑原始情境。
