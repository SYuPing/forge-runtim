---
title: Deep retryable recovery contract
type: ticket
scope: Forge Runtime v4 Deep Retrieval／Knowledge Understanding
updated: 2026-08-28
source: 使用者實際 PI 輸出、ADR-0016、ADR-0017、ADR-0018、docs/PLAN-A.md
status: design-approved-implementation-pending
---

# Ticket：deep-recovery-contract-20260828

## 結論

本輪只完成設計文件，尚未實作。策略唯一真相來源為 [`ADR-0018`](../adr/ADR-0018-deep-retryable-recovery-contract.md)，執行細節見 [`docs/PLAN-A.md`](../PLAN-A.md)。

## 需求與決策

- `manifest=[]` 且 `source=target`：回 retryable invalid，保留相同 identity，不進 `WAIT_USER`；要求模型自行改用 `wiki`／`code_base`，runtime 不自動選 source／target。
- duplicate `decisionId`：維持拒絕、不靜默去重；同一 `KNOWLEDGE_UNDERSTANDING` attempt 以相同 identity 重送修正後唯一 IDs。
- invalid／rejection 不推進 stage 或寫 `CONTEXT_BUILD`；保留 stale guard。production 預設只改 extension；只有 RED 證明 seam 不足才回報 blocker。

## 範圍

只列 `forge-runtime/extensions/forge-runtime.ts` 與 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。不改 `pi-main/`、`session-state.ts`、API/schema/UI/scheduler、snapshot，不自動 fallback，不接受 basename 模糊匹配，不建立 Plan B。

## 驗收

五個測試名稱與具體斷言以 Plan A 為準；最後必須在沒有 `WAIT_USER` loop 的情況下進入 `CONTEXT_BUILD`。真實 PI 原情境為人工驗收。

## 基線

Extension `124/124`，新增後目標 `129/129`；排除 `pi-grill-interactive.test.ts` 的本地 suite `209/209`，新增後目標 `214/214`。標準 `npm test` 為 `209 pass/1 fail`（既存缺 qwen token-plan JSON）；`npm run check` 有既存 terminal 型別與 pi-main 依賴失敗。本 ticket 不新增新失敗。
