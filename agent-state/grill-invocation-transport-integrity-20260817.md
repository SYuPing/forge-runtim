# Grill 呼叫傳輸完整性狀態

日期：2026-08-17

狀態：Slice 1、Slice 2、Slice 3 完成；post-review-fix validation、final review 與 acceptance／closure complete（2026-08-18）。

## 已完成項目

- 新增 initial ingress provider-context integration test。
- 修正 route-correct task 與最後一筆 provider user capture。
- 舊 production 合格 RED：最後一筆 user 是原 task，缺 completion payload。
- 移除 initial ingress `pendingUserMessageRewrite = text;` 後 GREEN。
- 首輪 review findings 已修正：英文 ponytail 註解改為繁中、initial 測試補上 `roundId` 與 manifest assertion、文件驗證狀態與測試名稱同步。
- 三條 integration path 的 fixture duplication 刻意不抽象，保留 independent integration paths。
- final review 已完成：Standards 0 findings、Spec 0 findings；本 ticket acceptance／closure 完成。

## 重要決策

- 遵循垂直 TDD，一次一條路徑。
- custom Forge status 在 provider context 會成為 user，因此測試選最後一筆 user。
- 診斷 probe 已移除。
- presentation/provider 分離仍是後續待辦、不在本 ticket production scope。

## 修改檔案

- `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`
- `forge-runtime/extensions/forge-runtime.ts`
- durable 文件同步：`CONTEXT.md`、`docs/adr/ADR-0007-grill-completion-tool.md`、`docs/PLAN-A.md`、`docs/handoff.md`、本 state 檔。

## 測試結果

- 精確 name-filter 命令：RED exit 1（最後 user 是原 task，缺 completion payload）。
- 精確 name-filter 命令：GREEN exit 0（1 pass）。

## Slice 1 當時狀態（已由後續 milestone 取代）

- approval 與 `WAIT_USER` 當時尚未做，已由 Slice 2／Slice 3 完成。
- 完整驗證／review 當時尚未做；後續 validation 與 final review 已完成，Standards／Spec 均 0 findings。

## 下一步

1. Slice 2 approval RED（歷史下一步，已完成）。

## Slice 2 里程碑

### 已完成項目

- 新增 approval provider-context integration test。
- 合格 RED：provider 最後 user=`同意`，缺 completion payload，exit 1。
- 只移除 approval branch `pendingUserMessageRewrite = text;`。
- GREEN：1 pass，exit 0。

### 重要決策

- capture 最後 provider user。

### 修改檔案

- `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`
- `forge-runtime/extensions/forge-runtime.ts`

### 測試結果

- approval 精確 name-filter 命令：RED exit 1（provider 最後 user=`同意`，缺 completion payload）。
- approval 精確 name-filter 命令：GREEN exit 0（1 pass）。

### Slice 2 當時狀態（已由後續 milestone 取代）

- `WAIT_USER` 當時尚未做，已由 Slice 3 完成。
- 完整驗證與 final review 當時尚未做；後續 validation 與 final review 已完成，Standards／Spec 均 0 findings。

### 下一步

1. Slice 3 RED（歷史下一步，已完成）。

## Slice 3 里程碑與 cleanup

### 已完成項目

- 最終有效 RED：穩定 fixture 含 auth evidence、掃描全部 provider contexts；舊 setter 下缺 structured `grill-2`，exit 1。
- 移除 WAIT setter 後 GREEN，exit 0。
- 移除宣告、clear 與 user `message_end` rewrite 死碼。
- post-cleanup 三個新測試單批次通過：pass 3、fail 0、exit 0。

實際測試名稱：

- `PiIngress_WhenInitialGrillIngress_ShouldPreserveFullGrillInvocationInProviderContext`
- `PiProvider_WhenKnowledgeBaseApprovalStartsGrill_ShouldReceiveStructuredInvocationInsteadOfApprovalText`
- `PiProvider_WhenWaitUserAnswerStartsNextRound_ShouldReceiveStructuredInvocationInsteadOfAnswer`

### 重要決策

- Forge custom status／steering 與 tool continuation 不能依賴固定 context index；`waitForIdle` 後掃描全部 contexts。
- test headroom 保留 ponytail ceiling。

### 修改檔案

- `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`
- `forge-runtime/extensions/forge-runtime.ts`

### 測試結果

- 最終有效 RED：穩定 fixture 含 auth evidence、掃描全部 provider contexts，舊 setter 下缺 structured `grill-2`，exit 1。
- WAIT setter 移除後 GREEN：exit 0。
- post-cleanup 三個新測試單批次：pass 3、fail 0、exit 0。
- post-review-fix full PI TUI：pass 7、fail 0、skip 0。
- canonical `npm test`：pass 130、fail 0、skip 0；首次 130 pass／1 fail 為 obsolete original-transcript rewrite test，刪除後重跑為 130／0。
- `npm run check`：兩段 tsc 均 pass、no diagnostics。
- final review：Standards 0 findings、Spec 0 findings；acceptance／closure complete。

### 未解問題

- 未解問題僅有 future presentation/provider seam；不屬本 ticket scope、非本 ticket blocker、尚未核准或實作，需另走 `design-plan-workflow` 並取得人類決策。

### 下一步

1. 本 ticket 無剩餘工作；future presentation/provider seam 若要推進，另走 `design-plan-workflow` 並取得人類決策。
