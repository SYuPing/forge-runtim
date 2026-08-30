---
title: Forge stage UI-only 與 settled decision replay
type: architecture-decision-record
scope: Forge Runtime 純 UI stage 發布與 needs_decision 回答後的 identity 交接
updated: 2026-08-30
source: 使用者實測紀錄、FORGE_RUNTIME_Arch_v4.md、ADR-0018、ADR-0020、既有 forge-runtime extension／PI integration 證據
status: accepted
---

# ADR-0022：Forge stage UI-only 與 settled decision replay

## 狀態

設計已核准，implementation-in-progress；ticket：`deep-decision-replay-ui-only-stage-20260830`。目前已完成 status key、`forge-stage` UI-only 與兩個 Deep settled producer；第一次 `needs_discovery` 的 Discovery settled replay 相容修正待實作與驗證。

## 背景與根因

使用者實測在 `needs_decision` 回答後連續看到多次 `Tool execution was blocked`。根因已確認：`publishState` 在 [`forge-runtime/extensions/forge-runtime.ts:2356-2374`](../../forge-runtime/extensions/forge-runtime.ts) 將純 UI 的 `forge-stage` 經 `pi.sendMessage` 放入 steer queue，位置排在新的 attempt identity 前；current run 又未 terminate。模型遂以舊 identity 重試，`pendingReplayInvocation` 期間的 fail-closed gate 只能重複阻擋。`CONTEXT_BUILD` stage 同樣可能進 provider context，模型因而誤讀成使用者要求。

PI 的 block 結果不會自動終止 current run；followUp 必須等 current run settle。相關上游證據位於 `pi-main/.../agent-loop.ts:617-642`、`agent-session.ts:1551-1580`、`messages.ts:148-169`。

## 決策

1. 在唯一 `publishState` 出口，所有 `forge-stage` 永遠是 UI-only，使用 PI 正確契約 `ctx.ui.setStatus("forge-runtime", status)` 固定傳入 key 與 status text，然後 return；不得呼叫 `pi.sendMessage`，不得進 agent/provider context。所有 caller 一次適用，Grill prompt 與 Deep invocation 既有的 round／attempt identity 不受影響。
2. `needs_decision` answer 後終止 current run，沿用既有 READY 的 `agent_settled` + next task + ordinary user message 模式；先送出新的 attempt identity，完成 matching `message_start` 後才允許後續 Deep call。
3. 保留 pending marker、identity/stage/tools revalidation、stale reject 與全部 fail-closed gate。阻擋是安全邊界，不因降低 blocked 訊息而放寬。

4. Retrieval completed 與 Deep `needs_decision` answer 都只設定既有 `pendingSettledDeepInvocation`；等 `agent_settled` 後，由既有 next task、identity、active-tool 與 workflow guards 發送新的 provider-facing invocation。這是 transport 修正，不改 state machine 或既有流程順序。

5. 第一次 Deep `needs_discovery` 的 settled marker 根因已由 test-only Promise trace 確認：`agent_end → agent_settled → sendUserMessage` 的 Promise 雖已 resolve，但 provider `callCount=4`、`pendingResponses=4`；`pi.on("input")` 在沒有 marker且 stage=`GRILL` 時回 `handled`（已有 workflow），因此把 invocation 吃掉。只有精確等於 `pendingReplayInvocation` 時才回 `continue`。因此 Discovery timer 在所有 settled guards 通過後、呼叫 `sendUserMessage` 前，必須先設定 `pendingReplayInvocation = pendingDiscovery.invocation`；後續沿用既有 `message_start` full exact match 清除與 tool_call fail-closed gate。sendUserMessage 失敗時 marker 保留。Deep 邏輯不改，其他輸入仍按原契約處理。

## 不變量與範圍

本次不得改變 state machine、evidence、validator、Grill、第一次 `needs_discovery` restart、READY_FOR_DEEP 語意、Context Build、WAIT_USER、cancel/retry/switch、合法 Deep 後續或任何既有流程的狀態／資料／工具權限語意。Production 只允許 `forge-runtime/extensions/forge-runtime.ts`；測試只允許 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 與 `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。不修改 `pi-main/`、public API、tool schema、scheduler、替代 queue 或 UI 視覺。

若實作需要第二個 production 檔、public API 或新的事件 API，視為架構衝突，立即停止並回報，不擴大 scope。

## 驗收與脆弱假設

TDD 依三個 vertical slices 驗收：

- 真 PI trace 必須證明 Retrieval accepted／terminate 後 `callCount=5` 且 session idle，顯示 Retrieval→Knowledge Understanding 缺少 explicit continuation；修正應補上既有 settled transport。
- A2 必須證明 Context Build 真正到達，不能只用「沒有 literal」形成假綠。
- PI provider context 沒有 user-role `forge-stage` 或 `Forge CONTEXT_BUILD [active]`。
- decision answer 後新 identity 的首次 Deep call 成功一次，observable blocked result 為零。
- Extension 在 pending decision replay 期間，舊 attempt 仍被公開 `tool_call` gate 阻擋。

脆弱假設是 `ctx.ui.setStatus("forge-runtime", status)` 不會進 agent loop，以及 `agent_settled` next task 能在 matching identity／Discovery marker 進入 context 後恢復工具。先前只傳 status 的假設已被 PI `types.ts:149-150` 與 footer provider 行為證偽，會因 undefined text 刪除項目；直接 Discovery follow-up 也已被 test-only spy 證偽（無 queue update、callCount=4、pendingResponses=4）。settled Discovery 修正後若 PI/provider 時序不成立，測試必須失敗，不得改成寬鬆 gate。

## 關聯

本 ADR 延續 ADR-0018 的 identity／stale 原則與 ADR-0020 的 UI-only publication；只處理 stage transport 與 settled decision replay，不取代其他 state、evidence 或 validator ADR。
## 實作與驗證結果（2026-08-30）

狀態：Accepted / Completed。

已依本 ADR 落地：`forge-stage` 改為 UI-only status；Deep decision answer 與 Retrieval completed 延後至 `agent_settled` replay。第一次 `needs_discovery` 維持既有自動 restart，但以獨立 settled marker 串接到 settled 後的正常 user message，並保留 workflow、GRILL、round、tool、送訊息能力的精準驗證。`message_start` full exact 清除與 `tool_call` fail-closed gate 未放寬。

未修改 `pi-main`、session-state、state machine、evidence/validator，也未改變 discovery 次數、人類確認、其他工具結果或 WAIT_USER 語意。

驗證：fallback 1/1、PI full 14/14、Extension 144/144、npm test 252/252；typecheck 的整體 `npm run check` 僅受既有 `pi-main` `syntax-highlight.ts`／highlight.js TS7016（21 筆）阻擋。
