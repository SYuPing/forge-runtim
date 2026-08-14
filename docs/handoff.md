# Forge Runtime v4 Handoff

日期：2026-08-13

## 目前狀態（2026-08-14，Plan A 完成）

- 舊 Plan A（Grill 工具化多輪迴圈與 TypeBox loader compatibility）已完成；既有獨立驗證 baseline 為 `npm test` 99/99、`npm run check` 通過。
- 本輪 Plan A #1–#17、完整驗證與 final review 已完成；當前 0 open findings。下一步自動執行 Plan B，Plan B 尚未完成。
- production 修改：`forge-runtime/src/runtime/session-state.ts` 的 per-attempt omission budget／record／retry seam，以及 `forge-runtime/extensions/forge-runtime.ts` 的 omission settle、restore tools、recovery continue 拒絕與明確 retry followUp。
- P1 1/1、TUI 4/4、`npm run check`、`npm test` 114/114 均 exit 0；upstream seam Vitest 4/4，upstream check 僅剩既有 `packages/ai` 測試型別錯誤。`116` 只是原始預估，不是實測 gate。
- `docs/PLAN-B.md` 只同步 UI／互動 acceptance，不形成另一個 approval gate。

## 已核准 contract

1. 每個 Grill attempt 首次漏呼叫 `forge_grill_complete` 時，記錄一次 omission／已進 recovery；同 attempt 不得重複進 recovery。
2. omission 後立即進 `GRILL + RECOVERY_REQUIRED` 並 settled；`RECOVERY_REQUIRED` 是 substate／marker，不是 top-level stage。`message_end` 不 steer、不自動 replay、不自動 Deep；只顯示 retry／cancel／switch。
3. 只有明確 `/forge-runtime retry` 可用同 round／snapshot 建立新 attempt；`continue` 不再承擔 omission recovery。
4. `NEEDS_CONFIRMATION` 立即顯示唯一問題並進 `WAIT_USER`，回答後自動下一 Grill round；`READY_FOR_DEEP` 立即自動 Deep。
5. 可見 panel 固定使用 `content: panelText`、`display: true`；prompt 不得輸出 assistant prose，需要確認時只由 completion payload 提交恰好一題。
6. 空 manifest 可零 evidence 提交來源／scope 問題；relevance gate 失敗必須顯示可回答問題並進 `WAIT_USER`。
7. 完成 gate 必須包含真實 PI TUI：問題可見、回答後下一 round、READY 自動推進、每 attempt omission recovery 一次且 session settled、單次輸入 assistant turns 有界。

## 執行計畫

- 下一步自動執行 `docs/PLAN-B.md`；不得把 Plan B 誤寫為已完成。
- 歷史測試順序：先由獨立測試子代理確認紅燈，再由獨立實作角色修改 production code。
- 新 Plan A 明列 17 條測試；`116` 是預估而非硬 gate，不能當作目前 suite 結果。
- Plan A 已完成獨立驗證與 final review；後續 Plan B 仍須維持角色分離。

## 相關文件

- `CONTEXT.md`
- `docs/adr/ADR-0008-grill-completion-recovery-and-interactive-acceptance.md`
- `docs/adr/ADR-0007-grill-completion-tool.md`（omission recovery 部分已 superseded）
- `docs/PLAN-A.md`
- `docs/PLAN-B.md`（只含互動 acceptance 同步）
- `agent-state/grill-completion-recovery-interactive-acceptance-20260813.md`
- `agent-state/grill-resume-replay.md`（歷史 ticket；不得沿用 continue omission replay）

## Not Building

- 不修改 `pi-main/`。
- 不新增 top-level recovery stage、第三種 completion status、自動 retry、background steer、queue 或 parallel workflow。
- 不重做 PI TUI 或實作固定 widget tree。
- 不深化 Deep Knowledge、candidate scoring 或知識來源。

## 風險與 Fragile Assumption

- 真實 PI TUI acceptance 需要可控的 completion／omission 回應。若 provider 不穩定，必須建立仍走真 PI TUI／Forge extension lifecycle 的受控 seam；fake harness 不能替代。
- workspace root 沒有 Git baseline，無法提供 root-level diff review；需依指定檔案、測試與 runtime evidence 審查。

## 下一個 session 的第一步

先讀本檔、`CONTEXT.md`、ADR-0008、`docs/PLAN-A.md` 與 state；呼叫 `execute-designed-plan`／TDD 恢復。先 CodeGraph 唯讀探索，再由測試角色對 #8 打 RED，執行角色確認後，production role 做最小 GREEN。

建議起手訊息：

```text
請閱讀 docs/handoff.md、CONTEXT.md、docs/adr/ADR-0008-grill-completion-recovery-and-interactive-acceptance.md 與 docs/PLAN-A.md，先向我展示 context 摘要並等待我確認；確認後呼叫 Skill(execute-designed-plan)，先由測試子代理打紅再實作。
```
