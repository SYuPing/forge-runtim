---
title: ADR-0019：Deep mixed-tool batch termination barrier
type: adr
scope: Forge Runtime v4 Deep Retrieval／PI tool-batch transport contract
updated: 2026-08-29
source: FORGE_RUNTIME_Arch_v4.md、pi-main/packages/agent/src/agent-loop.ts、forge-runtime/extensions/forge-runtime.ts、forge-runtime/src/runtime/session-state.ts、docs/adr/ADR-0018-deep-retryable-recovery-contract.md、docs/tickets/deep-mixed-tool-batch-termination-20260829.md
status: implemented/verified-with-existing-workspace-caveats
---

# ADR-0019：Deep mixed-tool batch termination barrier

日期：2026-08-29

## 狀態

已完成實作與本 ticket 驗證；workspace 仍有既有 TUI／pi-main check 失敗，故狀態為 `implemented/verified-with-existing-workspace-caveats`。未修改 `pi-main`。

## Context

PI assistant `message_end` 在工具執行前且 awaited；同一 assistant message 的 tool calls 可能形成 mixed search+completion batch。PI 以批次結果的 `every(terminate)` 決定是否終止，故 search 的 `terminate=false` 與 completion 的 `terminate=true` 混合時不會停止。既有 Forge guard 沒有以 call ID 建立 batch barrier，因此可能留下 parallel evidence race、錯誤 stage route 或重複 follow-up。

可核對證據：`pi-main/packages/agent/src/agent-loop.ts:344-356`、`:487-551`、`:572-582`；Forge 路徑在 `forge-runtime/extensions/forge-runtime.ts` 的 Deep tool gate／search／completion handlers 與 `forge-runtime/src/runtime/session-state.ts` 的 stage／identity transition。

## Decision

1. 在 awaited assistant `message_end` 讀取完整 tool-call IDs，建立 extension-local ephemeral `DeepRetrievalBatch`：`searchCallIds`、`completionCallIds`、`settledSearchCallIds`、`mixed`、`followUpQueued`。這是 transport batch state，不進 `ForgeSessionState`、snapshot 或 public API。
2. `mixed=true` 時，completion 依 call ID deterministic retryable reject，回 `terminate=true`，保留同一 identity，不做 stage transition；與工具實際執行先後無關。
3. current-identity search 的所有成功／失敗結果都回 `terminate=true`。tool-result `message_end` 以 call ID 計數；所有 search settle 後只 queue 一個帶同一 identity 的 follow-up。
4. 下一個 completion-only batch 才可接受並正常 stage transition。route/stale 後不得 queue duplicate follow-up。
5. prompt guidance 明確規定：需要人類選擇使用 `needs_decision`；缺來源／證據使用 `needs_discovery`。`kind` 是唯一正式 route；runtime 不解析 `decisionSummary` 自由文字。語意分類的 deterministic semantic gate／public discriminant 是獨立風險與未授權範圍。

## Boundaries and rejected alternatives

