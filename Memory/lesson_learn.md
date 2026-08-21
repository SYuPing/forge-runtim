---
title: Forge Runtime v4 開發教訓
type: lessons-learned
scope: 已發現的 bug、根因、修復方式與可重用工程教訓
updated: 2026-08-21
source: 本 repo 的 agent-state、ADR、Plan、handoff 與測試證據
status: active
---

# Forge Runtime v4 開發教訓

## 使用方式

本文件只記錄「發現什麼問題、根因是什麼、如何修復、下次怎麼避免」。每筆教訓都應附可核對的檔案或測試證據；沒有證據時只記錄觀察，不把假設寫成結論。開發目標與重大實作請查 [`record.md`](./record.md)。

本輪文件整理未發現新的 runtime bug；以下內容是從原記憶錄重新分類的既有問題與教訓。

## Bug 與修復索引

1. **TypeBox loader 假綠燈**：source CLI direct import 的 assertion 在舊程式碼即通過，沒有走真實 loader。改用 global compiled `pi` bootstrap probe，並只在 Forge package 使用 `typebox/compile`；證據：`agent-state/typebox-loader-compatibility.md`。
2. **過時 omission 測試**：舊測試期待 `continue` replay，但 ADR-0008 已改為 `retry/cancel/switch`。刪除 stale test，先確認測試是否仍代表現行 contract；證據：`docs/adr/ADR-0007-grill-completion-tool.md`、`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md`。
3. **focused test 參數順序錯誤**：第一次命令執行整個檔案，不能當作 focused RED/GREEN。修正 test-name pattern 與命令順序後才採用 1/1 結果；證據：同上 agent-state。
4. **upstream terminal option 型別錯誤**：加入 test-only Terminal seam 後出現型別錯誤。修正 seam 型別後，剩餘 `packages/ai/test/*` 錯誤確認為既存 baseline，不歸因於 Forge；證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md`。
5. **fixture 違反 evidence invariant**：非空 manifest 配空 evidence 觸發首輪 guard。補上真實 candidate/evidence fixture，不放寬 production guard；證據：同上 agent-state。
6. **測試通過後不退出**：`InteractiveMode.run()` 是永久 production loop。runner 使用 `--test-force-exit`，不以 runtime `abort()` 解決；證據：`docs/PLAN-A.md`。
7. **full suite 並行 timeout**：loader smoke 在並行負載下觸發 30 秒 timeout。將 test runner 改為 `--test-concurrency=1`，保留 timeout 安全界線；證據：`docs/PLAN-A.md`、同上 agent-state。
8. **非 active attempt 未 fail-closed**：兩個 Grill tool 的 gate 不完整。補上 `pendingGrillRun && stage === GRILL` 共用 gate 與 execute guard；證據：同上 agent-state。
9. **panel payload 不可見**：raw payload 的 `content` 與 `display` 不符合契約。三個出口統一使用完整 `panelText` 與 `display: true`；證據：同上 agent-state。
10. **prompt 與 validator drift**：舊 prompt 要 assistant 輸出問題，與 completion-tool-only 契約衝突。改 prompt 並以 runtime validator 強制 question cardinality；證據：同上 agent-state。
11. **空 manifest 不可完成**：evidence invariant 無條件套用空 manifest。只在空 manifest、首輪、`NEEDS_CONFIRMATION` 且無 evidence 時改走唯一 scope question；證據：同上 agent-state。
12. **provider invocation 被顯示 rewrite 破壞**：user `message_end` 把完整 invocation 改回原始 request，使 provider 看不到 completion contract。移除 `pendingUserMessageRewrite`，以 provider-context 測試固定三條路徑；證據：`docs/handoff.md`、`agent-state/grill-invocation-transport-integrity-20260817.md`。
13. **合法 continuation 被誤判為 turn leak**：streaming fixture 會產生合法 tool-result continuation，第二次 provider call 不能單獨證明洩漏。改以 session/provider marker 驗證 READY 與 NEEDS regression；證據：`agent-state/grill-completion-terminal-boundary-20260819.md`。
14. **顯示抑制被誤當成回合終止**：完成後不顯示 prose 不代表代理回合停止。改由 `forge_grill_complete` 回傳 `terminate: true`，移除 `suppressCompletionTurn`；證據：`docs/adr/ADR-0011-grill-completion-terminal-boundary.md`。
15. **display-only context 洩漏風險**：只改 UI 不能同時保留 transcript/persistence 又排除 provider。新增 `deliverAs: "displayOnly"` 與 `excludeFromContext`，並覆蓋 conversion、compaction、branch summarization、session round-trip；證據：`docs/adr/ADR-0012-display-only-custom-message.md`。
16. **public 型別與測試 `any` 過度擴張**：final review 發現 public custom augmentation 與 hard `any`。移除 public augmentation，marker 留在 internal intersection，測試改用具體 `Model<"openai-completions">` 與正確 cost fixture；證據：`docs/handoff.md`。

## 可重用教訓

- 先驗證 host 的真實 callback contract，再建立 adapter；名稱相似不代表介面相同。
- 測試必須走實際 distribution path、factory、render path 與 provider transport；fake harness 只能證明局部 wiring。
- focused、full、static、scripted TUI 與人工驗收是不同層級證據，不能互相替代。
- invariant 必須精確限定適用集合；安全規則若寫成總規則，可能把正常流程變成永遠不可完成。
- 同一狀態只保留一個 owner；dedupe 與 fail-closed guard 應放在共用 seam，不要由每個 caller 各自補防護。
- provider contract 要直接檢查 provider 實收內容；state machine、畫面與 transcript 都不能代替 transport assertion。
- 完成終止必須有明確 lifecycle 訊號；prose suppression 只能控制顯示，不能代替 termination。
- display-only 必須同時驗證可見性、持久化、provider conversion、compaction 與 branch summarization；舊 session 缺 marker 時維持舊語意。
- 未證明根因前，只記錄觀察到的失敗與已排除項目；不要把 OOM、host mismatch 或 baseline error 寫成未驗證結論。

## 已 supersede 的契約

- ADR-0007／ADR-0003 的 omission `continue` replay 已由 ADR-0008 的 `retry/cancel/switch` 取代；一般 active workflow 的 `continue` 仍保留，但 recovery 中拒絕。
- 正常 completion 的 assistant terminal JSON 已由 `forge_grill_complete` 取代；`/forge-runtime grill-result` 僅保留 debug injection。
- Plan B 固定 widget tree 尚未完成，不能用 Plan A TUI acceptance 宣稱 UI tree 已完成。
