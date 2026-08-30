---
title: Deep mixed-tool batch termination barrier
type: ticket
scope: Forge Runtime v4 Deep Retrieval／PI tool-batch transport contract
updated: 2026-08-29
source: 使用者實際 PI 輸出、pi-main/packages/agent/src/agent-loop.ts、ADR-0018、ADR-0019、docs/PLAN-A.md
status: implemented/verified-with-existing-workspace-caveats
---

# Ticket：deep-mixed-tool-batch-termination-20260829

## Goal

修補同一 assistant tool batch 同時含 Deep search 與 completion 時，`every(terminate)` 造成流程繼續、completion race、錯誤 route 或重複 follow-up 的問題；不修改 PI 原始碼或 telemetry。

## Scope

- 在 Forge extension 建立 call-ID 對應的 ephemeral DeepRetrievalBatch barrier。
- mixed batch completion deterministic retryable reject、`terminate=true`、保留 identity、不轉 stage。
- 所有 current-identity search 結果 `terminate=true`；全部 search settle 後只 queue 一個同 identity follow-up；下一個 completion-only batch 才接受。
- 補 prompt guidance：`needs_decision` 對應人類選擇，`needs_discovery` 對應來源／證據不足。

## Non-scope

不改 `pi-main`、`@earendil-works/pi-telemetry`、PI scheduler、`session-state.ts`、public schema/API、snapshot 或依賴；不做 semantic gate、public discriminant、Plan B 或 UI 變更。

## Acceptance

以 [`ADR-0019`](../adr/ADR-0019-deep-mixed-tool-batch-termination-barrier.md) 為唯一契約來源，6 個 PascalCase 測試必須覆蓋 mixed batch reject/no transition、multi-search all terminate + exactly one followUp、completion-only replay accepts once、stale/route-changed no duplicate followUp、prompt distinction、真實 AgentSession + faux provider parallel mixed batch end-to-end。預期 baseline 219 + 6 = 225 pass／0 failed；baseline 改變時先記錄再維持新增 6。

## Evidence

目前根因證據為 `pi-main/packages/agent/src/agent-loop.ts:344-356`、`:487-551`、`:572-582`，以及 `forge-runtime/extensions/forge-runtime.ts`／`src/runtime/session-state.ts` 的既有 Deep handler、identity、stage guard 路徑。PI 原生完整測試的 telemetry 缺失不是本 bug 的修復 gate。

## Dependencies

none

## Rollback

移除 `forge-runtime/extensions/forge-runtime.ts` 的 barrier／prompt 變更與兩個指定測試變更；不涉及資料 migration。

## Session status

上述是實作前歷史交接。Ticket 現已完成實作與驗證，狀態為 `implemented/verified-with-existing-workspace-caveats`。五個 extension contracts 與一個 AgentSession/faux-provider parallel mixed batch integration 已通過；自動 Deep 階段面板先 RED→GREEN 後移除多餘 `sendMessage`／`publishState(...displayOnly...)`，保留 `ctx.ui.setStatus(buildWorkflowStatusText(nextState))`。`WAIT_USER`、recovery 與 pending fail-closed gate 保留，`pi-main` 無 tracked 改動。

驗證：auto-panel unit 1/1、AgentSession after-status 1/1、三個受影響 tests 3/3、extension isolated `tsconfig.json` 67/67。較早 pi-config 134/134 是 status 修正前結果，不作最終證據；最後 pi-config log 只有逐項 ✔、沒有 summary。`npm run check` exit 2：production 0 錯誤、本 ticket test 1199 後 0 錯；既有 TUI terminal 10 錯與 pi-main highlight.js 21 錯。完整 pi-grill 受既有 TUI 兩個失敗阻斷，但本 ticket targeted pass。

## 純搜尋批次接續修正最終結果（2026-08-29）

根因是 coordinator 在 `forge-runtime/extensions/forge-runtime.ts:1284` 的 `!batch.mixed` guard 提前返回，沒有排入 same-identity follow-up。`continue` 沿用 `sourceRoundId`，前兩次 3 + 5 次累計達 8 次上限；quota 沒有被重設，這是正確的有界行為，不是搜尋失敗原因。

正式修正只移除該 pure-batch guard；保留 `terminate=true`、全部 settle barrier、`followUpQueued`、identity／active checks、mixed reject、completion-only、quota 與 `pi-main` 不變。新增 public-seam 測試約 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts:1585,1836-1948`，固定兩筆 pure search 全 settle 後 exactly once，並固定 rejected／failed 結果也算 settled，完成後 exactly once。

RED：`forge-runtime/tests/extensions/pi-grill-interactive.test.ts:681` actual pending responses 3、expected 0。GREEN：同測 1/1，完整 PI 互動 11/11，新增兩測 2/2。extension 完整 assertions 68 pass／0 fail，但 summary 後背景程序不退出，180 秒中止；`npm run check` 與第二段 tsc 僅剩 21 個既有 `pi-main` `highlight.js` baseline 型別錯誤；bounded `npm test` 未觀察失敗，但 180 秒卡在既有 human-decision integration。兩份獨立 review 無阻擋 finding。低風險未解項為 synthetic failed result，以及真實 awaited `message_end`／tool-call ID 假設。
