---
title: Decision replay 的 UI-only stage 修正狀態
type: agent-state
scope: deep-decision-replay-ui-only-stage-20260830
updated: 2026-08-30
source: docs/adr/ADR-0022-forge-stage-ui-only-settled-decision-replay.md、docs/PLAN-A.md、docs/tickets/deep-decision-replay-ui-only-stage-20260830.md
status: complete
---

# Agent state：deep-decision-replay-ui-only-stage-20260830

## 已完成

- 已確認使用者實測根因與最小修正方向。
- 已建立 ADR、ticket、Plan A、CONTEXT 與 handoff 交接內容。
- 已明確限定本 ticket 只允許一個 production 檔與兩個測試檔，不修改 `pi-main`。
- Slice A1 已完成：`Extension_ContextBuildStatus_ShouldUseForgeRuntimeKeyAndStatusText` 先以缺少固定 key／text 的實作有效 RED，修正後 GREEN 1/1、exit 0。
- Slice A2 的測試 seam 調查已完成；下一個有效測試必須證明 Context Build 真正到達，不能只用沒有 literal 假綠。
- 真 PI trace 已確認 Retrieval accepted／terminate 後 `callCount=5` 且 idle，根因是 Retrieval→Knowledge Understanding 缺少 explicit continuation。
- Production 已完成 `forge-stage` UI-only、固定 status key，以及 Retrieval completed／Deep `needs_decision` answer 的 settled replay producer。
- 真 PI fallback trace 證實第一次 `needs_discovery` 的 `tool_result` transform 若把 invocation 拼入 tool-result content，不會產生下一個 provider user turn；accepted tool result 後停住並留下 pending provider responses。test-only spy 進一步證明 direct follow-up 雖被呼叫，仍無 queue update，provider `callCount=4`、`pendingResponses=4`，targeted fallback 13 pass/1 fail、blocked=0。

## 重要決策

- `forge-stage` 只保留 UI 顯示，使用 `ctx.ui.setStatus("forge-runtime", status)` 固定 key 與 text，不進 agent loop 或 provider context；只移除 `sendMessage` 會讓 footer provider 刪除項目。
- decision answer 後沿用 settled identity replay，先送新 identity，再開放 Deep tool。
- Retrieval completed 與 Deep `needs_decision` answer 只設定既有 `pendingSettledDeepInvocation`，待 `agent_settled` 後由既有 identity／active-tool／workflow guards 發送。
- pending marker 與 fail-closed gate 保留；其他現有流程視為不變量。
- 只有 Plan A；不做 Plan B，因本次不改 UI 畫面。
- 已否決 direct follow-up：spy 證明 `sendUserMessage(..., { deliverAs: "followUp" })` 被呼叫但沒有 queue update。test-only Promise trace 進一步確認根因：`agent_end → agent_settled → sendUserMessage` 的 Promise 已 resolve，但 `pi.on("input")` 在沒有 marker且 stage=`GRILL` 時回 `handled`，把 invocation 吃掉；只有精確等於 `pendingReplayInvocation` 時才回 `continue`。新方向是保留 pendingDiscoveryRestart 與既有 guards；Discovery timer 在所有 settled guards 通過後、呼叫 `sendUserMessage` 前先設定 `pendingReplayInvocation = pendingDiscovery.invocation`，後續沿用 `message_start` full exact match 清除與 tool_call fail-closed gate，sendUserMessage 失敗時保留 marker。Deep 邏輯不改，其他輸入仍按原契約。

## 修改檔案

本 milestone 已修改檔案：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`，以及本狀態檔與本 ticket 文件。Production 已包含固定 status key、`forge-stage` UI-only、兩個 settled producer；相容修正尚待套用。未修改 session-state、Grill WAIT_USER、needs_discovery 次數／人類確認規則、READY、validator、evidence、state machine、Memory 或 `pi-main`。

## 測試結果

Slice A1 RED→GREEN 1/1、A2／B／C targeted green；Extension full 144/144。真 PI fallback trace 顯示第一次 `needs_discovery` accepted tool result 後沒有下一個 provider user turn，留下 pending provider responses；PI full 因此仍紅。相容修正後需重跑 fallback targeted、PI full、Extension full、type/check 與 whole suite。

## 未解問題

- 相容修正尚未套用：第一次 `needs_discovery` 需在 Discovery settled timer 通過既有 guards 後，先設定 `pendingReplayInvocation = pendingDiscovery.invocation`，再用既有正常 user message 產生下一個 provider user turn；sendUserMessage 失敗時保留 marker。
- pending matching `message_start` 與 fail-closed gate 必須保留；不得以放寬 gate 消除 blocked。
- PI full、fallback targeted、Extension full 回歸、type/check 與 whole suite 尚待相容修正後重新驗證。

## 下一步

下一步：在既有 Discovery settled timer 的所有 guards 通過後、呼叫 `sendUserMessage` 前設定 `pendingReplayInvocation = pendingDiscovery.invocation`，保留既有 `message_start` full exact match 清除與 tool_call fail-closed gate；sendUserMessage 失敗時保留 marker。完成後由獨立驗證角色重跑 fallback targeted、PI full、Extension full、type/check、whole suite，再更新 Memory 與收尾文件。保留 Grill WAIT_USER、needs_discovery 次數／人類確認規則、READY、validator、evidence、state machine、`pi-main` 與其他流程不變。
## 收尾狀態（2026-08-30）

### 已完成項目

- 完成 UI-only `forge-stage` 與 settled replay。
- 完成第一次 `needs_discovery` 的 settled restart marker 與防 stale replay 驗證。
- 完成 A1、A2、B、C、fallback 與 Extension helper 回歸驗證。

### 重要決策

- 不以 custom agent message 傳送 stage；只更新 `forge-runtime` UI status。
- 所有控制性 continuation 在 settled 後才送正常 user message；保留 full exact message-start 清除與 fail-closed tool gate。
- 不修改 pi-main、session-state、state machine、evidence/validator 或既有人類確認語意。

### 修改檔案

- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`
- 本狀態所列設計、交接與 Memory 文件。

### 測試結果

- fallback clean：1/1，exit 0。
- PI full：14/14，約 10.69 秒，無 blocked/pending/dispose async。
- Extension：144/144，約 3.04 秒。
- npm test：252/252，約 30.2 秒。
- final review：無阻擋 finding。
- 一般 typecheck 通過且本次 3 個修改檔無型別錯；整體 `npm run check` 仍被既有 pi-main highlight.js TS7016 共 21 筆阻擋。

### 未解問題

- PI interactive typecheck 的既有上游型別阻塞。
- 低風險的 `sendUserMessage` 故障注入尚未覆蓋。

### 下一步

- 可選修復上游依賴型別；不屬本 ticket 必要工作。
