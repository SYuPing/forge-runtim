---
title: Forge Runtime 使用者專案領域詞彙
type: context
scope: CONTEXT_BUILD 產出的使用者專案領域模型
updated: 2026-09-03
source: FORGE_RUNTIME_Arch_v4.md、ADR-0021、ADR-0023、ADR-0024
status: implemented/verified
---

# Forge Runtime 使用者專案領域詞彙

本文件只定義由知識理解階段整理出的領域語言，讓後續決策與規格使用一致的名稱。

## 知識與證據

**證據（Evidence）**：具有來源、內容與唯一識別碼，能追溯支持一項需求、發現或決策的已驗證資訊。
_Avoid_: 資料、摘要、推測

**證據包（Evidence Package）**：由證據、決策、發現與限制組成，供領域理解使用的權威知識集合。
_Avoid_: 知識摘要、研究筆記

**人類前提（Human Premise）**：使用者在 Grill 中明確確認的需求、範圍或選擇，可作為本專案後續推論的可追溯前提，但不是外部事實。
_Avoid_: 外部證據、驗證事實

**規格缺口（Spec Gap）**：尚缺少外部事實、相容性或安全證據，因而不能把相關主張視為已驗證的明確缺口。
_Avoid_: 未知、失敗

## 決策與交付

**領域上下文（Context）**：對目前專案重要概念的共同語言與精確定義，回答「我們知道什麼」。
_Avoid_: 實作規格、工作清單

**架構決策（ADR）**：記錄具長期影響的取捨、選擇與理由，回答「為什麼這樣決定」。
_Avoid_: Context、Spec、Ticket

**交付候選（Deliverable Candidate）**：尚未寫入使用者專案文件、等待完整驗證與人類確認的 Context、ADR 或 handoff 內容。
_Avoid_: 草稿、已提交文件

**材料歧義（Material Ambiguity）**：會改變需求、範圍、決策或安全邊界的未解釋差異。
_Avoid_: 小問題、文案差異

## 本次產出狀態（2026-09-03）

Context 已由 bundled `context-build` skill 依 Evidence Package、human premise 與獨立 human decisions 產生並驗證。外部事實不足保留為 non-blocking Spec Gap；僅零可追溯證據、blocking limitation 或 material ambiguity fail-closed。此檔由 active PI project root 的 `Documents/` 交付流程管理；production 入口只有非空 `ctx.cwd` 可啟動，缺失時 fail-closed，不使用 `process.cwd()` fallback。

Context／ADR 的 material ambiguity 可由 UI select 或一般文字 input 回答：UI 路徑在 `agent_settled` 排 fresh invocation，文字路徑立即 transform fresh invocation；兩者均保留 `sourceRoundId`／`humanDecisions`，不會卡住。
