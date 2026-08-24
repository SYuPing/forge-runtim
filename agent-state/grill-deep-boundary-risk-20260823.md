---
title: Grill 到 Deep Knowledge 邊界風險待辦狀態
type: agent-state
scope: grill-deep-boundary-risk-20260823
updated: 2026-08-24
source: 使用者確認的 Light Discovery 後續討論
status: complete
---

# Grill 到 Deep Knowledge 邊界風險

## 已完成項目

- 依核准的 Plan A 完成 Grill → Deep Knowledge 交接流程。
- 完成 relevance clarification、`/continue` 邊界、完成事件驗證、snapshot evidence 隔離、Deep 交接封口與 stale event 防護。
- 完成方案 A 的 decision identity：runtime-issued `roundId + kind + decisionId`。
- 完成 TDD slices、完整測試、兩個 TypeScript 設定檔檢查與雙軸複審。
- 最終交付文件同步完成於本里程碑。

## 重要決策

- 使用者已確認開始依核准計畫實作。
- 使用方案 A：decision instance 由 `roundId + kind + decisionId` 組成；未知 round 拒絕，完全相同的舊 round 事件去重，新 round 即使重用 `decisionId` 也接受。
- WaitUser state/payload、session ledger、debug parser/replay 與 UI lease 均使用完整 decision identity。
- Deep 使用 Grill 的 immutable snapshot candidates，不重新讀取已變動的 live source。
- 保留 human decision boundary；relevance clarification 的通用 `/confirm` 不會替使用者自動選擇。
- 本 ticket 不擴充 full semantic Deep、Pattern Card、persistence 或 second verifier。

## 修改檔案

Production：

- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/src/grill/grill-result.ts`
- `forge-runtime/src/runtime/session-state.ts`
- `forge-runtime/src/ui/ui-state.ts`
- `forge-runtime/src/workflow/state-machine.ts`

Tests：

- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `forge-runtime/tests/grill/grill-result.test.ts`
- `forge-runtime/tests/runtime/session-state.test.ts`
- `forge-runtime/tests/ui/wait-user-panel.test.ts`
- `forge-runtime/tests/workflow/state-machine.test.ts`

Docs and Memory：

- `CONTEXT.md`
- `docs/PLAN-A.md`
- `docs/adr/ADR-0015-grill-deep-knowledge-handoff-boundary.md`
- `docs/handoff.md`
- `Memory/record.md`
- `Memory/lesson_learn.md`
- `agent-state/grill-deep-boundary-risk-20260823.md`

## 測試結果

- `npm test`：157/157 通過，0 skip。
- `npm run check`：兩個 tsconfig 均通過。
- Standards review：P0/P1/P2 = 0。
- Spec review：P0/P1/P2 = 0。
- 過程中的紅燈回歸、fixture、identity collision、await 前封口與 relevance `/confirm` 問題均已修正並由最終驗證覆蓋。

## 未解問題

- 本 ticket scope 內無未解問題。
- Out of scope（非 blocker）：full semantic Deep、Pattern Card、persistence、second verifier；若要延伸，應另開 ticket。

## 下一步

- 若使用者另開 ticket，再延伸上述 out-of-scope 能力。
