---
title: Forge Runtime intent 到 Context Build 流程圖交付狀態
type: task-state
scope: forge-runtime-flow-20260830
updated: 2026-08-30
source: forge-runtime-flow.html、Memory/record.md、Memory/lesson_learn.md
status: completed-with-caveats
---

> 交付已由使用者更正：舊 `forge-runtime-flow.html` 已復原且無 diff；最終交付移至 `agent-state/forge-intent-context-flow-20260830.md` 與獨立的 `forge-intent-context-flow.html`。以下歷史內容保留，不代表目前唯一交付。

# Forge Runtime intent→Context_build 流程圖

## 已完成項目

- 完成 `forge-runtime/` intent→`CONTEXT_BUILD` 流程的細節掃描與連線整理。
- （歷史）更新 `forge-runtime-flow.html`，補上 state transition、等待／人類決策邊界、PI parallel、Forge barrier、identity、Evidence Package validator 與 Context Build 邊界的白話說明；該 HTML 已復原且無 diff。
- 在 HTML 中標示空 Evidence Package 可抵達 `CONTEXT_BUILD` 的已確認橘色風險。

## 重要決策

- 流程圖以 Workflow state 為主軸，將模型工具平行處理與 Forge barrier 分開描述。
- 明確區分「等待人類決策」與「等待平行工具／barrier 收斂」兩種等待。
- 不以流程圖交付推導或修改 runtime 契約；空包缺口另案設計與授權。

## 修改檔案

- `forge-runtime-flow.html`（歷史檔，已復原、無 diff）
- `Memory/record.md`
- `Memory/lesson_learn.md`
- `agent-state/forge-runtime-flow-20260830.md`

本 ticket 的本代理只修改三個紀錄／狀態檔；未修改 runtime、HTML、ADR、PLAN 或 handoff。

## 測試／驗證結果

- （歷史）Browser 1440×900：PASS。
- （歷史）Browser 390×844：PASS。
- （歷史）parser／來源檢查：9/9。
- console errors：0。
- release gate：可交付。

## 未解問題

- 空 Evidence Package 仍可能通過 validator 並抵達 `CONTEXT_BUILD`；詳見 `Memory/lesson_learn.md` 的 2026-08-30 條目。
- ADR-0021 尚未完整落地，`human_premise` 尚未接入 extension completion 路徑。
- 尚待真實 PI session 的人工驗收；Browser 驗證不等同真實 PI 流程驗收。
- 程序退出 caveat 仍存在，不能把局部 parser／Browser 綠燈宣稱為完整 suite 全域通過。

## 下一步

- 由另案依 ADR-0021 與 Evidence 充足性邊界設計 runtime 修復，取得授權後再實作與驗證。
- 完成真實 PI 原始情境人工驗收，並記錄可核對的輸入、狀態與輸出證據。
