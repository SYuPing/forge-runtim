# ADR-0005 Grill Terminal Result Lifecycle

狀態：Accepted

> 2026-08-13 補充：本 ADR 對 tool-call iteration 的辨識仍有效；completion omission 的 recovery lifecycle 已由 ADR-0008 supersede。streaming `message_end` 不得觸發 steer／follow-up replay。
>
> 2026-08-17 補充：PI 的 `message_end` replacement 會原地改寫 agent message。Forge 不得用 user `message_end` replacement 清理尚未被 provider 消費的 Grill invocation；顯示整理不能改變 provider-facing prompt。此補充不改 assistant terminal result 與 recovery lifecycle。

PI 會為每個 assistant response（含 `toolCall` iteration）發送 `message_end`。Forge 應只把不含 `toolCall` 的 assistant message 視為可解析的終局 Grill result；含工具呼叫的訊息必須保留 `pendingGrillRun`，避免提前跳出 `GRILL`。這維持 Workflow 對 `WAIT_USER` 與 Deep Knowledge transition 的控制權，且不需修改 `pi-main/`。

## Considered Options

- 解析第一個 assistant `message_end`：拒絕，工具呼叫會使最終 structured result 被忽略。
- 只解析無 `toolCall` 的終局 assistant message：推薦，沿用 PI 現有訊息模型，改動最小。
- 聚合到 `agent_end` 才解析：本輪不採用，需額外保存訊息與 lifecycle state，超出修復範圍。

## Consequences

- 歷史 terminal-JSON debug 路徑若結果不是有效 JSON，發出明確 `GRILL_RESULT_PARSE_ERROR`；正常 Grill completion 走 `forge_grill_complete`。completion omission 不自動 retry，依 ADR-0008 進 `GRILL + RECOVERY_REQUIRED`。
- `NEEDS_CONFIRMATION` 與 `READY_FOR_DEEP` 的既有 routing contract 維持不變。

## Implementation Evidence

- `forge-runtime/extensions/forge-runtime.ts` 已在 `message_end` 中先辨識 `content.type === "toolCall"`；該 iteration 不消耗 `pendingGrillRun`。
- 三條 tool-call → terminal-result 回歸測試已覆蓋 `WAIT_USER`、`READY_FOR_DEEP` 與無效終局 JSON。
- 子代理驗證：`npm test` 55/55 通過，`npm run check` 通過。
