---
title: CONTEXT_BUILD 的 human_premise 與 Documents 產物邊界
type: architecture-decision-record
scope: Grill 人類確認、CONTEXT_BUILD／ADR_BUILD 與 PI 使用者專案文件輸出
updated: 2026-09-03
source: 使用者核准、FORGE_RUNTIME_Arch_v4.md、ADR-0021、ADR-0023、ADR-0024、ADR-0026、docs/handoff.md
status: implemented/verified
---

# ADR-0027：CONTEXT_BUILD 的 human_premise 與 Documents 產物邊界

> **後續邊界註記（2026-09-03）**：本 ADR 第 5、6、8 點中關於 canonical 文件位置、後續交接與 `TO_SPEC` 的解讀，已由 [`ADR-0028`](ADR-0028-official-documents-and-to-spec-confirmation-boundary.md) 部分取代。`human_premise`、fail-closed 安全邊界、Documents writer 與其原子性決策仍然有效；本註記不刪除或改寫歷史決策。

## Context

目前 Evidence Package 與 Context Builder 已有資料契約，但 `CONTEXT_BUILD` 尚無 production caller；一般 `grill_confirmation` 也只保存 `EvidenceDecision`，無法讓沒有外部文件的新產品進入 Context Build。另一方面，Forge 開發文件與未來由 PI 開發的使用者專案文件必須分開，避免根 `CONTEXT.md`／`docs/` 與 `Documents/` 混為同一層。

## Decision

1. Grill 中使用者明確確認需求、範圍或選擇時，建立具 round／decision provenance 的 `human_premise`，即使沒有外部文件也可進 `CONTEXT_BUILD`。
2. `human_premise` 僅證明使用者意圖；不得作為 API、相容性、法規、安全等外部事實。資料不足時記錄完整 non-blocking Spec Gap，允許 exploratory 開發。
3. 完全沒有可追溯確認、material ambiguity 或 blocking limitation 才 fail-closed；既有 evidence provenance、引用與推論檢查不放寬。
4. Context candidate 僅來自當前任務相關且已驗證的 decisions/findings/limitations/evidence IDs；`knowledgeSummary` 非權威，原始 wiki/log/transcript 不直接輸出。
5. workflow-native context-build skill 只產生 candidate。Workflow/session-state 控制 transition；Context Build 成功後才進 ADR Build，三份文件驗證並以 atomic bundle commit 成功後 runtime 只切入 `TO_SPEC` 狀態節點；TO_SPEC executor 不由本 ADR 宣稱已完成。
6. 未來 PI 使用者專案固定由明確 `ctx.cwd` 寫入 `Documents/CONTEXT.md`、`Documents/ADR.md`、`Documents/handoff.md`；Forge 自身的根 `CONTEXT.md`、`docs/` 與這些產物分離。
7. 文件寫入必須使用 managed blocks、optimistic base-hash、同目錄 staging 與 atomic rollback，保留 unmanaged content。production 入口已移除 `process.cwd()` fallback；只有非空 `ctx.cwd` 可啟動，確保 `Documents/` 永遠位於 active PI project root，缺失時 fail-closed。
8. `agent_settled` 各只呼叫一次 `forge_context_complete`／`forge_adr_complete`；ambiguity 使用 fresh attempt `WAIT_USER` resume。三檔成功寫入後可切入 `TO_SPEC` 狀態節點，但 TO_SPEC tool／handler 與 executor 尚未實作，後續須等待明確確認。
9. bundled skill 由 package manifest 的 `pi.skills` 掛載；handoff 採 semantic secret/confidential 規則與 deterministic high-confidence PII redaction。
10. Context／ADR ambiguity 同時支援 UI select 與一般文字 input；UI 由 `agent_settled` 排 fresh invocation，文字則立即 transform fresh invocation，兩者保留 `sourceRoundId`／`humanDecisions`。

## Consequences

新產品可用 Grill 的明確人類決策建立最小 context，不會因缺少文件被流程硬擋；外部事實仍保持可追溯與主張邊界。文件寫入較嚴格，但可避免並行覆蓋與半套產物。

## Not in scope

不修改 `pi-main/`、不新增 dependency、UI、Spec／TO_TICKET 實作、trusted formal-spec importer 或 generic execution guard；本輪不重做已完成的 Evidence Package 與 Deep fallback。

## Known gap

已完成實作位於 `forge-runtime/src/runtime/session-state.ts`、`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/knowledge/context-builder.ts`、`forge-runtime/src/decision/adr-builder.ts`、`forge-runtime/src/artifacts/documents-writer.ts` 與 bundled skill。production 入口只有非空 `ctx.cwd` 可啟動，缺失時 fail-closed。驗證為 `npm test` 324/324、base tsc pass、skill quick_validate pass、`git diff --check` pass；Pi-interactive tsc 的既有 `pi-main` TS7016 仍是風險。
