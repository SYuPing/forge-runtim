---
title: Deep followUp identity 啟用時序修正
type: ticket
scope: forge-runtime Deep Retrieval handoff
updated: 2026-08-26
source: docs/handoff.md、CONTEXT.md、ADR-0015、docs/PLAN-A.md
status: implemented-and-verified
---

# deep-followup-identity-activation-20260826

## 目標

修正 Grill completion 後 Deep tools 早於 identity-bearing followUp 到達而造成的 stale 呼叫；在 identity 正式進入 `input` 前，Deep tools 必須保持不可用。

## 根因

`forge_grill_complete` 建立新 Deep attempt 後立即啟用 Deep tools，但 followUp 要等目前 assistant turn 結束才進入 `input`。空窗期間模型使用舊 identity 呼叫，先被 stale guard 拒絕；followUp 到達後重複執行才成功。

## 核准決策

- 移除／延後當下的 `activateDeepRetrievalTools()`。
- 在既有 `pi.on("input", ...)` exact pending replay invocation 條件內，先清除 `pendingReplayInvocation`，再啟用 Deep Retrieval tools，之後沿用 `{ action: "continue" }`。
- 保留 identity 三元組、stale quiet reject、followUp transport、主 session 與既有 verifier；不改 `pi-main/`。
- 不採 completion result 注入 identity，不新增 custom loop、sequential 設定、新狀態機、UI 或 Plan B。

## 檔案與測試

- Production：`forge-runtime/extensions/forge-runtime.ts`
- Tests：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `Extension_WhenGrillCompletionQueuesDeepIdentity_ShouldEnableDeepToolsOnlyAfterFollowUpStarts`
- `Extension_WhenDeepHandoffIsPending_ShouldKeepDeepToolsUnavailableAndIgnoreStaleEvent`

## 測試結果

新增 2 個 timing regression；targeted 117/117、`npm test` exit 0（211/211）、`npm run check` exit 0。final review medium finding 已修正：`requireDeepToolBoundary` 必須同時具備 tool boundary 與 `sendUserMessage`，避免 identity-bearing followUp 無法送出時半完成。本輪未發現新 bug。

## 未解問題

Grill `message_end` 含 toolCall 的文字清除 sibling risk 不在本 ticket，且本輪未由驗證證實；目前亦未處理更廣泛的 runtime flow 串接。使用者尚未在真實 PI session 重跑原始情境，屬既有非 blocker。

## 下一步

已完成 production 修正與 2 個 timing regression；本 ticket 收尾，不新增 Plan B 或其他範圍。
