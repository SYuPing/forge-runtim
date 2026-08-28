---
title: Deep completion 過期結果終止狀態
type: agent-state
scope: deep-completion-stale-termination-20260828
updated: 2026-08-28
source: docs/tickets/deep-completion-stale-termination-20260828.md、docs/PLAN-A.md
status: implemented-verified-reviewed
---

# Deep completion 過期結果終止狀態

## 已完成

- 已完成 direct Plan A 規劃與文件真相勘誤。
- 已確認本 ticket 只處理 completion stale termination；`CONTEXT_BUILD` 延後。
- 使用者已核准 Plan A，開始進入 TDD RED 階段。

## Milestone 1：Retrieval fresh-attempt RED

- TDD seam：extension completion tool 公開 `ToolResult`。
- 已新增 Retrieval fresh-attempt regression：`Extension_WhenRetrievalNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt`。
- RED 命令：`npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/**/*.test.ts --test-name-pattern=Integration_WhenOlderRetrievalCompletionArrivesAfterFreshAttempt_ShouldReturnStaleTermination`（於 `forge-runtime/` 執行）。
- 結果：exit 1；測試失敗，`terminate expected true actual undefined`。
- 證據：`forge-runtime/.tmp/deep-completion-stale-termination-red-20260828.log`；測試位置 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts:5619`。

## 重要決策

- 同一 active attempt 只接受一個 `needs_decision`；後續同 identity completion stale 且 `terminate=true`。
- 使用者回答建立 fresh attempt，保留 `sourceRoundId`／`phase`。
- 只改一個 production 檔與一個測試檔；不改 scheduler 或 state machine。

## 修改檔案

本輪修改 production 與測試檔；交付文件同步更新。未修改 `session-state.ts`、scheduler、UI、schema/API、`pi-main/`。

## 測試結果

- RED focused run：218 tests，217 pass、1 fail；失敗為上述 Retrieval fresh-attempt regression。
- GREEN focused：124/124；full：219/219；`npm run check` pass。

## 未解問題

- 同批混有非 terminate 結果時 scheduler 可能仍繼續，本 ticket 不處理。

## 下一步

本輪修改 production 與測試檔；交付文件同步更新。未修改 `session-state.ts`、scheduler、UI、schema/API、`pi-main/`。

## Milestone 2：Production GREEN 與完整驗證

- 六個 completion stale return（Retrieval／Understanding 各入口、dispatch 後、state commit 後）均回傳 `terminate: true`。
- 兩個 public fresh-attempt regression 先紅 `terminate undefined` 後綠；四個 inner branch 因同步防禦路徑無公開 deterministic seam，不新增私有 mock／test hook。
- focused 124/124、full 219/219、`npm run check` pass。證據：`forge-runtime/.tmp/final-focused-test.log`、`forge-runtime/.tmp/final-full-test.log`、`forge-runtime/.tmp/final-check.log`。PI smoke 成功啟動，真實模型回 `smoke ok`、exit 0；log：`forge-runtime/.tmp/pi-smoke.log`。

## 未解問題

- 同批混有非 terminate 結果時 scheduler 可能仍繼續，本 ticket 不處理。

## 下一步

本 ticket review 已完成，無後續實作。

## Review correction

- Understanding fresh-attempt regression：`Extension_WhenUnderstandingNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt`。
- 兩個 public regression 完整覆蓋 `needs_decision → WAIT_USER/clear → 舊 identity stale+terminate/state-tools 不變 → 回答後 fresh attempt identity preserved → 再次 needs_decision`；既有三個 stale tests 補上 `terminate` assertion。
