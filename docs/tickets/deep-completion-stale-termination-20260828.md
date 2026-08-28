---
title: Deep completion 過期結果終止
type: ticket
scope: Forge Runtime v4 Deep completion stale lifecycle
updated: 2026-08-28
source: 使用者執行紀錄、ADR-0016、ADR-0017、docs/PLAN-A.md
status: implemented-verified-reviewed
---

# Deep completion 過期結果終止

## 目標

補齊 `forge_deep_retrieval_complete` 與 `forge_deep_complete` 共六個 stale return 的 `terminate: true`，停止同批過期 completion 造成的循環。

## 契約

- 每個 active Deep attempt 最多接受一個 `needs_decision`。
- 接受後進 `WAIT_USER` 並清除當前 Deep attempt；同 identity 後續 completion stale、不改 state、`terminate=true`。
- 使用者回答保留 `sourceRoundId`／`phase`，建立新 attempt；新 attempt 可再次 `needs_decision`。

## 建置範圍

只修改 `forge-runtime/extensions/forge-runtime.ts` 的六個 completion stale return，以及 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 的既有與新增測試。不新增 helper、不修改 `session-state.ts`、`pi-main/`、Grill、`CONTEXT_BUILD`、UI、schema/API 或 scheduler；不做 Plan B。

## 測試與驗證

先由獨立測試子代理打 RED，再由主代理最小實作。擴充既有 Retrieval／Understanding stale 測試，斷言 status、terminate、state 與工具不變；新增 PascalCase 測試：

- `Extension_WhenRetrievalNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt`
- `Extension_WhenUnderstandingNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt`

每個新測試覆蓋第一次 decision→`WAIT_USER`→清 attempt、舊 identity stale+terminate、回答建立 fresh attempt、fresh attempt 再 decision 成功。基線 217，預期 219。Focused：`cd forge-runtime`；`npx tsx --test tests/extensions/forge-runtime-extension.test.ts`。完整：`cd forge-runtime`；`npm test`；`npm run check`。

真實 PI smoke：第一個 decision 後不再連續 stale；回答後下一個 decision 仍正常。命令：`.\pi-main\pi-test.bat --approve`。脆弱假設是同批混有非 terminate 工具結果時 PI 的 `every(terminate)` 仍可能繼續；本 ticket 不修改 scheduler。Rollback 只撤回本 ticket code／test／docs，無 migration。

## 實作與驗證完成（2026-08-28）

- Plan A 已核准。兩個 public fresh-attempt regression 先紅（`terminate` 未定義）後綠；六個 stale return 均回傳 `terminate: true`。
- 四個 inner branch 因同步防禦路徑沒有公開 deterministic seam，不新增私有 mock／test hook；以 public regression 與 production inventory 驗證。
- focused 124/124、full 219/219、`npm run check` pass。證據：`forge-runtime/.tmp/deep-completion-stale-termination-focused-20260828.log`、`forge-runtime/.tmp/deep-completion-stale-termination-full-20260828.log`、`forge-runtime/.tmp/deep-completion-stale-termination-check-20260828.log`。
- 未改 `session-state.ts`、scheduler、UI、schema/API、`pi-main/`；mixed tool batch 的 `every(terminate)` 風險仍不在 scope。獨立 review 已完成，可交付／提交。

- Review correction：正式測試名稱為 `Extension_WhenRetrievalNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt` 與 `Extension_WhenUnderstandingNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt`；兩者完整覆蓋 needs_decision→WAIT_USER/clear→舊 identity stale+terminate/state-tools 不變→回答後 fresh attempt identity preserved→再次 needs_decision。既有三個 stale tests 補上 `terminate` assertion。
- 最終驗證：focused 124/124、full 219/219、check pass；logs：`forge-runtime/.tmp/final-focused-test.log`、`forge-runtime/.tmp/final-full-test.log`、`forge-runtime/.tmp/final-check.log`。PI smoke `.\pi-main\pi-test.bat --approve` 成功啟動，真實模型回 `smoke ok`、exit 0；log：`forge-runtime/.tmp/pi-smoke.log`。
