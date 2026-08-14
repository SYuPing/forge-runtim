# Grill Resume / Replay 狀態

日期：2026-08-13

> 歷史 ticket 已完成。2026-08-13 起，completion omission 的 `continue` replay 規範由 ADR-0008 supersede；下一輪改用明確 `/forge-runtime retry` 與有界 attempt recovery。本檔不代表新 Plan A 已實作。

## 已完成項目

- `continue` replay 重送同一 round、snapshot manifest 與既有 `decisionSummary`，不新增 decision／round／snapshot。
- 無 `sendUserMessage` 時，selector、`confirm`、`reject` 保持 `WAIT_USER`；正常 followUp reentry 仍建立下一 Grill round。
- 無 `newSession` 或 replacement 回傳 `cancelled` 時，switch 保留原 workflow、Grill gate 與 active tools；成功 replacement 才清理舊 workflow。
- 正常 Grill prompt 改為 completion-tool-only；成功 `READY_FOR_DEEP` completion 會還原先前 active tools。
- 缺 tool-boundary capability 時，拒絕啟動或重播 Grill，避免 prompt-only 的不可強制工具面。
- 新 snapshot 首輪 completion 強制至少一筆 fetched evidence；同一 snapshot 的後續 round 可重用 cache，並有 session-level 回歸測試。
- completion validator 強制 `NEEDS_CONFIRMATION` 恰一題與 `READY_FOR_DEEP` 零題；continue 無 bridge 安全停留，cancel 清空所有 pending closure marker。

## 重要決策

- `/grill-run` 是歷史命令相容 alias，會正規化進 formal ingress 並建立正式 round／snapshot；它不是獨立 ingress 或 bypass lifecycle。
- trust boundary 缺失時安全停留，不直接推進 workflow；此決定適用 followUp、newSession 與 tool-boundary capability。

## 修改檔案

- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/src/grill/grill-skill.ts`
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `forge-runtime/tests/grill/grill-skill.test.ts`
- `CONTEXT.md`
- `docs/PLAN-A.md`
- `docs/handoff.md`
- `docs/adr/ADR-0006-grill-readonly-candidate-verification.md`
- `docs/adr/ADR-0007-grill-completion-tool.md`

## 測試結果

- 所有新增／調整 safety 與 final-review slices 均先有紅燈，再轉綠；selector fallback 為既有實作的補充 coverage，直接綠燈。
- 獨立完整驗證：`cd forge-runtime && npm test` 為 97/97 通過。
- 獨立型別驗證：`cd forge-runtime && npm run check` 通過。
- final review 的 Standards 與 Spec findings 已修正並以完整驗證覆蓋。

## 未解問題

- workspace root 與 `forge-runtime/` 沒有 Git repository／基線，無法判定中斷前檔案是否有未回報局部寫入，也無法做 diff-based final review。
- `/grill-run` 在本 ticket 當時已透過 formal ingress 建立正式 round／snapshot；尚未涵蓋的是 completion omission 後的有界 attempt recovery（明確 retry／cancel／switch、no-steer 與 settled），後續由 ADR-0008 與新 Plan A 定義。

## 下一步

- 本 ticket 已完成；新工作以 `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md`、ADR-0008 與新 Plan A 為準。不得沿用本 ticket 的 `continue` omission replay。
