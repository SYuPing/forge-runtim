---
title: Knowledge Understanding 交付 Context Build 的單一知識封包
type: architecture-decision-record
scope: Forge Runtime KNOWLEDGE_UNDERSTANDING 到 CONTEXT_BUILD 的資料交接
updated: 2026-08-30
source: 使用者確認、FORGE_RUNTIME_Arch_v4.md、ADR-0016、ADR-0021、現有 evidence-engine／session-state／context-builder
status: accepted
---

# ADR-0023：Knowledge Understanding 交付 Context Build 的單一知識封包

## 狀態

已實作並驗證；ticket：`knowledge-understanding-context-build-deliverable-20260830`。

## 決策

1. 完成 `KNOWLEDGE_UNDERSTANDING` 時建立單一 Forge-owned immutable `KnowledgeUnderstandingPackage`／Deliverable。`decisions`、`findings`、`limitations` 是權威結構化資料；`knowledgeSummary` 只做可讀綜合，不得引入新事實。
2. `knowledgeSummary` 必填，trim 後非空，沿用既有 4000 Unicode code points 限制；既有 Evidence Package 引用驗證與 blocking limitation fail-closed 不變。
3. `evidenceIds` 不由模型另傳；runtime 從 validated evidence records 衍生唯讀欄位，避免第二份可分歧的 evidence ID 真相。
4. package 建立、驗證、保存必須在進入 `CONTEXT_BUILD` 前原子完成；失敗停留原 phase，禁止部分保存。
5. session state 只提供一個 Forge-owned getter；Context Build 只能消費該 package，不讀 tool-result details、UI prose 或 transport marker。
6. new workflow、reset、switch、cancel、full cleanup 清除舊 package。

## 範圍與不變量

最小 production scope 為 `forge-runtime/src/evidence/evidence-engine.ts`、`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/src/knowledge/context-builder.ts`。候選測試為 `evidence-engine.test.ts`、`discovery-evidence.test.ts`、`forge-runtime-extension.test.ts`，session cleanup 測試位置待 CodeGraph 窄查。

不修改 `pi-main/`、不新增依賴、不建立重複 DTO／第二真相來源、不放寬 fail-closed 條件。

## 明確未涵蓋的 continuation gap

本 ADR 定義 Context Build 的必要輸入契約與 consumer seam，但不宣稱自動啟動／排程 Context Build provider 已修復。若要補 provider continuation，必須另案設計與確認。

## 實作與驗證結果（2026-08-30）

- `EvidencePackage` 現在以單一 immutable package 交付五項資料：`decisions`、`findings`、`limitations`、`knowledgeSummary` 與 runtime 衍生的 `evidenceIds`。
- summary 會 trim、拒絕空值，並限制 4000 Unicode code points；package 與巢狀 metadata 皆以深層複製／凍結保護。
- session 在 transition 前完成 validate/save；transition 失敗會 rollback，避免部分保存；getter 與 reset、cancel、new snapshot cleanup 已完成。
- Context Builder 保留同一 package identity；本 ticket 沒有接上自動續跑或排程 Context Build。

驗證：evidence 18/18、session 27/27、全套 265/265、`npx tsc --noEmit -p tsconfig.json` exit 0。`npm run check` exit 1 的唯一原因是未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 缺少 `highlight.js` declaration（TS7016）；不修改 `pi-main`。Standards 與 Spec 獨立 review 均 PASS。

## TDD 驗收

依序完成 RED→GREEN：summary validation／derived IDs；extension schema／handler；atomic session save + transition guard；Context Build 取得五項交付；cleanup isolation。
