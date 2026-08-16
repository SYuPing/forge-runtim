# ADR-0009：WAIT_USER 固定自行輸入入口

日期：2026-08-15

## 狀態

Accepted

## Context

`WAIT_USER` contract 已允許選項或自由文字，但目前真實 TUI selector 只讓使用者提交 option 字串。當模型把「請提供 Hz」包成選項時，操作指示會被記錄成 decision，下一輪再追問相同資料，形成可重複的問答迴圈。

## Decision

1. 每個 TUI `WAIT_USER` selector 固定把 runtime 擁有的「自行輸入…」排在最後；不由模型決定是否顯示，也不依選項文案推測。
2. 選取「自行輸入…」後，以 PI 既有 `ctx.ui.custom` 四參數 factory `(tui, hostTheme, keybindings, done)` 與 `Editor` 在同一互動下方接受文字。Forge 將 host `Theme` 轉成 `EditorTheme`：`borderColor` 使用 `hostTheme.fg("borderMuted", text)`，`selectList` 使用 accent／muted formatter。trim 後的非空文字沿既有 resume path 記錄為同一 `decisionId` 的 decision，並自動開始下一 Grill round；前後空白不保留。
3. 空白 Enter 不送出；Escape 退出輸入模式、返回 selector，且不記錄 decision、不建立新 round。
4. `questions[].options` 必須是可直接記錄的完整答案，不得是要求使用者再輸入資料的操作文字。這項語意只補在既有 Grill invocation contract 與測試，不新增 schema 欄位。
5. 一般選項、confirm／reject 與非 TUI 自然文字路徑維持既有行為；不修改 `pi-main/`、不新增 workflow stage、completion status 或 TUI factory seam。
6. 為符合既有 `ctx.ui.custom` + `Editor` 設計，Forge package 新增 runtime dependency `@earendil-works/pi-tui@0.83.0`；只修改 Forge package，不修改 `pi-main/`。不改用 `ctx.ui.editor`／`input`，也不自製 Editor。

## Consequences

- 自由回答成為可見且一致的系統能力，不再依賴模型臨時生成「自訂」文案。
- UI 不承擔領域語意判斷；它只區分 runtime 自己的固定入口與一般 options。
- prompt contract 無法機器證明自然語言一定合格，因此真實 PI TUI acceptance 仍必須驗證錯誤候選出現時，使用者可透過固定入口送出真正答案並離開追問迴圈。
- 採用既有 PI TUI 相容的 `@earendil-works/pi-tui@0.83.0` 可直接支援核准的 custom Editor 路徑；依賴只存在 Forge package，維持 `pi-main/` 邊界。

## Not Building

- 不新增 custom-input schema、欄位型別、領域驗證器或選項文案 heuristic。
- 不重做 PI TUI、不實作固定 widget tree、不修改 `pi-main/`。
- 不改用 `ctx.ui.editor`／`input`，不自製 Editor；依賴決策僅限 `forge-runtime` package。

## 實作與驗證狀態（2026-08-16 最終）

- `@earendil-works/pi-tui@0.83.0` 已由人類核准並安裝；依賴只在 Forge package，未修改 `pi-main/`。
- Forge 已依四參數 `(tui, hostTheme, keybindings, done)` factory 建立 host `Theme` → `EditorTheme` adapter，移除冗餘 `onEscape` 指派；有效答案在嘗試 resume 後結束 command，無 bridge 時維持 `WAIT_USER`。
- 三個 focused regression tests 3/3 通過：render／trim submit、blank Enter／Escape、無 bridge option；`npm run check` exit 0，scope blast 無 sibling bug。
- focused Plan A：83/83 pass；canonical `npm test`：124/124 pass，無 OOM／timeout；`npm run check` 兩段 `tsc --noEmit` 均通過。
- scripted PI TUI focused 1/1、full 4/4 通過；final review Standards 0 findings，Spec finding 已修正，closure 0 findings。
- production 已覆蓋 custom Editor／trim／blank Enter／Escape／shared resume、clarification decisionId、相同 pending decisionId 的一次性 publish、unique evidence count、completion prose suppression。
- 未完成且不可宣稱：Plan B 人工視覺驗收、固定 widget tree、selectList autocomplete render coverage；需使用者核准與驗收。無 decisionId ingress 無法做 pending-id dedupe，不替使用者決定 policy。

## 已核准的 WAIT_USER 契約補充（2026-08-16）

1. `questions[].options` 是推薦／快捷回答，不是封閉集合；trim 後非空的自由文字也是有效回答，沿既有 resume path 記錄為同一 `decisionId` 的人類決策。
2. 若回答的語意仍不足，下一輪 `GRILL` 必須提出新的 clarification decision；不得稱為非法選項，也不得重發原 `decisionId`。
3. 同一 pending `decisionId` 只發布一次 `WAIT_USER`；重複 completion 或重入不得再次發布同一題。
4. `WAIT_USER` 不顯示通用 Confirm／Reject；畫面只呈現問題、快捷回答、固定「自行輸入…」入口與必要狀態。
5. Evidence 以 exact evidence id 去重；主畫面只顯示唯一 evidence 數量（例如 `Evidence: 4 項`），不顯示 raw `ev-...` ID，完整 ID 保留在 runtime state／紀錄供追溯。
6. `forge_grill_complete` 成功完成狀態轉移後，不再追加 assistant prose；completion 後的可見結果由 runtime UI 契約承擔。

上述補充保留本 ADR 的 Accepted 狀態與下方未完成驗證；不新增 schema 欄位、workflow stage 或 `pi-main/` 變更。
