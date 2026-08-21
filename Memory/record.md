---
title: Forge Runtime v4 開發記錄
type: development-record
scope: 開發目標、重大決策、實作里程碑與目前狀態
updated: 2026-08-21
source: 本 repo 的架構文件、ADR、Plan、handoff 與 agent-state
status: active
---

# Forge Runtime v4 開發記錄

## 文件用途

本文件只記錄開發目標、重大設計決策、實作過程、驗證結果與目前狀態。錯誤根因、修復方式與可重用教訓集中在 [`lesson_learn.md`](./lesson_learn.md)，避免兩份文件各自形成不同真相。

## 開發目標與架構基線

- 在 `forge-runtime/` 建立 Workflow Sovereignty、evidence-driven、knowledge-first 的 runtime。
- 由 Workflow 控制 state transition；LLM 只負責理解、推理、候選與寫碼；`WAIT_USER` 是人類決策邊界。
- 以 PI package、extension、skill 承載功能，預設不修改 `pi-main/`；只有明確核准的 test-only Terminal seam 與 ADR-0012 display-only core 路徑例外。
- 第一階段先完成 workflow kernel、state machine、mandatory stages、evidence traceability、validation loop；完整 UI 與大型知識平台不在第一階段。

主要依據：`FORGE_RUNTIME_Arch_v4.md`、`CONTEXT.md`、`docs/adr/ADR-0001-forge-runtime-v4-foundation.md`、`docs/PLAN-A.md`。

## 重大實作時間線

### 2026-08-07 至 2026-08-10：Foundation、Router 與最小 UI

- 建立 `forge-runtime/` package 與 workflow kernel。
- 固定 front-door router、單一 open workflow、`WAIT_USER` 優先、Light Discovery、Deep Knowledge gate 與 evidence traceability。
- 以 PI 既有 status、custom message 與 selector 完成 Plan B 最小 UI slice；固定 widget tree、完整 dashboard 與常駐 evidence/validation widget 留待後續決策。

### 2026-08-09 至 2026-08-16：Grill control、completion 與互動驗收

- 完成 active workflow control、candidate snapshot、唯讀 evidence verification、completion tool 與 completion omission recovery。
- `forge_grill_complete` 成為正常 completion 唯一入口；`NEEDS_CONFIRMATION` 進 `WAIT_USER`，`READY_FOR_DEEP` 通過 gate 後自動進 Deep。
- 完成 `/retry`、`cancel`、`switch` recovery 邊界、固定「自行輸入…」入口、四參數 `ctx.ui.custom` factory 與真實 PI TUI test-only Terminal seam。
- Plan A #1 至 #17 完成，包含真實 TUI、單次輸入 turn boundary 與 omission settled 驗收。

### 2026-08-17：Grill invocation transport

- 移除會把完整 Grill invocation 改寫回原始 request 的 `pendingUserMessageRewrite` 路徑。
- 讓完整 invocation 同時成為 finalized user message 與 provider payload，並以三條 provider-context 測試固定傳輸契約。

### 2026-08-19 至 2026-08-20：完成終止邊界與 display-only

- 使用者核准方案 C 與窄化 `pi-main` core 例外；支援基線為 coding-agent `0.83.0`、commit `321bbe6`、branch `main`。
- 成功 `forge_grill_complete` 回傳 `terminate: true`，移除只抑制完成 prose 的 `suppressCompletionTurn`。
- PI ExtensionAPI 新增 `deliverAs: "displayOnly"`：訊息進 UI、transcript、session persistence/reload，但不進 provider context，也不觸發 turn。
- 以 `excludeFromContext: true` 貫通 provider conversion、compaction rehydrate、branch summarization rehydrate 與 session-file round-trip；舊 session 缺 marker 時維持舊語意。
- Forge 只在成功 `NEEDS_CONFIRMATION` 的 `WAIT_USER` state message 使用 display-only；`READY_FOR_DEEP` 仍自動進 Deep。
- 人類回答流程固定為 `WAIT_USER → USER_CONFIRMED → GRILL`：先 resume、重用 `pendingReplayInvocation`，再送完整 follow-up invocation；direct human input 仍走 transform。

主要依據：`docs/adr/ADR-0011-grill-completion-terminal-boundary.md`、`docs/adr/ADR-0012-display-only-custom-message.md`、`agent-state/grill-completion-terminal-boundary-20260819.md`。

## 驗證與交付狀態

- Forge：`npm test` 132 passed；interactive 9 passed；post-review check/full exit 0。
- PI focused display-only 測試：76 passed／2 skipped；Biome 991 files exit 0；branch summarization final 1 passed。
- PI tsgo 僅剩 `packages/ai` 六個既有 baseline errors；canonical `npm run check` 未執行，因該命令含 `--write`，改用唯讀子命令。
- 最終 Standards／Spec review 均為 0 findings；Plan A 已完成，Plan B 未執行。

## 目前狀態與邊界

- 已完成：Plan A #1 至 #17、Grill invocation transport、completion terminal boundary、display-only contract。
- Plan B 僅完成 status/custom-panel/selector 最小 slice；固定 widget tree、常駐 evidence/validation/repair widget 與人工視覺驗收仍未完成。
- 不新增 top-level recovery stage、第三種 completion status、自動 retry、background steer、queue、parallel workflow 或 Deep 後新歧義轉移。
- `pi-main/` 只保留核准的 test-only Terminal seam 與 ADR-0012 display-only core 路徑；其他 core 變更禁止。
- 未解風險：queued steer、extension API fire-and-forget lifecycle、Node `DEP0190` warning、`packages/ai` 六個 baseline errors。

## 來源索引

完整決策與證據見 `FORGE_RUNTIME_Arch_v4.md`、`CONTEXT.md`、`docs/PLAN-A.md`、`docs/PLAN-B.md`、`docs/adr/`、`docs/handoff.md` 與 `agent-state/`。本文件不重複收錄逐筆 bug；請查閱 [`lesson_learn.md`](./lesson_learn.md)。
