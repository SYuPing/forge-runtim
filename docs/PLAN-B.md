# Plan B：Forge Runtime v4 UI 與 WAIT_USER 體驗層

日期：2026-08-10（2026-08-16 更新）

Prerequisite（若有）

- `docs/PLAN-A.md` 必須先完成，因為 UI 只能建立在已穩定的 workflow contract 之上。

---
Building

- 為 Forge extension 補上 workflow 狀態顯示與 `WAIT_USER` 互動面板。
- 提供 evidence / decision / current state 的最小 widget 呈現。
- 提供讓使用者對 ambiguous decision 做確認的 command 或 UI interaction。
- 每個 `WAIT_USER` selector 固定提供「自行輸入…」，選取後在下方開啟文字輸入並以 Enter 送出。
- 補上 planning / validation / repair 狀態的可視化提示，讓 session 內可觀察目前 stage。

Not Building

- 不重做 PI 全域 TUI。
- 不做完整 Web 前端。
- 不做複雜動畫或過度裝飾。
- 不做獨立 session dashboard。
- 不做跨專案 observability 平台。
- 不修改 grill result schema、不依文案猜測自訂選項、不修改 `pi-main/`。

---
Approach

[Gap 1 - Workflow Status Widget]

在 extension 入口旁建立最小 widget，顯示目前 stage、上一個 evidence package、是否等待使用者。這個 widget 只讀 runtime 狀態，不自行推動 transition，避免把控制權再放回 UI。
Fragile assumption：Extension UI API 能穩定呈現 stage 與更新事件，不需要改 core rendering pipeline。

[Gap 2 - WAIT_USER Interaction]

把 `WAIT_USER` 做成明確的 UI / command flow：顯示問題、選項、推薦與 evidence id，並把 runtime 擁有的「自行輸入…」固定排在 selector 最後。選取後以 PI 原生 `ctx.ui.custom` 與 `Editor` 在同一互動下方接受文字；非空文字沿既有 resume path 回寫同一 `decisionId`，Escape 返回 selector 且不記錄 decision。一般選項維持原路徑，非 TUI 模式維持既有自然文字輸入。
Fragile assumption：`ctx.ui.custom` 與 `Editor` 能在現有 Forge extension lifecycle 穩定運作，不需要注入 TUI factory 或修改 core rendering pipeline。

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
│ forge-runtime/package.json                                   │ 已新增並核准 `@earendil-works/pi-tui@0.83.0` runtime dependency │
│ forge-runtime/package-lock.json                              │ 已鎖定 `@earendil-works/pi-tui@0.83.0`                 │
└──────────────────────────────────────────────────────────────┴──────────────────────────────────────────────┘

共 8 個規劃檔案（5 新增 + 3 修改；package／lock 已實際變更）

View 層結構

```text
Forge Runtime Extension UI
└── Session Widgets Stack
    ├── WorkflowStatusWidget  ← 顯示目前 stage、是否 idle、是否等待確認
    ├── WaitUserPanel         ← 顯示 question、options、recommendation、evidence
    │   └── 自行輸入…         ← 選取後切換為 inline Editor；Enter 送出，Escape 返回
    ├── EvidenceSummaryWidget ← 顯示目前 decision 與 citation 摘要
    └── ValidationRepairWidget← 顯示 fail 類別、rollback target、最新 repair 狀態
```

操作按鈕規格表

```text
┌──────────────┬──────────────────────────────────────────────┬──────────────────────────────────────────┐
│ 按鈕         │ 觸發動作                                     │ 狀態/條件 binding                        │
├──────────────┼──────────────────────────────────────────────┼──────────────────────────────────────────┤
│ Confirm      │ 使用者確認選項 -> orchestrator.resume()      │ `state == WAIT_USER` 時可用              │
│ 自行輸入…    │ 開啟 Editor -> 非空 Enter -> 既有 resume path │ `state == WAIT_USER` 時固定排在最後      │
│ Reject / Back│ 回報需要重新 grill -> orchestrator.rollback()│ `state == WAIT_USER` 時可用              │
│ Show Evidence│ 展開最新 evidence package                    │ 有 evidence package 時可用               │
└──────────────┴──────────────────────────────────────────────┴──────────────────────────────────────────┘
```

視覺驗收清單

- [ ] 頁面載入無例外。
- [ ] 進入任一 workflow state 時，`WorkflowStatusWidget` 會同步顯示正確 stage 名稱。
- [ ] `WAIT_USER` 發生時，`WaitUserPanel` 顯示 question、options、recommendation、evidence id。
- [ ] 每個 `WAIT_USER` selector 最後固定顯示「自行輸入…」，不依模型選項文案判斷。
- [x] focused regression 已驗證：選取「自行輸入…」後顯示 Editor，空白 Enter 不送出，Escape 返回 selector 且不新增 decision；真實 PI TUI acceptance 待驗收。
- [ ] 輸入文字並按 Enter 後，trim 後的非空文字記錄到同一 `decisionId`，並自動開始下一 Grill round。
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
- 2026-08-15 已核准固定「自行輸入…」互動及 `@earendil-works/pi-tui@0.83.0` runtime dependency；依賴已安裝，custom `Editor`／trim production path 已存在。
- 已驗證 structured reject 路徑：若 selector 選非 recommendation，最終會回到 `GRILL`，並顯示被選選項、decision summary、rollback target。
- 已驗證 `grill-run` 在真 RPC session 與 one-shot CLI 內都可觸發 skill flow 並暴露 `WAIT_USER`。
- 目前仍是最小 status/custom-panel + selector 路徑，尚未升級成完整 widget tree。
- 目前 UI 層沒有再往下加料；前段 stage、relevance gate 與 deep executor 已在 Plan A 內接通，Plan B 仍維持「之後再做固定 widget tree」的定位。

