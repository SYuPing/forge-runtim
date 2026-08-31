---
title: KNOWLEDGE_UNDERSTANDING→CONTEXT_BUILD 交付物
type: ticket
scope: Forge Runtime Knowledge Understanding／Context Build handoff
updated: 2026-08-30
source: 使用者確認、ADR-0023、docs/PLAN-A.md、CONTEXT.md、docs/handoff.md
status: implemented-verified-reviewed
---

# Ticket：knowledge-understanding-context-build-deliverable-20260830

## 目標

讓 `KNOWLEDGE_UNDERSTANDING` 完成結果以單一、完整、已驗證的 Forge-owned immutable package 原子化交付給 `CONTEXT_BUILD`，不遺失 `decisions`、`findings`、`limitations`、`knowledgeSummary` 與 evidence IDs。

## 核准契約

- structured `decisions`／`findings`／`limitations` 是權威資料；`knowledgeSummary` 只做綜合，不新增事實。
- `knowledgeSummary` trim 後非空，沿用 4000 Unicode code points 限制。
- evidence IDs 從 validated evidence records 由 runtime 衍生為唯讀欄位；模型不得另傳第二份 IDs。
- blocking limitation 與既有 Evidence Package 引用驗證維持 fail-closed。
- package 建立、驗證、保存先於 stage transition；失敗停留原 phase，不部分保存。
- session state 只有一個 Forge-owned getter；Context Build 不讀 tool details、UI prose 或 transport marker。
- new workflow/reset/switch/cancel/full cleanup 清除舊 package。

## 範圍

Production：`forge-runtime/src/evidence/evidence-engine.ts`、`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/src/knowledge/context-builder.ts`。

測試候選：`evidence-engine.test.ts`、`discovery-evidence.test.ts`、`forge-runtime-extension.test.ts`；session cleanup 測試位置待實作前 CodeGraph 窄查。

## 非範圍

不修改 `pi-main/`、不新增依賴、不建立重複 DTO／第二真相來源、不放寬 fail-closed。自動啟動／排程 Context Build provider 是獨立 continuation gap，不是本 ticket 的隱含成果。

## 驗收與執行

## 實作與驗證結果（2026-08-30）

- 已完成單一 immutable EvidencePackage 交付，包含五項 required handoff：`decisions`、`findings`、`limitations`、`knowledgeSummary`、runtime-derived `evidenceIds`。
- 已完成深層 immutable copy、summary trim／非空／4000 Unicode code points、derived IDs 一致性驗證，以及 validate/save-before-transition；transition 失敗會 rollback。
- 已完成 session getter、reset／cancel／new snapshot cleanup，以及 Context Builder 保留同一 package。
- 明確未接自動續跑 Context Build；provider continuation／排程屬本 ticket 非範圍。

驗證：session 27/27、evidence 18/18、全套 265/265、`npx tsc --noEmit -p tsconfig.json` exit 0。`npm run check` exit 1 僅因未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 的 `highlight.js` declaration（TS7016）；Forge Runtime 自身無錯誤。Standards／Spec review 均 PASS。
