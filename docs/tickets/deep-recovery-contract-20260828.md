---
title: Deep retryable recovery contract
type: ticket
scope: Forge Runtime v4 Deep Retrieval／Knowledge Understanding
updated: 2026-08-28
source: 使用者實際 PI 輸出、ADR-0016、ADR-0017、ADR-0018、docs/PLAN-A.md
status: implemented-verified-reviewed
---

# Ticket：deep-recovery-contract-20260828

## 結論

本輪已完成實作、驗證、初次 review fix 與最終雙軸 re-review，狀態為 `implemented-verified-reviewed`。策略唯一真相來源為 [`ADR-0018`](../adr/ADR-0018-deep-retryable-recovery-contract.md)，執行細節見 [`docs/PLAN-A.md`](../PLAN-A.md)。

## 需求與決策

- `manifest=[]` 且 `source=target`：回 retryable invalid，保留相同 identity，不進 `WAIT_USER`；要求模型自行改用 `wiki`／`code_base`，runtime 不自動選 source／target。
- duplicate `decisionId`：維持拒絕、不靜默去重；Evidence Package validator 只有錯誤包含 `決策 ID 重複` 時標 `retryable:true`，同一 `KNOWLEDGE_UNDERSTANDING` attempt 以相同 identity 重送修正後唯一 IDs。其他 validation failure 不因本 ticket 自動標 retryable。
- invalid／rejection 不推進 stage 或寫 `CONTEXT_BUILD`；保留 stale guard。production 預設只改 extension；只有 RED 證明 seam 不足才回報 blocker。

## 範圍

只列 `forge-runtime/extensions/forge-runtime.ts` 與 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。不改 `pi-main/`、`session-state.ts`、API/schema/UI/scheduler、snapshot，不自動 fallback，不接受 basename 模糊匹配，不建立 Plan B。

## 驗收

五個測試名稱與具體斷言以 Plan A 為準；最後必須在沒有 `WAIT_USER` loop 的情況下進入 `CONTEXT_BUILD`。真實 PI 原情境為人工驗收。

## 基線

Extension `124/124`，新增後 `129/129`；排除 `pi-grill-interactive.test.ts` 的本地 suite `209/209`，新增後 `214/214`。標準 `npm test` 為 `214 pass/1 fail`（唯一既存缺 qwen token-plan JSON）；`npm run check` exit 2、38 errors，包含 10 個既存 `InteractiveModeOptions.terminal` 與其餘 pi-main 既存依賴／型別問題。本 ticket 不新增新失敗，不宣稱 full/check 全綠。

## 實作與驗證結果

- Production 僅修改 `forge-runtime/extensions/forge-runtime.ts`：空 target manifest 在共用 target ambiguity branch 前回 `{status:invalid,retryable:true,reason:target_manifest_empty}`，要求模型改用 `wiki`／`code_base`；不呼叫 `handleDeepResult`，因此 identity／stage／budget 不變。Evidence Package validator 只有 rejection 錯誤包含 `決策 ID 重複` 時增加 `retryable:true`；其他 validation failure 維持原回應。既有 validator、stale guard、state advance 保留。
- Tests 僅修改 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`，新增五個 Plan A 精確測試：`Extension_DeepSearchEmptyTargetManifest_ReturnsRetryableInvalidWithoutWaitUser`、`Extension_DeepSearchAfterEmptyTargetManifest_UsesExplicitWikiOnSameAttempt`、`Extension_DeepCompleteDuplicateDecision_ReturnsRetryableInvalidWithoutStateAdvance`、`Extension_DeepCompleteCorrectedDecision_ReusesAttemptAndEntersContextBuild`、`Extension_DeepRecoverySequence_ReachesContextBuildWithoutWaitUserLoop`。
- 初次 review findings 均已修正並保留為歷史：Standards P1 durable state 不完整；P2 重複 setup，已抽為單一 `prepareDeepRetrieval` helper。Spec P1 budget coverage，已補至少 9 次 empty target 仍回 `target_manifest_empty`；P1 retryable 過寬，已縮到 duplicate error；P2 stale state；Plan A P2 基線標示，已將 209 pass/1 fail 明確標為實作前基線。
- Review-fix RED：`forge-runtime/.tmp/deep-recovery-review-red.log`。Final test refactor 後 extension 129/129：`forge-runtime/.tmp/deep-recovery-final-refactor-focused.log`；排除 `pi-grill-interactive` 的本地 suite 214/214：`forge-runtime/.tmp/deep-recovery-review-local.log`；標準 `npm test` 214 pass/1 fail、唯一 qwen 缺檔：`forge-runtime/.tmp/deep-recovery-review-npm-test.log`；final `npm run check` 38 個既存 baseline errors，沒有錯誤指向本 ticket 修改的 `forge-runtime.ts` 或 `forge-runtime-extension.test.ts`：`forge-runtime/.tmp/deep-recovery-final-check.log`。`pi-grill-interactive.test.ts` 不是本 ticket 修改檔；Node `DEP0190` 為非阻塞 warning。
- 最終雙軸 re-review：Standards P0/P1/P2=0；Spec P0/P1/P2=0。

## 邊界與未解

未改 `session-state.ts`、`pi-main`、API/schema/UI/scheduler/snapshot，未新增依賴、Plan B、自動 fallback 或模糊 matching。真實 PI 原情境人工驗收尚未完成；下一步由使用者決定完成驗收後是否提交。
