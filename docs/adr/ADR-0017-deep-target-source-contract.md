---
title: ADR-0017：Deep 目標來源契約
type: adr
scope: Forge Runtime v4 Deep Retrieval target source conversion and validation
updated: 2026-08-28
source: FORGE_RUNTIME_Arch_v4.md、ADR-0015、ADR-0016、CONTEXT.md、docs/tickets/deep-target-source-contract-20260827.md
status: implemented-and-verified
---

# ADR-0017：Deep 目標來源契約

日期：2026-08-27

## 狀態

Implemented and validated；production schema、handler guard、follow-up manifest 與 stale sibling termination 均已完成，且無待決設計。

## Context

ADR-0015 定義 Grill snapshot 與人類決策邊界，ADR-0016 定義 Deep Retrieval 的 target source 必須來自 snapshot 且不可猜路徑。實際輸出顯示 Grill 完成後，第一次 `forge_deep_search` 因 target source 不明確失敗，後續同批呼叫又被視為 stale。現有轉換只攜帶 identity，沒有把可用 target manifest 明確提供給 follow-up；工具輸入也未依 source 分支強制 target 檔名。

可核對證據：`forge-runtime/extensions/forge-runtime.ts:548-560, 614-657, 1923-1931`、`forge-runtime/src/runtime/session-state.ts:376-405`、`pi-main/packages/agent/src/agent-loop.ts:489-584`，以及 ticket 所保存的使用者實際輸出。上述輸出是觀察；根因契約以本 ADR 固定後，仍須透過 RED／GREEN 驗證。

## Decision

1. Deep follow-up 從既有 `workflow.snapshot.candidates` 列出允許的 target manifest；沒有候選時也明確寫出空清單。不新增儲存結構，不猜測檔案。
2. `forge_deep_search` schema 依 `source` 分支：`target` 時 `targetSource` 必填；`wiki` 與 `code_base` 不要求。
3. handler 做第二層防禦：target 缺 `targetSource` 回 retryable invalid，不進 `WAIT_USER`、不清除 `deepAttempt`、不耗用 budget。target 明確但無唯一匹配時維持 `needs_decision`，轉 `WAIT_USER`、清 attempt，等待人類決策。
4. stale Deep sibling 回傳 `terminate: true`，避免同批 stale result 再推進 agent loop。
5. 不修改 `pi-main/`、`session-state.ts`、snapshot 契約、合法 Deep 後續；不自動選 target，不加入 sequential。PI sequential 不會取消已排入的 sibling。
6. 預計正式程式只改 `forge-runtime/extensions/forge-runtime.ts`，測試只改 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。無 migration、無新依賴；rollback 為還原該正式程式檔。

## Human decision boundary

本 ADR 延續 ADR-0015 與 ADR-0004：runtime 可拒絕不完整或不唯一的 target 輸入，但不可替人選檔案。只有明確且唯一匹配才可搜尋；需要選擇時必須經 `WAIT_USER`，由人類決策後再繼續。

## Fragile assumption

假設 PI/provider 能正確使用 discriminated union。這不能取代 handler guard；即使 schema 層失效，runtime 仍須保留缺少 `targetSource` 的 retryable invalid 防線。

## Verification contract

五個指定情境測試均通過；完整 `npm test` `217/217`（`forge-runtime/.tmp/post-schema-test.log`）；`npm run check` exit 0（`forge-runtime/.tmp/post-schema-check.log`）；Standards／Spec re-review 均 PASS。僅有 Node `DEP0190` 非阻塞警告。

## Rejected alternatives

- 不自動選唯一看似合理的 target，避免越過人類決策邊界。
- 不只補 prompt，因為 schema 與 handler 必須共同守住契約。
- 不新增 sequential、custom loop、migration 或依賴，因為它們不能取消已排 sibling，且超出本 ticket。

## 2026-08-28 Stale 範圍勘誤

本 ADR 與上一張 ticket 所稱的 stale sibling termination 只涵蓋已完成的 Deep search 分支；不等於所有 Deep stale 結果。`forge_deep_retrieval_complete` 與 `forge_deep_complete` 仍有共六個 completion stale return 尚待本 ticket 補上 `terminate: true`。本勘誤不改寫歷史 ticket，也不擴大 target source 契約。
