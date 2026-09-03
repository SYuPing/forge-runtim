---
title: Forge Runtime CONTEXT_BUILD 聚合決策
type: adr
scope: CONTEXT_BUILD production continuation 與使用者專案文件交付
updated: 2026-09-03
source: FORGE_RUNTIME_Arch_v4.md:626-725、1171-1183、1575-1619；docs/adr/ADR-0021-deep-discovery-fallback-human-premise.md:18-53；docs/adr/ADR-0023-knowledge-understanding-context-build-deliverable.md:18-33；docs/adr/ADR-0024-knowledge-summary-authority-boundary.md:14-26
status: implemented/verified
---

# Forge Runtime CONTEXT_BUILD 聚合決策

本文件是使用者專案指定的單一聚合決策文件；它只記錄本輪已核准且具長期影響的取捨。領域詞彙見 [`Documents/CONTEXT.md`](CONTEXT.md)，執行計畫見 [`docs/PLAN-A.md`](../docs/PLAN-A.md)。

## 決策

1. **保留 Evidence → Context → ADR → Spec 的可追溯鏈**：`CONTEXT_BUILD` 只能消費已驗證、具 provenance 的結構化 decisions、findings、limitations 與 evidence IDs；`knowledgeSummary` 僅供閱讀，不得新增事實或控制流程。證據鏈與權威邊界見 `FORGE_RUNTIME_Arch_v4.md:626-725`、`docs/adr/ADR-0023-knowledge-understanding-context-build-deliverable.md:18-29`、`docs/adr/ADR-0024-knowledge-summary-authority-boundary.md:16-26`。

2. **human_premise 是有邊界的充分證據**：Grill 中使用者明確確認的需求、範圍與選擇，得建立可追溯的 `human_premise` 證據，即使新產品尚無外部文件；它只能支撐使用者意圖，不足以支撐外部事實、相容性或安全主張，後者必須保留為 Spec Gap。只有完全沒有可追溯確認、存在材料歧義或 blocking limitation 時才 fail-closed。證據來源與限制見 `docs/adr/ADR-0021-deep-discovery-fallback-human-premise.md:31-39,51-53`、`forge-runtime/extensions/forge-runtime.ts:526-541,1491-1507`。

3. **Context 與 ADR 分離**：Context 只承載領域 glossary；ADR 承載 hard-to-reverse 的取捨與理由，不把實作步驟或測試混入兩者。分層契約見 `FORGE_RUNTIME_Arch_v4.md:671-724`。

4. **候選先驗證，三檔原子寫入**：流程先在記憶體建立 Context、ADR、handoff candidates；遇材料歧義先 `WAIT_USER`。三份候選全部通過後，才在明確且通過 containment 的使用者專案根目錄寫入 `Documents/`，以 base-hash guard、同目錄暫存與 rollback 保護既有文件；production 入口只有非空 `ctx.cwd` 可啟動，缺失時 fail-closed，不使用 `process.cwd()` fallback。Evidence Package 在進入 Context Build 前必須先原子完成，驗證失敗不得部分保存，見 `docs/adr/ADR-0023-knowledge-understanding-context-build-deliverable.md:19-23`。

5. **Workflow 擁有階段轉移**：`CONTEXT_BUILD → ADR_BUILD → TO_SPEC` 由 Workflow/session-state 控制；extension 只提供 invocation 與檔案系統 adapter，不自行決定階段或繞過人類決策。階段順序見 `FORGE_RUNTIME_Arch_v4.md:1171-1183`、`forge-runtime/src/runtime/session-state.ts:492-518`；人類決策保存見 `forge-runtime/src/runtime/session-state.ts:677-687`。

6. **Production continuation 與安全提交**：settled continuation 各只呼叫一次 `forge_context_complete`／`forge_adr_complete`；ambiguous outcome 使用 fresh attempt 後再 resume。Documents writer 以 active PI project root、optimistic base hash、managed blocks、atomic rollback 寫入；三檔成功後才進 `TO_SPEC`。handoff 採 semantic secret/confidential 規則與 deterministic high-confidence PII redaction，package manifest 掛載 `pi.skills`。
7. **Ambiguity 回答保留來源**：Context／ADR ambiguity 可由 UI select 或一般文字 input 回答；UI 在 `agent_settled` 排 fresh invocation，文字立即 transform fresh invocation，兩者均保留 `sourceRoundId`／`humanDecisions`。

## 後果

- 新產品可以用已確認的 human premise 開始形成 Context，不會因文件不足被錯誤阻擋。
- 外部事實、相容性與安全性仍會清楚留下 Spec Gap，不會被需求確認偽裝成驗證結果。
- `Documents/` 是未來 PI 使用者專案的文件命名空間；本 Forge Runtime repo 的既有 root `CONTEXT.md` 與 `docs/adr/` 不被取代。
- 驗證：`npm test` 324/324、base tsc pass、skill quick_validate pass、`git diff --check` pass；Pi-interactive tsc 仍受未修改 `pi-main` 的 TS7016 阻擋。
