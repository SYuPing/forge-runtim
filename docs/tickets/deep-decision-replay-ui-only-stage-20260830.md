---
title: Decision replay 的 UI-only stage 修正
type: ticket
scope: Forge Runtime extension stage publication 與 needs_decision settled replay
updated: 2026-08-30
source: 使用者實測紀錄、ADR-0022、docs/PLAN-A.md
status: complete
---

# Ticket：Decision replay 的 UI-only stage 修正

## 目標

修正使用者回答 `needs_decision` 後，純 UI `forge-stage` 搶在新 attempt identity 前進入 steer queue，造成舊 identity 反覆重試與多次 `Tool execution was blocked` 的問題；同時確保 `CONTEXT_BUILD` stage 不進 provider context。

## 已核准根因

`publishState` 的 `pi.sendMessage` 將純 UI stage 排入 agent-loop；current run 未 terminate，模型持舊 identity 重試。PI block 不終止 current run，followUp 必須等 settle。證據：`forge-runtime/extensions/forge-runtime.ts:2356-2374`、`pi-main/.../agent-loop.ts:617-642`、`agent-session.ts:1551-1580`、`messages.ts:148-169`。

## 建置內容

- 所有 `forge-stage` 經唯一 `publishState` 出口以 `ctx.ui.setStatus("forge-runtime", status)` 只做 UI 顯示，不進 `pi.sendMessage` 或 provider context；固定 key 與 status text 不可省略。
- decision answer 後 terminate current run，沿用 `agent_settled` + next task + ordinary user message，先完成新 identity 交接再開放 Deep。
- 保留 pending marker、matching `message_start`、stale identity 與 fail-closed gate。
- Retrieval completed 與 Deep `needs_decision` answer 只設定既有 `pendingSettledDeepInvocation`；待 `agent_settled` 後由既有 identity／active-tool／workflow guards 發送新的 invocation。這是 transport 修正，保留既有流程順序，不改 state machine。
- 第一次 Deep `needs_discovery` 的 settled marker 根因已由 test-only Promise trace 確認：`agent_end → agent_settled → sendUserMessage` 的 Promise 雖已 resolve，但 provider `callCount=4`、`pendingResponses=4`；`pi.on("input")` 在沒有 marker且 stage=`GRILL` 時回 `handled`（已有 workflow），因此 invocation 被吃掉。只有精確等於 `pendingReplayInvocation` 時才回 `continue`。因此 Discovery timer 在所有 settled guards 通過後、呼叫 `sendUserMessage` 前，必須先設定 `pendingReplayInvocation = pendingDiscovery.invocation`；後續沿用既有 `message_start` full exact match 清除與 tool_call fail-closed gate。sendUserMessage 失敗時保留 marker。Deep 邏輯不改，其他輸入仍按原契約處理。

## 不建置

不改 state machine、evidence、validator、Grill、第一次 `needs_discovery` restart、READY_FOR_DEEP、Context Build、WAIT_USER、cancel/retry/switch、合法 Deep 後續、UI 視覺、public API、scheduler、tool schema 或 `pi-main`。若需要第二個 production 檔，先停下回報。

## 允許檔案

- Production：`forge-runtime/extensions/forge-runtime.ts`
- Tests：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`
- Documents：本 ticket、ADR-0022、Plan A、CONTEXT、handoff、agent-state

## 測試切片與順序

每個切片先由測試子代理補測試並執行 RED，再由主代理做最小 production 修正；驗證與 review 必須由獨立角色執行。

1. Extension status seam 收到固定 key `forge-runtime` 與 `CONTEXT_BUILD` status text。
2. 真 PI trace 必須實際到達 Context Build，再驗證 provider context 沒有 user-role stage；不能只用「沒有 literal」假綠。
3. Retrieval accepted／terminate 後 trace 為 `callCount=5` 且 idle；decision answer 後 fresh deep-2 首次 Deep call 成功且 blocked=0。
4. Extension pending replay 期間舊 attempt 仍被 gate 阻擋。

基線：Extension 142、PI 12、全套 248；預估目標：Extension 144、PI 14、全套 252，實際以測試結果為準。

## 驗收條件

既有流程的測試與行為維持不變；上述三個切片通過；`pi-main` 無 diff；不得以放寬 fail-closed 或修改上游流程換取綠燈。

## 風險

若 UI status/notify 並非純顯示，或 settled identity／Discovery marker 無法在首次 Deep／Grill call 前進入 provider context，需停止並回報架構衝突；不新增替代 transport。不得修改 session-state、Grill WAIT_USER、needs_discovery 次數／人類確認規則、READY、validator、evidence、state machine 或 `pi-main`。
## 完成狀態（2026-08-30）

已完成並驗證。測試確認：A1 使用 `forge-runtime` status key/text；A2 Context Build 真正到達且 stage 不進 provider；B 決策後 fresh attempt 首次成功且 blocked=0；C 舊 attempt 在 `message_start` 前仍維持 blocked；fallback 完成 Grill-2→第二次 discovery→固定 prompt→確認→Understanding；Extension helper 確認 tool-result 不夾 control invocation 且 settled 後才送 user message。兩個既有 PI 測試只調整事件屏障與局部 5 秒等待，未放寬契約斷言。

Production 只涉及 Forge extension transport/replay 邊界；未修改 pi-main、session-state、state machine、evidence/validator、needs_discovery 次數、人類確認、其他 tool_result 或 WAIT_USER 語意。
