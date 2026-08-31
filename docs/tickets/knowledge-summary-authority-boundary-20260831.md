---
title: knowledgeSummary 非權威邊界
type: ticket
scope: forge-runtime
updated: 2026-08-31
source: ADR-0024
status: design-confirmed-not-implemented
---

# Ticket：knowledgeSummary 非權威邊界

## 目標

固定 `knowledgeSummary` 僅供閱讀；摘要矛盾時仍接受 package，正式事實永遠以 `decisions`、`findings`、`limitations` 為準。

## 交付與範圍

- schema／型別契約明確寫出摘要非權威用途。
- Context Builder 正式 items 不受矛盾或新增主張摘要影響。
- 預計只修改 `forge-runtime/extensions/forge-runtime.ts`、`src/evidence/evidence-engine.ts` 與兩個指定測試檔。
- 新增兩個測試，預估全套 267（基線 265）。

## 不做

不做語意 parser、阻擋重試、runtime 重寫、第二模型／DTO／依賴、`pi-main` 或 Context Build 自動續跑。

## 下一步

先新增 schema description 測試並執行 RED，再做最小實作；完成後做 Context Builder 回歸、完整驗證與雙軸 review。