待完成

- 固定「自行輸入…」的 production path 已存在；剩餘驗收為真實 PI TUI，以及 current full validation。
- 將目前的 `WAIT_USER` custom message / status / selector 升級成真正固定區域的 widget tree。
- 讓 widget tree 常駐顯示目前 stage、wait-user 狀態、evidence 摘要、validation / rollback 摘要。
- 讓 selector 與固定 widget 共存，而不是只靠 transient custom message 呈現。

備註

- 歷史順序：固定「自行輸入…」slice 原先排在 Plan A 增補之後；目前 production path 已存在，固定 widget tree 等其餘項目仍未完成。

## 2026-08-16 實作、驗收與阻塞同步

- 已做：Plan A prompt-contract 增補完成（當時 focused 5/5、`npm test` 116/116、`npm run check` exit 0、Standards／Spec review 各 0 findings）；selector slice 歷史驗證 71/71；依賴已核准安裝；custom `Editor`／trim production path、四參數 factory 與 Theme adapter 已完成；focused regression tests 3/3 通過。
- 已完成：blank Enter、Escape 的 focused regression coverage；未完成：真實 PI TUI acceptance；固定 widget tree 也仍未完成。
- 驗收狀態：Plan B current 完整驗證未完成；71/71 只可作歷史 slice 證據，不可描述為 current full suite。
- Blocker：current 完整 extension test 約 75 至 76 秒、約 4GB heap OOM；因此 current full suite、真實 PI TUI acceptance 與固定 widget tree 尚未完成，Plan B／ticket 不得標記完成；`npm run check` exit 0，final Standards／Spec review 皆 0 blocker。
- 已嘗試且不足：頂層 runtime import 改動態、dynamic import 移入 async factory、刪除冗餘 selector test 回到 71 tests。精準 test 與 standalone `pi-tui` import 正常；Jiti loader `moduleCache:false`；根因未知。
- 下一步：由使用者實機重試相同「自行輸入…」路徑；不執行舊 OOM／type-import probe。

---

## ADR-0008 互動驗收同步（2026-08-13）

本節保留歷史執行順序：先執行 2026-08-15 Plan A 增補，再執行 ADR-0009 的 Plan B 固定自行輸入 slice。current 下一步先讀 `docs/handoff.md`，等待人類批准 type-only `pi-tui` import → 本地結構型別的單一判別探針。

- [ ] 真實 PI TUI 的 `NEEDS_CONFIRMATION` 問題可見；panel 使用 `content: panelText`、`display: true`。
- [ ] 使用者回答後自動開始下一 Grill round，不要求 `/forge-runtime continue`。
- [ ] `READY_FOR_DEEP` 自動進 Deep Knowledge，不顯示 continue gate。
- [ ] completion omission 顯示可操作 `/forge-runtime retry`、`cancel`、`switch <request>`，且同一 attempt 只顯示／進入 recovery 一次。
- [ ] recovery panel 後 session settled；沒有 background steer、自動 replay 或自動 Deep。
- [ ] 空 manifest 或 relevance gate 失敗時，顯示可回答的來源／scope 問題，而非只顯示錯誤。
- [ ] 單次使用者輸入不產生無上限 assistant turns；明確 retry 可建立新 attempt，但每個 attempt 仍有界。

---

## ADR-0009 固定自行輸入驗收（2026-08-15）

- [ ] 所有 `WAIT_USER` selector 最後都有 runtime 擁有的「自行輸入…」。
- [ ] 選取後在同一 TUI 互動下方顯示 Editor；非空 Enter 送出 trim 後文字。
- [ ] 送出的自由文字沿既有 resume path 記錄到同一 `decisionId`，並開始下一 Grill round。
- [x] focused regression 已驗證：空白 Enter 不送出；Escape 返回 selector，不記錄 decision、不建立新 round；真實 PI TUI acceptance 待驗收。
- [ ] 一般選項、confirm／reject 與非 TUI 自然文字路徑維持原行為。
## 2026-08-16 custom factory 崩潰修正同步

- Forge 已補正 `ctx.ui.custom` 四參數 factory、host `Theme` → `EditorTheme` adapter，並移除冗餘 `onEscape` 指派；有效答案在嘗試 resume 後結束 command。
- focused regression tests 3/3 通過，`npm run check` exit 0；final Standards／Spec review 皆 0 blocker，scope blast 無 sibling bug。
- `npm test` exit 1：47 tests 中 44 pass、3 fail；約 123 秒、約 4GB heap OOM，另有 2 個 loader timeout。
- `selectList` formatter 尚無實際 autocomplete render coverage；真實 PI TUI acceptance 與 current full suite 未完成，ticket 不得標記完成。舊 OOM／type-import probe 未執行。
- 下一步：由使用者實機重試相同「自行輸入…」路徑。
