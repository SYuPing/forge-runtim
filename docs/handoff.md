# Forge Runtime v4 交接

日期：2026-08-17

## 目標與目前狀態

修正 Grill invocation 在 provider 執行前被 user `message_end` rewrite 改回原始 request 的缺陷。三條 production slice、post-review-fix 驗證與 final review 已完成：Standards 0 findings、Spec 0 findings；本 ticket closure 完成。

Runtime probe 已確認：首個 Grill provider request 的最後 user message 等於 `實作spi rtl`，不含 Grill completion 規則；active tools 仍只有 `forge_grill_evidence` 與 `forge_grill_complete`。因此 `RECOVERY_REQUIRED` 是 omission detector 的正確結果，根因位於 invocation transport，而不是 recovery state transition。

## 已完成與下一步

已執行 `docs/PLAN-A.md` 的「2026-08-17 Active Follow-up：Grill 呼叫傳輸完整性」，不執行 Plan B。本 ticket 無剩餘工作；獨立 future：設計 display message／provider message 分離 seam，需另走 `design-plan-workflow` 並取得人類決策。

已採用最小根因修正：移除 `pendingUserMessageRewrite` 及 user `message_end` replacement，讓完整 Grill invocation 同時作為 finalized user message 與 provider payload。

## 相關文件與實際修改檔

- `FORGE_RUNTIME_Arch_v4.md`
- `CONTEXT.md`
- `docs/adr/ADR-0005-grill-terminal-result-lifecycle.md`
- `docs/adr/ADR-0007-grill-completion-tool.md`
- `docs/adr/ADR-0008-grill-completion-recovery-and-interactive-acceptance.md`
- `docs/PLAN-A.md`
- `docs/PLAN-B.md`（只記錄本 ticket 不屬於 UI scope）
- `agent-state/grill-invocation-transport-integrity-20260817.md`
- 實際正式修改：`forge-runtime/extensions/forge-runtime.ts`
- 實際測試修改：`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`

## 已確定決策與實作事實

- 不修改 `pi-main/`。
- 不修改 retry／cancel／switch、settled、completion omission 或 auto-retry policy。
- 不新增 provider hook、message abstraction 或 UI presentation seam；已移除 `pendingUserMessageRewrite` 宣告、三個 setter、clear 與 user `message_end` replacement。
- 已由測試先打出 provider-context RED，再完成最小修改與三條 targeted GREEN；首輪 review findings 已修正，final review 已完成：Standards 0 findings、Spec 0 findings。

## 不建置

- 不保證 transcript 繼續只顯示原始短 request；v1 優先保住 provider contract。
- 不處理紀錄中 `$ ls -la` 究竟由 global PI host 或外層工具邊界執行；若 prompt 修正後仍能重現，再另開 runtime-boundary ticket。
- 不重開已完成的 Plan A #1 至 #17 或 WAIT_USER ticket。

## 已知缺口、風險與脆弱假設

- 脆弱假設：目前 session history 顯示完整 Grill invocation。使用者已明確要求將「顯示訊息」與「送給 provider 的訊息」分離列為後續設計待辦；不屬本 ticket scope、尚未核准或實作，需另走 `design-plan-workflow` 並取得人類決策。
- 現有測試覆蓋 recovery 與 fake tool gate，但過去沒有斷言 provider 實收的 user message；本 Plan 以三條真 PI/Faux provider-context 測試補上。
- 實際紀錄中的成功 `ls -la` 無法由目前本機整合 probe 重現；本次先修已證明會造成 omission 的 prompt transport 根因，不擴張到未證實的 host mismatch。

## 既有驗證證據

- `session-state.test.ts`：7 通過、0 失敗。
- `forge-runtime-extension.test.ts`：80 通過、0 失敗。
- omission 真 PI TUI 精準案例：1 通過、0 失敗。
- 暫時性 first-turn tools probe：1 通過，provider tools 只有兩個 Grill tools，偽造 bash 得到 `Tool bash not found`。
- 暫時性 provider-message probe：1 通過，證明最後 user message 被改回原始 request。
- 上述暫時測試均已刪除；三個實際 provider-context 測試 post-cleanup targeted batch 為 3 pass、0 fail。post-review-fix full PI TUI 為 7 pass／0 fail／0 skip；canonical `npm test` 為 130 pass／0 fail／0 skip；`npm run check` 兩段 tsc 均 pass、no diagnostics。首次 canonical 130/1 是 obsolete original-transcript rewrite test，刪除後已重跑為 130/0；final review Standards／Spec 均 0 findings。

## 下一步

本 ticket 無剩餘工作。獨立 future：設計 display message／provider message 分離 seam，需另走 `design-plan-workflow` 並取得人類決策；目前未核准。
