# ADR-0008：Grill Completion Recovery 與真實互動驗收

日期：2026-08-13

## 狀態

Accepted

本 ADR supersede ADR-0007 中「completion omission 以 `/forge-runtime continue` 重播」的現行規範。ADR-0007 其餘 completion tool、round、evidence 與 tool boundary 決策維持有效。

## Implementation status（2026-08-14）

- Plan A #1–#17 已完成；final review 的 Standards 1 個 P1 與 Spec 2 個驗收缺口均已修正，當前 0 open findings。
- production evidence：`forge-runtime/src/runtime/session-state.ts` 已有 private per-attempt omission budget、`recordCompletionOmission()` 與 `retryGrillRound()`；`forge-runtime/extensions/forge-runtime.ts` 已將 omission 經 session seam，完成 settle／restore tools、recovery 下拒絕 `continue`，並由明確 retry 送出一次 followUp。
- test evidence：#1–#7 各自精準單測均 1 pass、exit 0；#7 測試名稱為 `Extension_WhenCompletionNeedsConfirmation_ShouldDisplayQuestionAndEnterWaitUser`。ADR-0007 stale 測試已刪除。
- 非 active Grill attempt 的兩工具已由 `pendingGrillRun && stage===GRILL` 共同 gate 與 execute guard fail-closed；正常 TUI 不含 `continue`，omission 靜置且僅 `/forge-runtime retry` 建立下一 attempt。
- 證據：P1 1/1、TUI 4/4、`npm run check`、`npm test` 114/114 均 exit 0；upstream seam Vitest 4/4，upstream check 僅剩既有 `packages/ai` 測試型別錯誤。

## Context

- Grill 已以 `forge_grill_complete` 作為唯一正常 completion 控制通道，但 assistant turn 仍可能在未呼叫 completion tool 時結束。
- 舊規範只保留 round 並提示 `continue`；它沒有明確記錄 omission、沒有把單次嘗試封口，也容易讓 streaming `message_end` 中的 follow-up 形成 steer／replay 迴圈。
- 正常 `NEEDS_CONFIRMATION` 與 `READY_FOR_DEEP` 轉移也必須與 omission recovery 分離：前者是有效 completion，後者是缺少 completion 的故障狀態。
- 空 discovery manifest 若仍要求首輪 evidence，會建立模型永遠無法完成的 Grill；relevance gate 失敗若只顯示錯誤，也沒有可供使用者解除阻塞的 decision path。

## Decision

1. 每個 Grill round 的每次執行都是一個有界 attempt。該 attempt 首次在 assistant 終局漏呼叫 `forge_grill_complete` 時，runtime 必須記錄一次 `Completion Omission`，並標記該 attempt 已進 recovery；相同 attempt 的重複終局事件不得再次進 recovery。
   - 使用者於 2026-08-13 確認：`ForgeSessionState` 以私有 attempt 狀態維護 omission budget；公開 `recordCompletionOmission(): boolean` 僅首次記錄並進 recovery 時回傳 `true`，重複事件回傳 `false` 且 no-op。
   - 公開 `retryGrillRound(): GrillRound | undefined` 只在 recovery 中可用，保留 roundId、request 與 immutable snapshot，並重置 omission budget。`GrillRound` 不公開 attemptId 或 omission marker；retry 後新 attempt 的首次 omission 可再次回傳 `true`。
   - 這是刻意的小 interface／deep module 邊界，避免測試耦合私有 attempt 狀態。
