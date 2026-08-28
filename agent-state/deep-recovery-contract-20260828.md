---
title: deep-recovery-contract-20260828 agent state
type: agent-state
scope: Deep retryable recovery contract
updated: 2026-08-28
source: docs/adr/ADR-0018-deep-retryable-recovery-contract.md、docs/PLAN-A.md、docs/tickets/deep-recovery-contract-20260828.md
status: design-approved-implementation-pending
---

# deep-recovery-contract-20260828

## 已完成項目

- 已完成 recovery 策略、ADR-0018、Plan A、ticket、handoff、CONTEXT 與 Memory 同步。
- 使用者已確認「照建議」：空 target manifest 走 retryable invalid；duplicate decision 維持拒絕並同 attempt 修正重送。

## 重要決策

- 保留 `attemptId + sourceRoundId + phase`；invalid/rejection 不進 `WAIT_USER`、不推進 stage、不寫 `CONTEXT_BUILD`。
- 不自動 fallback、不模糊匹配、不改 `session-state.ts`，除非 RED 證明 extension seam 不足。

## 修改檔案

本輪只修改／新增 Markdown：`CONTEXT.md`、`docs/adr/ADR-0018-deep-retryable-recovery-contract.md`、`docs/PLAN-A.md`、`docs/handoff.md`、`docs/tickets/deep-recovery-contract-20260828.md`、本檔、`Memory/record.md`、`Memory/lesson_learn.md`。

## 測試結果

本輪未跑測試。基線如 Plan A：extension `124/124`；排除 interactive suite `209/209`；標準 `npm test` `209 pass/1 fail`；`npm run check` 有既存型別／依賴失敗。新增五個測試後目標分別為 `129/129` 與 `214/214`。

## 未解問題

- 尚未證明 extension seam 足以完成同 identity recovery；須先由測試子代理打 RED。
- `q-spi-role` 的來源目前只能標為觀察，尚未由完整 payload 確認是模型重送或 runtime merge 重複。
- 真實 PI 原情境尚未人工驗收。

## 下一步

新 session 先讀 `docs/handoff.md`、`CONTEXT.md`、ADR-0018、ticket 與本 state，展示摘要並等待使用者確認；確認後才執行 Plan A 的 RED→最小實作→獨立驗證流程。