Forge-only；不得修改 `pi-main`、`@earendil-works/pi-telemetry`、PI scheduler 的 `every(terminate)`、`session-state.ts`、public tool schema/API，且不新增依賴。Production 最小檔案為 `forge-runtime/extensions/forge-runtime.ts`；tests 為 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 與 `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。不建立 Plan B，因無 UI／視覺變更。

拒絕只把 `deep_search` 加 `terminate`（無 follow-up 且不防 parallel evidence race）；拒絕修改 PI `every` 為 `some`（全域副作用、越界）；拒絕只改 prompt（無硬性 transport 保證）。

## Verification contract

先由獨立測試角色新增並執行 6 個 RED regression，再由 implementation 角色做最小 production change；測試、實作、驗證、final review 不得由同一角色兼任。測試涵蓋 mixed reject/no transition、multi-search all terminate + exactly one followUp、completion-only replay once、stale/route no duplicate、prompt distinction，以及真實 AgentSession + faux provider parallel mixed batch。期望既有 219 加 6 為 225 pass／0 failed；baseline 若變，先記錄新 baseline。

PI 原生完整測試不是 gate；Forge contract tests 與真實 AgentSession/faux-provider integration 是自動 gate；原始真實 PI session 是發布前人工 gate。Fragile assumption：PI 維持 awaited `message_end` before tools 與 tool-call IDs；若改變，AgentSession integration test 必須失敗。

## Rollback

移除 extension barrier／prompt changes 與對應 tests；不涉及資料 migration、snapshot 回填或外部狀態。

## 2026-08-29 後續決策：移除自動 Deep 階段面板發布

本決策取代本 ADR／既有交接中「自動進入 Deep 使用 `deliverAs: "displayOnly"` 顯示階段面板」的未完成方案。原因是目前不修改 `pi-main` 的前提下，PI 不保證辨識此 delivery 值；未知值可能落入會觸發模型回合的路徑，干擾 Deep identity followUp 與工具時序。

使用者已核准的最小範圍是：刪除 `continueDeepKnowledge` 自動進入 Deep 前那一行 `await publishState(..., { deliverAs: "displayOnly" })`。這只移除非必要的 UI side effect，不改 state transition、active tools、pending fail-closed gate、session state、工具契約或 scheduler；`WAIT_USER`、recovery、confirmation panel 與其他既有 UI 保留。

上述「準備 RED」與「尚未修改」是歷史決策快照；實作時已先完成自動 Deep 階段面板 RED→GREEN 回歸，再移除多餘的 `sendMessage`／`publishState(...displayOnly...)` side effect，同時保留 `ctx.ui.setStatus(buildWorkflowStatusText(nextState))`。`WAIT_USER`、recovery、confirmation panel、pending fail-closed gate、state transition 與 Deep follow-up 均保留。

## 實作與驗證結果（2026-08-29）

- 五個 extension contracts 與一個 AgentSession/faux-provider parallel mixed batch integration 均完成；mixed batch barrier 依 call ID 結算，未修改 PI scheduler 或 `pi-main`。
- RED→GREEN 後刪除自動 Deep 階段面板的 `sendMessage`／`publishState(...displayOnly...)` 呼叫；只保留 `ctx.ui.setStatus(buildWorkflowStatusText(nextState))`，因此自動流程仍更新 status，但不再送出多餘的模型訊息。
- 驗證：auto-panel unit 1/1、AgentSession after-status 1/1、三個受影響 tests 3/3、extension isolated `tsconfig.json` 67/67。較早 pi-config 134/134 為 status 修正前結果，不列為最終證據；最後 pi-config log 只有逐項 ✔、沒有 summary。
- `npm run check` exit 2：production 0 錯誤、本 ticket test 1199 後 0 錯；既有 TUI terminal 10 錯與 pi-main highlight.js 21 錯。完整 pi-grill 受既有 TUI 兩個失敗阻斷，但本 ticket targeted pass。這些是 workspace 驗證 caveat，不是本 ticket production error。

## 2026-08-29 純搜尋批次接續修正收尾

使用者實測中，pure `forge_deep_search` 批次正常回傳並以 `terminate=true` 結束目前回合，但 coordinator 因 `!batch.mixed` guard 提前返回，沒有排入 same-identity follow-up，造成 Deep Retrieval 看起來在 search 後中斷。`/forge-runtime continue` 只更換 `attemptId`、沿用 `sourceRoundId`；前兩次 3 + 5 次累計用完同一 source round 的 8 次上限，是後續現象，不是原始根因。

正式修正只移除 `forge-runtime/extensions/forge-runtime.ts:1284` 的 pure-batch guard。保留 `terminate=true`、全部 settle barrier、`followUpQueued`、identity／active checks、mixed reject、completion-only、quota 與 `pi-main` 不變。public-seam 回歸位於 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts:1585,1836-1948`，覆蓋兩筆 pure search 全部 settle 後 exactly once follow-up，以及 rejected／failed 也算 settled 並完成後 exactly once。

驗證：PI TUI 回歸由 RED（`pi-grill-interactive.test.ts:681`，actual 3、expected 0）轉為 GREEN 1/1，完整 PI 互動 11/11；新增兩個 extension 回歸 2/2。extension 完整 assertions 68 pass／0 fail，但 summary 後背景程序未退出，180 秒後中止。`npm run check` 與第二段 tsc 僅有既有 `pi-main` `highlight.js` 21 個型別 baseline；bounded `npm test` 未觀察失敗，但 180 秒卡在既有 `Integration_WhenGrillHumanDecisionIsAnswered_ShouldInjectImmutableDecisionIntoEvidencePackage`。兩份獨立 review 無阻擋 finding。剩餘低風險為 synthetic failed result 與真實 awaited `message_end`／tool-call ID 假設。
