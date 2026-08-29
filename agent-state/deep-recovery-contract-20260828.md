---
title: deep-recovery-contract-20260828 agent state
type: agent-state
scope: Deep retryable recovery contract
updated: 2026-08-28
source: docs/adr/ADR-0018-deep-retryable-recovery-contract.md、docs/PLAN-A.md、docs/tickets/deep-recovery-contract-20260828.md
status: implemented-verified-reviewed
---

# deep-recovery-contract-20260828

## 已完成項目

- 已完成 recovery 策略、ADR-0018、Plan A、ticket、handoff、CONTEXT 與 Memory 同步。
- 使用者已確認「照建議」：空 target manifest 走 retryable invalid；duplicate decision 維持拒絕並同 attempt 修正重送。
- 已完成五個 Plan A 測試：`Extension_DeepSearchEmptyTargetManifest_ReturnsRetryableInvalidWithoutWaitUser`、`Extension_DeepSearchAfterEmptyTargetManifest_UsesExplicitWikiOnSameAttempt`、`Extension_DeepCompleteDuplicateDecision_ReturnsRetryableInvalidWithoutStateAdvance`、`Extension_DeepCompleteCorrectedDecision_ReusesAttemptAndEntersContextBuild`、`Extension_DeepRecoverySequence_ReachesContextBuildWithoutWaitUserLoop`。
- 已完成兩個 production 修正：空 target manifest 回 retryable invalid 且不消耗 identity／stage／budget；Evidence Package validator 只有錯誤包含 `決策 ID 重複` 時回 `retryable:true`，其他 validation failure 不因本 ticket 自動標 retryable。
- 已完成初次 review fix：Standards P1 durable state 補齊；P2 重複 setup 抽為單一 `prepareDeepRetrieval` helper；Spec P1 補至少 9 次 empty target 仍回 `target_manifest_empty` 的 budget assertion；P1 將過寬 retryable 縮到 duplicate error；P2 修正 stale state。
- 已完成 Plan A P2 文件修正：將 209 pass/1 fail 明確標為實作前基線，與收尾 214 pass/1 fail 分離。
- 已完成 final test refactor 與雙軸 re-review；Standards P0/P1/P2=0，Spec P0/P1/P2=0。

## 重要決策

- 保留 `attemptId + sourceRoundId + phase`；invalid/rejection 不進 `WAIT_USER`、不推進 stage、不寫 `CONTEXT_BUILD`。
- 不自動 fallback、不模糊匹配、不改 `session-state.ts`，除非 RED 證明 extension seam 不足。
- 空 target manifest 為 retryable input error；Evidence Package 只有包含 `決策 ID 重複` 的 validator rejection 可用同一 identity 修正重送。其他 validator rejection 維持原契約。
- 初次 review findings 均已修正並保留為歷史；最終狀態為 `implemented-verified-reviewed`。

## 修改檔案

本 working tree 與 ticket 相關共 10 檔：

- `CONTEXT.md`
- `Memory/record.md`
- `Memory/lesson_learn.md`
- `agent-state/deep-recovery-contract-20260828.md`
- `docs/PLAN-A.md`
- `docs/adr/ADR-0018-deep-retryable-recovery-contract.md`
- `docs/handoff.md`
- `docs/tickets/deep-recovery-contract-20260828.md`
- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`

## 測試結果

Final test refactor 後 extension 129/129（`forge-runtime/.tmp/deep-recovery-final-refactor-focused.log`）；排除 `pi-grill-interactive` 的本地 suite 214/214（`forge-runtime/.tmp/deep-recovery-review-local.log`）。標準 `npm test` 為 214 pass/1 fail，唯一失敗是既存 qwen token-plan JSON 缺失（`forge-runtime/.tmp/deep-recovery-review-npm-test.log`）。Final `npm run check` 為 38 個既存 baseline errors，沒有錯誤指向本 ticket 修改的 `forge-runtime.ts` 或 `forge-runtime-extension.test.ts`（`forge-runtime/.tmp/deep-recovery-final-check.log`）。Node `DEP0190` 為非阻塞 warning。`pi-grill-interactive.test.ts` 不是本 ticket 修改檔。

## 未解問題

- 真實 PI 原情境尚未人工驗收。

## 下一步

- 完成真實 PI 原情境人工驗收。
- 由使用者決定是否提交目前變更。
