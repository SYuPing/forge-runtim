---
title: 通用程式流程圖 HTML Skill 交付狀態
type: task-state
scope: code-flowchart-html-20260830
updated: 2026-08-30
source: C:\Users\User\.codex\skills\code-flowchart-html、Memory/record.md、Memory/lesson_learn.md
status: completed
---

# 通用程式流程圖 HTML Skill

## 已完成項目

- 建立獨立 Skill `C:\Users\User\.codex\skills\code-flowchart-html`，適用任何本機程式碼專案。
- 建立 `SKILL.md`、`agents/openai.yaml` 與 `assets/vertical-flow-template.html`。
- 支援垂直主線、等待恢復、條件／錯誤／回流旁路、fork／併發分支、join／barrier 與交接。

## 重要決策

- 以 `Node／Edge／Wait／Parallel` reference ID 模型描述實際流程，`status` 與 `kind` 分離。
- 每列只呈現一個真正狀態；純 HTML／CSS、無外部依賴與 JavaScript。
- Forge 專用 Skill 維持明確指定，通用 Skill 負責跨專案自動使用。

## 修改檔案

- `C:\Users\User\.codex\skills\code-flowchart-html\SKILL.md`
- `C:\Users\User\.codex\skills\code-flowchart-html\agents\openai.yaml`
- `C:\Users\User\.codex\skills\code-flowchart-html\assets\vertical-flow-template.html`
- `Memory/record.md`
- `Memory/lesson_learn.md`
- `agent-state/forge-intent-context-flow-20260830.md`

## 測試結果

- `quick_validate` UTF-8：PASS。
- 模板瀏覽器驗證 1280×900／390×844：PASS；console 0。
- synthetic forward-test：10 nodes／12 edges／2 waits／1 parallel，PASS。

## 未解問題

- 通用 Skill 尚未在其他真實專案長期維護；目前以 synthetic flow 驗證跨框架基本契約。
- 各專案仍須依自身 repo instructions 決定 CodeGraph 不可用時是否允許 fallback。

## 下一步

- 下次使用 `$code-flowchart-html` 依目標專案的實際入口與可執行路徑建立或維護指定 HTML。
- 真實使用時持續補充跨語言與事件驅動流程的驗證案例。
