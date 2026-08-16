# Forge Runtime v4 Handoff

日期：2026-08-16

## 目標

完成 ADR-0009 的 `WAIT_USER` 固定「自行輸入…」入口：沿既有 `ctx.ui.custom` 四參數 factory `(tui, hostTheme, keybindings, done)` + `Editor` resume path 接受 trim 後自由文字，並在 Forge 內將 host `Theme` 轉成 `EditorTheme`；空白 Enter 不送出，Escape 返回 selector；不修改 `pi-main/`、schema、workflow stage 或 completion status。

## 目前狀態

- Plan A prompt-contract 增補已完成；當時 focused 5/5、`npm test` 116/116、`npm run check` exit 0、Standards／Spec review 各 0 findings。
- Plan B selector slice 的歷史驗證為 71/71，不能描述為目前完整 suite 通過。
- `@earendil-works/pi-tui@0.83.0` 已由人類核准並安裝，只改 Forge package、不改 `pi-main/`。
- custom factory seam 已修正：Forge 依 `(tui, hostTheme, keybindings, done)` 建立 `EditorTheme` adapter，移除冗餘 `onEscape`；有效答案在嘗試 resume 後結束 command。
- focused regression tests 3/3 通過，`npm run check` exit 0；final Standards／Spec review 皆 0 blocker，scope blast 無 sibling bug。
- `npm test` exit 1：47 tests 中 44 pass、3 fail；約 123 秒、約 4GB heap OOM，另有 2 個 loader timeout。本 ticket 尚未完成；真實 PI TUI acceptance 與 current full suite 仍未完成。

## 修改檔案

- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `forge-runtime/package.json`
- `forge-runtime/package-lock.json`
- 本 handoff、`CONTEXT.md`、ADR-0009、`docs/PLAN-A.md`、`docs/PLAN-B.md`、ticket state 與 OOM log 僅作狀態同步。

## 已知驗證與 OOM evidence

- Plan A prompt-contract：focused 5/5；當時完整 `npm test` 116/116；`npm run check` exit 0；Standards／Spec review 各 0 findings。
- Plan B selector：歷史 71/71；不是 current full suite。
- 精準 custom test：1/1；standalone `pi-tui` import 正常；Jiti loader 為 `moduleCache:false`。
- 完整 extension test：約 75 至 76 秒後約 4GB heap OOM。原始證據保留於 `agent-state/wait-user-fixed-custom-input-20260815-oom-diagnosis.log`。

## 已嘗試但不足的假設

1. 頂層 runtime import 改為 dynamic import：仍 OOM。
2. dynamic import 移入 async factory：仍 OOM。
3. 刪除冗餘 selector test 回到 71 tests：仍 OOM。

目前根因仍未知；證據只支持問題位於非精準 `node:test`／`tsx` 載入探索或 Jiti 重複保留路徑，不能下定論。

## 未完成與風險

- `selectList` formatter 尚無實際 autocomplete render coverage。
- 真實 PI TUI acceptance 未完成。
- current full suite 與真實 PI TUI acceptance 未完成；`npm run check` exit 0，final Standards／Spec review 皆 0 blocker；不得標記完成。
- prompt contract 不能機器證明自然語言 options 一定是完整答案。
- `ctx.ui.custom`／`Editor` 僅適用 TUI；非 TUI 自然文字路徑必須保留。
- 不修改 `pi-main/`，不執行舊 OOM 探針，不擴大成 harness refactor。

## 下一步（已獲使用者批准）

由使用者實機重試相同「自行輸入…」路徑，確認 Editor 正常顯示、非空答案可提交、空白 Enter 不提交、Escape 返回 selector。不修改 `pi-main/`，不執行舊 OOM／type-import probe，不標記 ticket 完成。

## 起手訊息

請先閱讀本檔、`CONTEXT.md`、`docs/adr/ADR-0009-wait-user-fixed-custom-input.md`、`docs/PLAN-A.md`、`docs/PLAN-B.md`、`agent-state/wait-user-fixed-custom-input-20260815.md`、`Memory/record.md` 與 OOM log，請使用者實機重試相同「自行輸入…」路徑；不修改 `pi-main/`，不執行舊 OOM／type-import probe，不要聲稱 ticket 已完成。
