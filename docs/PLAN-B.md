# Plan B：Forge Runtime v4 UI 與 WAIT_USER 體驗層

日期：2026-08-10

Prerequisite（若有）

- `docs/PLAN-A.md` 必須先完成，因為 UI 只能建立在已穩定的 workflow contract 之上。

---
Building

- 為 Forge extension 補上 workflow 狀態顯示與 `WAIT_USER` 互動面板。
- 提供 evidence / decision / current state 的最小 widget 呈現。
- 提供讓使用者對 ambiguous decision 做確認的 command 或 UI interaction。
- 補上 planning / validation / repair 狀態的可視化提示，讓 session 內可觀察目前 stage。

Not Building

- 不重做 PI 全域 TUI。
- 不做完整 Web 前端。
- 不做複雜動畫或過度裝飾。
- 不做獨立 session dashboard。
- 不做跨專案 observability 平台。

---
Approach

[Gap 1 - Workflow Status Widget]

在 extension 入口旁建立最小 widget，顯示目前 stage、上一個 evidence package、是否等待使用者。這個 widget 只讀 runtime 狀態，不自行推動 transition，避免把控制權再放回 UI。
Fragile assumption：Extension UI API 能穩定呈現 stage 與更新事件，不需要改 core rendering pipeline。

[Gap 2 - WAIT_USER Interaction]

把 `WAIT_USER` 做成明確的 UI / command flow：顯示問題、選項、推薦與 evidence id，等使用者確認後再回寫 orchestrator。重點不是做花俏介面，而是把 human decision boundary 顯性化。
Fragile assumption：PI 既有 command / editor replacement / widget 組合足以完成確認互動。

[Gap 3 - Validation / Repair Feedback]

在同一組 UI 中顯示 validation fail 的 root cause 類別與 rollback target，讓使用者知道系統為何退回哪個 stage，避免 runtime 看起來像無條件重試。
Fragile assumption：Plan A 已提供結構化 validation/review/judge 結果可供 UI 消費。

---
Files

┌──────────────────────────────────────────────────────────────┬──────────────────────────────────────────────┐
│ 檔案                                                         │ 變動                                         │
├──────────────────────────────────────────────────────────────┼──────────────────────────────────────────────┤
│ forge-runtime/extensions/forge-runtime.ts                    │ 修改，掛入 widget / command / UI state       │
│ forge-runtime/src/ui/workflow-status-widget.ts               │ NEW，stage/status 顯示                        │
│ forge-runtime/src/ui/wait-user-panel.ts                      │ NEW，顯示 ambiguity 與確認選項                │
│ forge-runtime/src/ui/evidence-summary-widget.ts              │ NEW，顯示 evidence / decision 摘要            │
│ forge-runtime/src/ui/validation-repair-widget.ts             │ NEW，顯示 fail 類型與 rollback target         │
│ forge-runtime/src/ui/ui-state.ts                             │ NEW，集中 UI state mapping                    │
└──────────────────────────────────────────────────────────────┴──────────────────────────────────────────────┘

共 6 個檔案（5 新增 + 1 修改）

View 層結構

```text
Forge Runtime Extension UI
└── Session Widgets Stack
    ├── WorkflowStatusWidget  ← 顯示目前 stage、是否 idle、是否等待確認
    ├── WaitUserPanel         ← 顯示 question、options、recommendation、evidence
    ├── EvidenceSummaryWidget ← 顯示目前 decision 與 citation 摘要
    └── ValidationRepairWidget← 顯示 fail 類別、rollback target、最新 repair 狀態
```

操作按鈕規格表

```text
┌──────────────┬──────────────────────────────────────────────┬──────────────────────────────────────────┐
│ 按鈕         │ 觸發動作                                     │ 狀態/條件 binding                        │
├──────────────┼──────────────────────────────────────────────┼──────────────────────────────────────────┤
│ Confirm      │ 使用者確認選項 -> orchestrator.resume()      │ `state == WAIT_USER` 時可用              │
│ Reject / Back│ 回報需要重新 grill -> orchestrator.rollback()│ `state == WAIT_USER` 時可用              │
│ Show Evidence│ 展開最新 evidence package                    │ 有 evidence package 時可用               │
└──────────────┴──────────────────────────────────────────────┴──────────────────────────────────────────┘
```

視覺驗收清單

