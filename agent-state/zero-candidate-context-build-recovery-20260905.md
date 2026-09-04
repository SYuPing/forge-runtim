---
title: 零候選同意與 Context Build 過期結果復原
type: agent-state
scope: forge-runtime extension consent 與 Context Build continuation
updated: 2026-09-05
source: 使用者核准、docs/PLAN-A.md、docs/handoff.md、session HTML 診斷
status: implementation-complete-verified-external-check-blocked
---

# 已完成項目

- 已確認兩項修正規則：同 workflow 重用 exploration consent；stale completion 拒收後目前 identity 自動 replay 一次，耗盡後僅 `/forge-runtime continue`。
- 已完成 Plan A 與 handoff 文件同步；本案不產生 Plan B。
- Slice 1 已完成：零候選同意在同一 workflow 內重用 consent，避免第二次詢問。
- Slice 2 已完成：Context Build stale completion 維持拒收，將目前有效 identity 有界地排回 pending，交由下一次 `agent_settled` 重播。
- Slice 3 已完成：`/forge-runtime continue` 僅在自動 replay 耗盡且 identity／invocation／workflow 全相符、無 pending／timer 時恢復目前 invocation。
- 本 ticket implementation 已完成；四個 public-seam 回歸測試均已 RED→GREEN，standards/spec review PASS。

# 重要決策

- consent 於新 workflow、cancel、reset、switch 清除。
- identity guard 維持 fail-closed，不接受過期結果；自動 replay budget 綁定目前 identity。
- extension closure 保留目前已送出的 Context invocation；同一 identity 設一次性 replay budget，避免重複排程。
- `/forge-runtime continue` 不接受舊 payload；只有既有 Context tool 在條件全部成立時才重播目前 invocation。

# 修改檔案

- 已修改：`docs/PLAN-A.md`、`docs/handoff.md`、本狀態檔、`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。
- Slice 1 production：`forge-runtime/extensions/forge-runtime.ts` 新增 workflow-scope consent 旗標；明確同意時 set，於新 workflow、cancel、switch 時 clear。
- Slice 1 test：新增 `Extension_WhenMissingAssetApprovalLeadsToEmptySnapshot_ShouldNotAskConsentTwice`。
- Slice 2 test：`Extension_WhenContextBuildCompletionIsStale_ShouldRetryCurrentInvocationOnce`；原測試誤把 input transform 當成 `sendUserMessage`，已改用公開 seam。
- Slice 3 production：在既有 `/forge-runtime continue` 增加 `CONTEXT_BUILD` 分支，執行上述條件式恢復。
- Slice 3 test：`Extension_WhenContextBuildStaleRetryIsExhausted_ShouldReplayOnlyOnContinue`。
- Lifecycle boundary test：新增 `Extension_WhenExplorationConsentWorkflowIsCancelled_ShouldAskAgainInNewWorkflow`，驗證取消後新 workflow 不沿用舊 consent。

# 測試結果

- Slice 1 RED：第二次 select 實際 1、預期 0。
- Slice 1 GREEN：production 修正後已轉綠；測試代理回報 330 passed、0 failed（其 npm 命令實際執行完整測試摘要）。
- 三個 focused slices 已完成 implementation；整體 `npm run check` 尚未在本狀態更新中宣稱完成。
- Slice 2 RED：校正公開 seam 後，`replayed.length` 實際 0、預期 1。
- Slice 2 GREEN：production 修正後精確單測通過，1 passed、0 failed。
- Slice 3 RED：`continue` 後訊息實際 0、預期 1。
- Slice 3 GREEN：production 修正後精確單測通過，1 passed、0 failed。
- Lifecycle test RED：暫時移除 cancel 與 new-workflow consent clear 後 exit 1，171 passed、1 failed（實際 0、預期 1）。
- Lifecycle test GREEN：復原 consent clear 後 exit 0，172 passed、0 failed、0 skipped。
- 四個 public-seam 測試均已 RED→GREEN：零候選重問、stale 一次 replay、replay 耗盡後 continue、workflow cancel 後清除 consent。

# 未解問題

- focused tests：4/4 通過；完整測試：333/333 通過、0 failed。
- 主 tsconfig typecheck 通過；standards/spec review PASS。
- `npm run check` 仍受 20 個既有 `pi-main` TS7016 阻塞，屬外部驗證阻塞，不是本 ticket Forge Runtime 錯誤。
- provider／模型重播舊 identity 的來源仍是觀察，非已證實根因。

# 下一步

1. 保留 20 個既有 `pi-main` TS7016 作為外部驗證阻塞，勿修改上游或誤標為 Forge Runtime regression。
2. 若要完全解除驗證阻塞，另案處理上游型別依賴；本 ticket 不再擴大範圍。
