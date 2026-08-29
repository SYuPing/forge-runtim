# ADR-0012：僅顯示自訂訊息

## 狀態

已核准（2026-08-20）

## 背景

Grill 成功完成後，`NEEDS_CONFIRMATION` 必須讓使用者看到 WAIT_USER state message，且訊息要進入 transcript 與 session persistence；但它不能再次觸發 turn，也不能進 provider／LLM context。只靠 `display` 或 Forge 端 rewrite 無法同時保留這些語意。

## 決策

採方案 C：PI coding-agent core 新增真正的 display-only custom message。ExtensionAPI delivery option 使用 `deliverAs: "displayOnly"`，優先於 `triggerTurn`／`steer`／`followUp`／`nextTurn`。訊息仍進 UI、transcript、session persistence/reload，但永不排入 provider／LLM context、永不觸發 turn。

持久 marker 使用 `excludeFromContext?: boolean`；display-only 建立時為 `true`。新版本讀取缺少 marker 的舊 session 時維持舊語意，不重用 `display` 欄位。Forge 只有成功 `forge_grill_complete` 的 `NEEDS_CONFIRMATION` WAIT_USER state message 使用此 delivery；其他 message 維持現況。

## 拒絕的替代方案

- **方案 A：沿用 `nextTurn`**：訊息仍會進模型，無法滿足 display-only 的 context 邊界。
- **方案 B：Forge 端只做顯示、不持久化**：會失去 panel、transcript 或 session persistence 的必要語意。

## 影響

- WAIT_USER state message 可見、可回放、可持久化，且不會自行觸發模型回合。
- `excludeFromContext` 成為新的 session message contract；讀取路徑、轉換與 compaction 必須一致排除。
- 這是窄化的 core 例外，增加對 coding-agent `0.83.0` 內部 message/session 路徑的相依；terminate 仍可能被 queued steer 延續。

## 相容性／版本政策

唯一支援基線是 PI coding-agent `0.83.0`，repo commit `321bbe69e909de9551906967629908a99167d11e`（`321bbe6`），branch `main`。不建議降版、不保證降版相容、不回填舊 session。舊 PI 不應重開含 display-only 訊息的 session；若必須降版，使用新 session。

新版本讀舊 session（缺少 `excludeFromContext`）維持舊語意；不提供舊 session 回填或轉換器。

## 實作同步（2026-08-20）

- `displayOnly` 已落在 public delivery union；streaming 不 steer/followUp、不 trigger turn，但仍 append/event/persist。
- `excludeFromContext` 已通過 provider conversion、compaction rehydrate、branch summarization rehydrate、session-file round-trip；不修改 agent harness wire。public `CustomMessage` 與 `CustomAgentMessages.custom` 維持 HEAD 既有形狀，marker 僅存在於 internal intersection。
- Forge 只將 successful `NEEDS_CONFIRMATION` WAIT_USER state message 以此 delivery 傳送，其他 state 不擴張。Plan A 已完成，Plan B 未執行。
- 最終驗證：PI focused 5 files 76 passed／2 skipped；Biome 991 files exit 0；branch summarization 先以 `branch-summary-displayonly-red-20260820.log` 捕捉 marker leak，再以 `branch-summary-displayonly-green-final-20260820.log` 通過。PI tsgo 僅剩 `packages/ai` 六個 untouched baseline errors；本次 CustomMessage／branch test 無錯。Forge 132 passed、check exit 0。

## Post-review 同步（2026-08-20）

- Spec review 的 P2 已修正：移除 public custom augmentation；public `CustomMessage` 與 `CustomAgentMessages.custom` 回到 HEAD，只有 internal intersection 保留 `excludeFromContext` marker。
- branch summarization 也屬排除路徑，不只一般 compaction：rehydrate 必須保留 marker，summarizer 的 provider conversion 不得洩漏 display-only 內容。
- 最終 Standards／Spec review 均無未解 findings；下一步為 targeted re-review 與 final handoff。

## 範圍／不建置

- 只改 coding-agent ExtensionAPI／session 路徑；`packages/agent/src/harness/*` 不改，跨 package 共用 JSONL 不保證。
- 不改 Forge 其他 command、retry、cancel、switch、deep knowledge 或一般 state message 的 delivery。
- 不 fork PI、不提供降版相容層、不回填舊 session、不新增視覺 UI polish。

## 窄化例外同步（2026-08-27）

本 ADR 的 `displayOnly` 契約仍只描述 delivery 語意。Forge 本輪新增的窄化例外是：只有初始 Deep stage panel 使用 `displayOnly`，避免它成為 steer；input handler 僅預載本回合 Deep tools，不消費 pending identity，必須等 matching user `message_start` 才消費。pending identity 存在期間，Deep tool_call fail-closed。其他 Deep delivery 與 semantic contract 不變；此例外不改動 WAIT_USER 或一般 state message。

本輪自動化驗證為 extension 117/117、PI integration 10/10、完整 `npm test` 212/212、`npm run check` exit 0。真實 PI 目前僅完成啟動 smoke check，尚未捕捉原始 stale 情境的輸入與結果。

## 歷史決策被取代（2026-08-29）

本 ADR 原先要求 WAIT_USER `displayOnly` 訊息進入 transcript、session persistence 與 reload panel；該要求由 [`ADR-0020`](ADR-0020-wait-user-ui-only-state-publication.md) 取代。原決策與其實作歷史保留供追溯；目前 WAIT_USER 不再以本 ADR 的 persistence 要求作為下一 ticket 的實作目標。
