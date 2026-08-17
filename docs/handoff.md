# Forge Runtime v4 交接

日期：2026-08-17

## 目標與目前狀態

依 ADR-0010 與 `docs/PLAN-A.md`，WAIT_USER 重入與 UI lease 生命週期 ticket 已完成。

- 同時只允許一個 pending decision；不同 ID 靜默忽略，採 first-pending-wins。
- 相同 ID 只重顯 UI；active UI 略過重複發布，不做 WAIT_USER transition。
- `published` 改為 in-flight UI lease，整段 `ctx.ui.custom` 互動持有並由 `finally` 於結束／例外清除。
- Escape／無 UI 保留 WAIT_USER 與 pending decision；UI throw 清 lease 後上拋；不自動重試。
- answered decisionId reuse、pi-main/schema/stages/completion 與 reset lifecycle 均不在本次範圍。

## Plan A 完成結果

- production 已在 `forge-runtime/extensions/forge-runtime.ts` 分離 pending identity 與 UI in-flight lease。
- 不同 ID 靜默忽略；同 ID UI 返回後可重顯；active UI 去重；`finally` 涵蓋正常、Escape／undefined 與 throw；成功回答清 identity。

## 相關文件與預計程式檔

- `CONTEXT.md`
- `docs/adr/ADR-0010-wait-user-single-pending-ui-lease.md`
- `docs/PLAN-A.md`
- `docs/PLAN-B.md`（保留為先前人工視覺驗收）
- `docs/handoff.md`
- `agent-state/wait-user-fixed-custom-input-20260815.md`
- production/test 實際：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`

## 決策

- 不同 `decisionId` 重入由 extension 靜默忽略且不改原 pending；相同 ID 只重顯，active UI 不重複發布。
- UI lease 覆蓋整段 `ctx.ui.custom` 互動；由 `finally` 清除，throw 向上傳遞並保留 WAIT_USER。
- Escape／無 UI 保留待決策，可自然文字或同 ID 日後重試，不自動重試。
- 不修改 answered decisionId reuse、queue／replace／history dedupe／reset lifecycle，也不修改 `pi-main/`、schema、stages、completion。

## 缺口與風險

- 上游若強制關閉 component 而未呼叫 `done`，Promise／lease 可能 pending；本次明確排除 reset lifecycle。
- `docs/PLAN-B.md` 保留為先前人工視覺驗收，不新增 Plan B。
- 缺少 `decisionId` 的 ingress 不做 dedupe；上游 UI component 不呼叫 `done` 可能永久 pending。

## 驗證狀態

驗證已完成：精準測試套件 87 通過／0 失敗／0 略過；`npm test` 128 通過／0 失敗／0 略過；`npm run check` 兩段 tsc 均通過；scripted PI TUI 精準 1/1、完整 4/4 通過。最終 Standards review 0 findings；最終 Spec review 0 findings。runtime／test 在最終測試後未再修改，後續僅進行文件翻譯與狀態同步。

```text
cd forge-runtime
npx tsx --test tests/extensions/forge-runtime-extension.test.ts tests/grill/grill-skill.test.ts tests/ui/wait-user-panel.test.ts
npm test
npm run check
```

## 下一步

本 ticket 已完成，無待實作或 re-review；下一步僅等待使用者另行決定方案 B 人工視覺驗收，或開立新 ticket。