- [ ] 頁面載入無例外。
- [ ] 進入任一 workflow state 時，`WorkflowStatusWidget` 會同步顯示正確 stage 名稱。
- [ ] `WAIT_USER` 發生時，`WaitUserPanel` 顯示 question、options、recommendation、evidence id。
- [ ] 使用者按下確認後，狀態從 `WAIT_USER` 進到下一個合法 state，而不是停留原地。
- [ ] Validation fail 時，`ValidationRepairWidget` 顯示 root cause 類型與 rollback target。
- [ ] 任意 state 更新後，evidence / decision 摘要不會殘留上一輪資料。

---
Verification

```text
# 從 repo root
cd forge-runtime && npm run check
# 手動：由子代理以 `pi-main` 啟動 Forge package，走一次 WAIT_USER -> confirm -> resume 流程
# 期望：widget 顯示正確 stage，confirmation 與 rollback 提示皆可見，無 runtime exception
```

---
Implementation Status

- 已完成最小 UI slice：`forge-runtime/extensions/forge-runtime.ts` 現在會透過 `ctx.ui.setStatus()` 發佈 status line，並透過 custom message `display` 輸出 `WAIT_USER` panel。
- 已新增 `forge-runtime/src/ui/ui-state.ts`、`workflow-status-widget.ts`、`wait-user-panel.ts`、`evidence-summary-widget.ts`、`validation-repair-widget.ts` 作為 UI state / text builders。
- 已驗證 `grill ambiguous` 的顯示內容包含 `WAIT_USER`、`Recommendation`、`Evidence`、`Confirm`。
- 已把 `grill ambiguous` 改成 payload 化 command：`/forge-runtime grill ambiguous <json>`，現在 panel 顯示來自 payload，而不是寫死字串。
- 已新增正式 structured result command：`/forge-runtime grill-result <json>`，可直接吃 grill result schema 並轉成 `WAIT_USER` state。
- 已新增正式 schema 檔：`forge-runtime/schemas/grill-result.schema.json`。
- 已新增 `grill-run`：會使用 project-local `grilling` skill 內容，並把 skill 回傳的 structured JSON 轉成 `WAIT_USER`。
- 已把 `grill-run` 改成 input transform 路徑，避免 extension command 快路徑在 one-shot CLI 模式下提早結束。
- 已驗證 `confirm` 在沒有既有 `WAIT_USER` 狀態時會被拒絕，不會假成功。
- 已驗證 selector interaction：當 `ctx.ui.select` 可用時，`WAIT_USER` 會直接拋出 selector，使用者可在 UI 內選 recommendation 或重回 grill。
- 已驗證 structured reject 路徑：若 selector 選非 recommendation，最終會回到 `GRILL`，並顯示被選選項、decision summary、rollback target。
- 已驗證 `grill-run` 在真 RPC session 與 one-shot CLI 內都可觸發 skill flow 並暴露 `WAIT_USER`。
- 目前仍是最小 status/custom-panel + selector 路徑，尚未升級成完整 widget tree。
- 目前 UI 層沒有再往下加料；前段 stage、relevance gate 與 deep executor 已在 Plan A 內接通，Plan B 仍維持「之後再做固定 widget tree」的定位。

待實作

- 將目前的 `WAIT_USER` custom message / status / selector 升級成真正固定區域的 widget tree。
- 讓 widget tree 常駐顯示目前 stage、wait-user 狀態、evidence 摘要、validation / rollback 摘要。
- 讓 selector 與固定 widget 共存，而不是只靠 transient custom message 呈現。

備註

- UI 設計目前告一段落；上述項目保留在待實作清單，不作為下一個 session 的優先目標。

---

## ADR-0008 互動驗收同步（2026-08-13）

本節只同步 `docs/PLAN-A.md` 的 UI／互動 acceptance，不把同一修復拆成另一個 approval gate；下一個 session 仍只執行 Plan A。

- [ ] 真實 PI TUI 的 `NEEDS_CONFIRMATION` 問題可見；panel 使用 `content: panelText`、`display: true`。
- [ ] 使用者回答後自動開始下一 Grill round，不要求 `/forge-runtime continue`。
- [ ] `READY_FOR_DEEP` 自動進 Deep Knowledge，不顯示 continue gate。
- [ ] completion omission 顯示可操作 `/forge-runtime retry`、`cancel`、`switch <request>`，且同一 attempt 只顯示／進入 recovery 一次。
- [ ] recovery panel 後 session settled；沒有 background steer、自動 replay 或自動 Deep。
- [ ] 空 manifest 或 relevance gate 失敗時，顯示可回答的來源／scope 問題，而非只顯示錯誤。
- [ ] 單次使用者輸入不產生無上限 assistant turns；明確 retry 可建立新 attempt，但每個 attempt 仍有界。
