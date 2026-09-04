---
title: 零候選同意與 Context Build 過期結果復原
type: ticket
scope: Forge Runtime workflow consent、CONTEXT_BUILD stale completion recovery
updated: 2026-09-05
source: 使用者核准、ADR-0023、ADR-0027、ADR-0029、FORGE_RUNTIME_Arch_v4.md
status: implemented-completed-check-blocked
---

# Ticket：零候選同意與 Context Build 過期結果復原

## Goal

修正實際流程中重複詢問同意，以及 `CONTEXT_BUILD` 收到過期 completion 後無法繼續的問題。

## Building

- 缺少來源 gate 與空 snapshot gate 共用狹窄的 workflow-scope exploration consent；同一次 workflow 只詢問一次。
- 新 workflow、cancel、reset、switch 清除 consent；其他人類決策不沿用。
- stale completion 維持 fail-closed；第一次 stale 後在下一次 `agent_settled` 以目前有效 identity 自動 replay 一次。
- 第二次 stale 不自動循環；`/forge-runtime continue` 明確恢復，且只能重播目前有效 invocation。

## Not Building

- 不放寬 stale identity 檢查。
- 不新增 queue、頂層 state、service 或 ADR-0030。
- 不改有候選的 Light→Grill→Deep 路徑、不修改 `pi-main/`、不新增依賴。

## Success criteria

- 缺少來源與空 snapshot gate 在同一 workflow 不會重複詢問同意。
- consent 在新 workflow、cancel、reset、switch 後不會殘留。
- 過期 completion 不會改寫 state 或 package；下一次 `agent_settled` 最多自動 replay 一次。
- 再次 stale 不會無限重播；`/forge-runtime continue` 只恢復目前有效 invocation。
- RED 能驗證 stale terminate 後是否必定觸發 `agent_settled`；若不成立，實作採 continue-only recovery，不新增 queue。

## Execution order

1. 先以現有 workflow seam 建立 RED，確認兩個 gate 的重問與 stale recovery 缺口；若既有 seam 不足，停止並請使用者確認，不預先擴大範圍。
2. 實作最小 consent scope 與清除邊界。
3. 實作一次性 `agent_settled` replay 與 continue-only fallback，保留 fail-closed identity guard。
4. 執行 focused、完整測試與型別檢查，確認沒有 `pi-main` 新錯誤。

## Files

- Production：`forge-runtime/extensions/forge-runtime.ts`。
- Tests：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。
- 設計同步：本 ticket、`CONTEXT.md`、ADR-0023、ADR-0027、ADR-0029。

## Completion

實作完成；focused 4/4、`npm test` 333/333、主 tsconfig pass、兩個獨立 review PASS，且 stale 結果仍 fail-closed。正式 `npm run check` 有既有外部阻塞：未修改上游 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 的 highlight.js 子路徑缺少型別，共 20 個 TS7016；本 ticket 未修改 `pi-main`。文件已同步更新。

## Risks

- 最脆弱假設是 stale terminate 後必定觸發 `agent_settled`。若 RED 證明不成立，使用 `/forge-runtime continue` 的 continue-only recovery；不新增 queue。
- 若 consent scope 綁定錯誤，可能重問或把同意帶到下一個 workflow；必須以新 workflow、cancel、reset、switch 測試隔離。
- provider 仍可能重播舊 identity；此情況只能拒收並等待明確 continue，不能放寬 identity 比對。
