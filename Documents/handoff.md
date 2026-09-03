---
title: CONTEXT_BUILD production continuation 交接
type: handoff
scope: CONTEXT_BUILD → ADR_BUILD → TO_SPEC 的 production continuation
updated: 2026-09-03
source: Documents/CONTEXT.md、Documents/ADR.md、docs/PLAN-A.md、FORGE_RUNTIME_Arch_v4.md、docs/adr/ADR-0021-deep-discovery-fallback-human-premise.md、docs/adr/ADR-0023-knowledge-understanding-context-build-deliverable.md、docs/adr/ADR-0024-knowledge-summary-authority-boundary.md
status: implemented/verified-with-caveats
---

# CONTEXT_BUILD production continuation 交接

## 目前狀態

Evidence Package contract 與本 ticket 已完成。`CONTEXT_BUILD`／`ADR_BUILD` 由 bundled skill 自動續跑，各只呼叫一次 completion tool；ambiguity 以 fresh attempt `WAIT_USER` resume。三檔 Documents bundle 成功後進 `TO_SPEC`。

## 已核准設計

- 領域詞彙與 human premise 邊界見 [`Documents/CONTEXT.md`](CONTEXT.md) 與 [`Documents/ADR.md`](ADR.md)。
- 既有 evidence、decisions、findings、limitations 與 runtime-derived evidence IDs 是權威輸入；`knowledgeSummary` 非權威。
- Grill 明確確認的需求、範圍與選擇可形成 `human_premise`；外部事實、相容性與安全主張若缺證據，記為 Spec Gap。完全沒有可追溯確認、材料歧義或 blocking limitation 才 fail-closed。
- `CONTEXT_BUILD` 建立記憶體 Context candidate；`ADR_BUILD` 建立 ADR 與 handoff candidates；候選全數驗證後才 bundle commit 到使用者專案根目錄的 `Documents/`。
- Context／ADR ambiguity 可由 UI select 或一般文字 input 回答；UI 在 `agent_settled` 排 fresh invocation，文字立即 transform fresh invocation，均保留 `sourceRoundId`／`humanDecisions`。
- 寫入必須接受明確且非空的 `ctx.cwd` 並通過 containment；production 已移除 `process.cwd()` fallback，確保 `Documents/` 永遠位於 active PI project root，缺失時 fail-closed。以 base-hash guard、同目錄暫存與 rollback 保留既有檔案。Workflow/session-state 擁有 transition，extension 僅作 invocation/filesystem adapter。

## 執行 Plan A

依 [`docs/PLAN-A.md`](../docs/PLAN-A.md) 延續最小 production scope：先窄查現有 Context Builder、ADR Builder、session state 與 extension seam，接上正式 continuation；補齊 candidate validation、human decision gate、Documents bundle writer 與 transition guard；最後由獨立驗證與 review 角色確認，禁止修改 `pi-main/`。

## 已知 gaps、風險與 fragile assumptions

- 真實 PI host 的 `ctx.cwd`、訊息交付與取消時序仍需驗證；不可用測試 workaround 放寬正式 gate。
- PI interactive typecheck 仍受未修改 `pi-main` 的 `syntax-highlight.ts` 缺少 `highlight.js` 宣告（TS7016）阻擋；此為上游 baseline。
- human premise 只代表使用者意圖；若後續文字提出外部事實、相容性或安全主張，必須新增外部 evidence 或保留 Spec Gap。
- high-confidence PII redaction 目前只涵蓋已知高信心模式；若輸入形態超出模式，仍需人工檢查。
- P2：若未來 handoff 與其他文件的重複引用造成維護負擔，再另案收斂重複內容。
- `Documents/` 路徑是使用者專案根目錄的 namespace，不是本 Forge Runtime repo 的既有 canonical `CONTEXT.md`／`docs/adr/` 的遷移目標。

## 下一步

由未來 PI session 讀取 [`Documents/CONTEXT.md`](CONTEXT.md) 與 [`Documents/ADR.md`](ADR.md)，依下列 Suggested skills 繼續；若需改變決策或範圍，先建立新的設計 ticket。

## Suggested skills

- implementation 使用 Forge package 自帶的 workflow-native `context-build` skill；它吸收 `domain-modeling` 與 `handoff` 的必要規則，不依賴 repo 或執行環境中可直接呼叫的全域 `/domain-modeling`、`/handoff` skill。
- 下一 session 實作仍使用 `execute-designed-plan`，以本交接與既有設計文件為輸入。
- `design-plan-workflow`：若 continuation scope 或 transition ownership 改變，先更新設計文件再開發。

驗證：`npm test` 324/324、base tsc pass、skill quick_validate pass、`git diff --check` pass。PI interactive tsc 仍受未修改 `pi-main` 的 `syntax-highlight.ts` 缺少 `highlight.js` 宣告（TS7016）阻擋。