2. omission 後立即停止該 attempt，維持 top-level stage `GRILL`，並設定 `RECOVERY_REQUIRED` substate／marker。`RECOVERY_REQUIRED` 不是新的 top-level workflow stage。
3. streaming `message_end` 不得呼叫任何會造成 steer 的 `sendMessage`／follow-up replay。runtime 只送出可見 recovery panel，然後讓 session settled；不得背景重試、不得自動 replay、不得自動進 Deep Knowledge。
4. recovery panel 必須提供三條明確且可操作的路徑：`/forge-runtime retry`、`/forge-runtime cancel`、`/forge-runtime switch <request>`。只有使用者明確執行 `retry`，才以同一 round 與同一 immutable snapshot 建立新的 attempt；每個新 attempt 仍只能因 omission 進 recovery 一次。
5. `/forge-runtime continue` 保留 ADR-0003 的一般 active-workflow 控制語義，但不再承擔 completion omission recovery；處於 `RECOVERY_REQUIRED` 時不得把 `continue` 解讀為 retry。
6. 有效 `NEEDS_CONFIRMATION` completion 必須立即顯示唯一問題並進入 `WAIT_USER`。使用者以選項或自由文字作答後，runtime 自動建立下一個 Grill round；不要求 `/forge-runtime continue`。
7. 有效 `READY_FOR_DEEP` completion 通過 runtime gate 後必須立即自動進入 Deep Knowledge；不要求 `/forge-runtime continue`，也不得先顯示 recovery action。
8. 所有可見 panel message 固定使用 `{ content: panelText, display: true }`；不得只把文字塞進不可見 details 或 tool-only 結果。
9. Grill prompt 移除「只輸出一個問題」的 assistant-output 指令。新的規範是：若需要確認，模型必須呼叫 `forge_grill_complete`，且 payload 的 `questions` 恰好一題；模型不得輸出 assistant prose。`READY_FOR_DEEP` 仍為零題。
10. 首輪 evidence 要求只在 immutable manifest 非空時成立。空 manifest 必須形成仍可完成的 Grill：允許以零 evidence 提交唯一來源／scope 確認問題，不得建立不可滿足的 evidence contract。
11. candidate relevance gate 失敗時，runtime 必須顯示一個可見、可回答的來源／scope 問題並進 `WAIT_USER`；不得只停留在 `GRILL` 顯示 `CANDIDATE_RELEVANCE_INSUFFICIENT`。
12. 驗收不只依賴 fake extension harness。必須在真實 PI TUI 證明：問題可見、回答後啟動下一 Grill round、`READY_FOR_DEEP` 自動推進、每個 attempt 的 completion omission 最多進 recovery 一次且 session settled。使用者明確 retry 可建立新 attempt，但每個 attempt 仍有界；單次使用者輸入不得產生無上限 assistant turns。
13. 為完成 #12 的真 PI TUI release gate，Plan A #14 採使用者核准的最小 test-only seam：`InteractiveModeOptions` 新增 optional `terminal?: Terminal`；constructor 將 `options.terminal` 轉交既有 `createInteractiveTui`，省略時仍由 factory 建立 `ProcessTerminal`。不得注入 TUI factory、不得新增依賴、不得改 runtime workflow 語意或 pi-main 其他功能。

## Decision Table

| 情境 | runtime 行為 | 使用者動作 |
| --- | --- | --- |
| `NEEDS_CONFIRMATION` | 顯示恰好一題，進 `WAIT_USER` | 直接作答，runtime 自動開下一 round |
| `READY_FOR_DEEP` | 通過 gate 後立即進 Deep Knowledge | 無需 `continue` |
| attempt 首次 completion omission | 記錄 omission，進 `GRILL + RECOVERY_REQUIRED`，顯示 recovery panel 並 settled | `retry`、`cancel` 或 `switch` |
| 同 attempt 重複終局事件 | no-op，不再進 recovery | 無 |
| 明確 `/forge-runtime retry` | 同 round／snapshot 建立新 attempt | 等待新 attempt 結果 |
| `RECOVERY_REQUIRED` 下的 `continue` | 不重播 omission attempt | 改用 `retry`、`cancel` 或 `switch` |
| 空 manifest | 允許零 evidence 的單一來源／scope 問題 | 補來源或收斂 scope |
| relevance gate 失敗 | 顯示可回答問題並進 `WAIT_USER` | 補來源或收斂／切換 scope |

## Consequences

- 每個 Grill attempt 都有明確 terminal boundary，不會因 completion omission 自動形成 assistant-turn 迴圈。
- 正常 completion 與 recovery 分離；`continue` 不再同時代表一般續接與 omission retry。
- `RECOVERY_REQUIRED` 只增加 Grill 內部 marker，不擴張 top-level state machine。
- 空 manifest 與 relevance failure 都能回到人類決策邊界，不會留下只有錯誤、沒有出口的 GRILL。
- 真實 PI TUI 驗收成為 release gate；unit／fake harness 綠燈不足以單獨宣告完成。

## Not Building

- 不新增自動 retry、background steer、retry backoff 或無上限 replay。
- 不新增第三種 `forge_grill_complete` status。
- 不新增 top-level `RECOVERY_REQUIRED` stage。
- 不修改 `pi-main/` 的 runtime workflow、其他功能或依賴；僅依核准的 Plan A #14 增加 test-only terminal seam，不新增 queue 或 parallel workflow。
- 不把本修復拆成另一份必須核准的 UI Plan B。

## Fragile Assumption

- 真實 PI TUI 驗收環境必須能提供可控的 completion／omission 回應。核准的 seam 僅允許注入 `Terminal`，仍須走既有 `createInteractiveTui`、真 PI TUI 與 Forge extension lifecycle；不得改注入 TUI factory、不得以 fake extension harness 取代驗收。
