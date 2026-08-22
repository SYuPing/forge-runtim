---
title: Forge Runtime v4 開發記錄
type: development-record
scope: 開發目標、重大決策、實作里程碑與目前狀態
updated: 2026-08-22
source: 本 repo 的架構文件、ADR、Plan、handoff 與 agent-state
status: complete
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

## 2026-08-22 Light Discovery 設計核准（當時設計階段狀態）

- 目標：建立 `start_forge → Light Discovery` 的單一可插入流程，依原始 `userMessage` 在 `wiki/` 與 `code_base/` 找出候選檔名／metadata。
- 重大決策：對外只有 workspace/root 與 raw message 的 public seam；內部固定 Input normalization → deterministic Core → Output normalization；每來源最多 3 筆且固定排序。
- 重大邊界：只輸出 matches 與 warnings/source availability；metadata 僅 `source`、`relativePath`、`fileName`、`extension`；不做全文、不回傳 full-content／summary／Pattern Card／Grill snapshot／決策；不搜尋 target source、docs、Memory、pi-main 或 OS。
- 相容決策：既有 Grill 所需 full-content/snapshot 由模組外部 adapter 暫時提供；既有 extension seed extraction 於實作時移入 Light Discovery module，caller 只傳 raw message。
- 當時設計階段狀態：設計已核准，尚未實作或驗證。後續 current completion 見下方「2026-08-22 Light Discovery 實作與驗證」。詳細決策見 [`ADR-0014`](../docs/adr/ADR-0014-light-discovery-file-metadata-module.md)，執行計畫見 [`docs/PLAN-A.md`](../docs/PLAN-A.md)。

## 來源索引

完整決策與證據見 `FORGE_RUNTIME_Arch_v4.md`、`CONTEXT.md`、`docs/PLAN-A.md`、`docs/PLAN-B.md`、`docs/adr/`、`docs/handoff.md` 與 `agent-state/`。本文件不重複收錄逐筆 bug；請查閱 [`lesson_learn.md`](./lesson_learn.md)。

## 2026-08-21 Intent route-only LLM

- 目標：將使用者輸入到 Intent Understanding 收斂為單一 route contract，降低修改 A 影響 B 的風險。
- 重大實作：LLM 僅輸出 `passthrough`／`start_forge`；路由規則與 raw input 分離，`IntentModelContext` 是唯一第二參數 seam，`IntentInput` 不含 model context；workflow guard、10 秒 fail-closed、rawText 保留、`/grill-run` canonical wrapper、extension handoff private seed helper 與 faux provider queue／route call-count 調整已完成；未修改 `pi-main/`。
- 驗證：intent 12/12、extension 91/91、loader 2/2、`npm run check` exit 0、`npm test` 146/146；證據位於 `.tmp/intent-route-only-systemprompt-*.log`。
- 2026-08-22 最終審查通過：Standards 與 Spec final review 均為 0 findings；本 ticket acceptance／closure 完成。下一步只能等待使用者確認後再進入 Light Discovery。詳細決策見 [`ADR-0013`](../docs/adr/ADR-0013-intent-route-only-llm.md)，狀態見 [`agent-state/intent-route-only-llm-20260821.md`](../agent-state/intent-route-only-llm-20260821.md)。

## 2026-08-22 Light Discovery 實作與驗證

- 使用者核准 ADR-0014 第一階段並完成實作：`wiki/`、`code_base/` metadata-only discovery，各來源最多 3 筆、相對路徑 deterministic，輸出 warnings/sourceAvailability；缺失來源人工核准流程保留。
- public seam 只收 rootDir 與 raw userMessage；相容 adapter 留在 `forge-runtime.ts` 外部，負責 Grill／Deep Knowledge 所需內容與 relevance 計算，未擴大 Light Discovery contract。
- 測試遷移清除 2 個 stale callers、移除 10 個淘汰測試、改寫／保留 5 個並還原 2 個強相關 Deep expectations。production bug 已修復：adapter 依 raw request seeds 計算 path/content、`matchedSeeds`、`score`。
- 驗證：互動 9/9、focused 79/79、`npm run check` exit 0、完整 `npm test` 140/140，0 fail/skip/todo；證據為 `forge-runtime/.tmp/review-fix-verify-*.log`。implementation、verification 與 two-axis review 均完成；僅有既有 Node `DEP0190` warning。
- 依使用者於 2026-08-22 核准的 v4 分階段交付例外，本輪僅完成 phase one 的 metadata-only discovery；v4 end-state 不變，完整多來源／Summary／Evidence ID 另案處理。
- 初次 Standards 與 Spec review 各有 3 個 findings；採納修正後 Spec re-review 為 0 findings，Standards re-review 的 stale counts 已完成文件修正。
