---
title: Forge intent 到 Context Build 垂直流程圖交付狀態
type: task-state
scope: forge-intent-context-flow-20260830
updated: 2026-08-30
source: forge-intent-context-flow.html、Memory/record.md、Memory/lesson_learn.md
status: completed-with-caveats
---

# Forge intent→Context Build 垂直流程圖

## 已完成項目

- 完成獨立 HTML 流程圖 `forge-intent-context-flow.html`。
- 主流程自上而下九列，每列一個 state；併發與等待另開旁路，交接文字精簡且白話。
- 建立維護 Skill `C:\Users\User\.codex\skills\forge-intent-context-flow\`，未來可用 `$forge-intent-context-flow` 持續校正同一份 HTML。

## 重要決策

- 唯一 HTML 交付是 `forge-intent-context-flow.html`。
- 舊 `forge-runtime-flow.html` 已復原且無 diff，不作為本輪交付。
- 分開呈現 workflow state、completion status、入口等待與併發支線。

## 修改檔案

- `forge-intent-context-flow.html`
- `Memory/record.md`
- `Memory/lesson_learn.md`
- `agent-state/forge-runtime-flow-20260830.md`
- `agent-state/forge-intent-context-flow-20260830.md`
- `C:\Users\User\.codex\skills\forge-intent-context-flow\SKILL.md`（repo 外的個人 Skill）

## 測試結果

- Browser 1280×900：PASS。
- Browser 390×844：PASS；手機支線寬 289–296px。
- console errors：0。
- Skill `quick_validate` UTF-8：PASS。
- Skill 獨立 review：P0/P1/P2 均 0。

## 未解問題

- 空 Evidence Package 仍可能通過 validator 並抵達 `CONTEXT_BUILD`。
- Context builder 與 `human_premise` 尚未完整接入正式 runtime completion 路徑。

## 下一步

- 另案依 ADR-0021 與 Evidence 充足性邊界設計、授權並實作 runtime 修復。
- 完成真實 PI 原始情境人工驗收。
- 未來維護時使用 `$forge-intent-context-flow`，每次依目前 CodeGraph／可執行 handler 重新產生流程證據。

## 通用 Skill 擴充

- Forge 專用 Skill 仍保留作為相容維護入口；其 `agents/openai.yaml` 已設定 `policy.allow_implicit_invocation: false`，避免攔截通用流程圖需求。
- 跨專案通用維護已移至 [`C:\Users\User\.codex\skills\code-flowchart-html\SKILL.md`]，狀態與驗證見 [`agent-state/code-flowchart-html-20260830.md`](./code-flowchart-html-20260830.md)。
