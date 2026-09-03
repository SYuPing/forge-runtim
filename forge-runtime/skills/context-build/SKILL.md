---
name: context-build
description: 供 Forge Runtime 在 CONTEXT_BUILD 或 ADR_BUILD 階段，將已驗證的 Evidence Package 壓縮成可追溯的 Context、ADR 與 handoff 候選。
---

# Context Build

只處理 invocation 提供的 structured input：`knowledge.decisions`、`knowledge.humanDecisions`、`knowledge.findings`、`knowledge.limitations` 與 evidence metadata。`knowledge.humanDecisions` 是 Knowledge Package 建立後的使用者決策，和 `knowledge.decisions` 一樣必須納入理解與正式輸出，不得遺漏。`knowledgeSummary` 和 raw source 僅供理解，不是正式事實；正式輸出中的每個主張都必須能追溯到 evidence ID。

`human_premise` 證明使用者意圖、範圍與已確認選擇，不證明外部事實、API、資安或法規。缺少外部證據時，記為 non-blocking Spec Gap；只有沒有可追溯證據、blocking limitation 或 material ambiguity 才 fail-closed。遇到 material ambiguity 時輸出 ambiguity 候選，等待使用者確認。

## CONTEXT_BUILD

將 Evidence Package 壓縮成 glossary 候選。每筆 glossary 必須包含：

- `term`
- `definition`
- `evidenceIds`

`evidenceIds` 只能引用 invocation 提供的證據。若無法形成可信定義，輸出 ambiguity（問題、選項、建議與相關 evidence IDs），不要自行補全。

完成或提出 ambiguity 後，只呼叫一次 `forge_context_complete`，傳入對應的 structured candidate；不輸出 assistant prose、不直接寫檔、不自行 transition。

## ADR_BUILD

只根據已驗證的 Context candidate 與 Evidence Package 產生：

- `records`：每筆包含 `decision`、`rationale`、`consequences`、`citations`。
- `handoff`：包含 `summary`、`nextSessionFocus`、`references`、`suggestedSkills`。

ADR 的 citations 必須是可追溯 evidence IDs。`knowledge.decisions` 與 `knowledge.humanDecisions` 中對本次決策有關的內容都不得遺漏。handoff 參考 `Documents/CONTEXT.md` 與 `Documents/ADR.md`，只補充下一階段所需的狀態與行動，不重複兩份文件內容；不得包含 secrets、PII 或 confidential information。不要把任何原始敏感內容帶入輸出；若無法安全移除，輸出 ambiguity 而不是猜測或送出。無法安全決策時輸出 ambiguity。

完成或提出 ambiguity 後，只呼叫一次 `forge_adr_complete`，傳入對應的 structured candidate；不輸出 assistant prose、不直接寫檔、不自行 transition。
