# Forge Runtime v4 交接

日期：2026-08-17

> 目前執行基準以「2026-08-20 修訂中的有效」段落為準；本段之前是歷史完成紀錄。

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

---

## 2026-08-20 最終工作：Grill 完成終止邊界與 display-only

### 目標與完成狀態

方案 C 已完成：PI coding-agent `0.83.0`（commit `321bbe6`）新增 display-only custom message，Forge 成功 `forge_grill_complete` 正確封口。使用者已授權修改 `pi-main`；Plan A 已實作完成，不執行 Plan B。READY regression 已完成 characterization GREEN。

### Plan A

依 `docs/PLAN-A.md` 的 direct-plan 執行，沒有 Plan B（這是 core/behavioral gap，無獨立視覺工作）。PI core 五個 production、五個 tests；Forge production/test 兩個；durable docs 七個。方案 C 的 display-only 僅用於成功 `NEEDS_CONFIRMATION` WAIT_USER state message，其他 message 維持現況；排除路徑包含 compaction 與 branch summarization rehydrate。

### 版本政策

唯一支援基線為 coding-agent `0.83.0`、repo `321bbe69e909de9551906967629908a99167d11e`、branch `main`。不建議降版、不保證降版相容、不回填舊 session；舊 PI 不應重開含 display-only 的 session，若必須降版請用新 session。

### 文件與工作檔

`FORGE_RUNTIME_Arch_v4.md`、`CONTEXT.md`、`docs/adr/ADR-0011-grill-completion-terminal-boundary.md`、`docs/adr/ADR-0012-display-only-custom-message.md`、`docs/PLAN-A.md`、`docs/handoff.md`、`agent-state/grill-completion-terminal-boundary-20260819.md`，以及上述 12 個 implementation code/test 檔（含 `pi-main/packages/coding-agent/src/core/compaction/branch-summarization.ts`、`pi-main/packages/coding-agent/test/branch-summarization.test.ts`）。

### 最終驗證與已知風險

Forge `npm test` 132 passed、exit 0（`agent-state/logs/forge-full-test-green-final-20260820.log`）；Forge post-review check/full 均 exit 0（`forge-check-after-review-20260820.log`、`forge-full-after-review-20260820.log`）；Forge interactive 9 passed（`forge-pi-interactive-full-green-20260820.log`）；PI focused 5 files 76 passed／2 skipped、exit 0（`pi-display-only-five-files-final-20260820.log`）；PI Biome 991 files exit 0（`pi-readonly-biome-final-final-20260820.log`）。branch summarization RED／GREEN：`branch-summary-displayonly-red-20260820.log`、`branch-summary-displayonly-green-final-20260820.log`。PI tsgo 僅剩 `packages/ai` 六個 untouched baseline errors（`pi-readonly-tsgo-final-final-20260820.log`），本次 CustomMessage／branch test 無錯；canonical `npm run check` 未跑，因含 `--write`，改跑唯讀子命令。

測試契約：READY 仍自動進 Deep，不要求 idle；NEEDS_CONFIRMATION 以 session/provider marker 等待第二則 user message，不以 roundId viewport 作為唯一觀測點。人類回答流程為 WAIT_USER→USER_CONFIRMED→GRILL；UI/command 先 resume、重用 `pendingReplayInvocation`，再送完整 followUp invocation；direct human input 仍用 transform，避免 nested `emitInput`。

已知風險：queued steer 語意仍 out-of-scope；extension API `send`／`sendUserMessage` fire-and-forget lifecycle 不在本次重定義；Node `DEP0190` warning；PI `packages/ai` 六個 baseline errors；不改 harness、不保證跨 package JSONL。public custom augmentation 已移除，public `CustomMessage`／`CustomAgentMessages.custom` 回到 HEAD，marker 僅 internal intersection。

### 不建置

不做 Plan B、不改 Forge 其他 delivery、不回填舊 session、不提供降版轉換器、不定義 Deep 後新歧義轉移、不使用 `abort()`。

### Final closeout（2026-08-20）

- targeted final review：Standards 0 findings、Spec 0 findings；P2 public union 與 hard `any` finding 均已解決。
- branch summarization final GREEN：`agent-state/logs/branch-summary-final-final-green-20260820.log`，1 passed、0 failed、exit 0。
- no-`any` 後驗證已完成；最新 PI tsgo：`agent-state/logs/pi-tsgo-final-six-baseline-20260820.log`，僅剩 `packages/ai` 六個 untouched baseline errors。
- 新測試使用具體 `Model<"openai-completions">`，無 `any`；`Model.cost`／`Usage.cost` fixture 已使用正確結構。
- modified files 清單包含 `pi-main/packages/coding-agent/src/core/compaction/branch-summarization.ts` 與 `pi-main/packages/coding-agent/test/branch-summarization.test.ts`。

### 最終狀態與下一步

Plan A completed，無待實作。下一步僅由使用者決定 commit／PR，或是否後續處理 `packages/ai` baseline 與其他 out-of-scope 風險；Plan B 未執行。
