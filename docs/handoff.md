# Forge Runtime v4 Handoff

日期：2026-08-16

## 目標

完成 ADR-0009 的 `WAIT_USER` 固定「自行輸入…」入口：沿既有 `ctx.ui.custom` 四參數 factory `(tui, hostTheme, keybindings, done)` + `Editor` resume path 接受 trim 後自由文字，並在 Forge 內將 host `Theme` 轉成 `EditorTheme`；空白 Enter 不送出，Escape 返回 selector；不修改 `pi-main/`、schema、workflow stage 或 completion status。

## 目前狀態（2026-08-16）

- Plan A prompt-contract 增補已完成；當時 focused 5/5、`npm test` 116/116、`npm run check` exit 0、Standards／Spec review 各 0 findings。
- Plan B selector slice 的歷史驗證為 71/71，不能描述為目前完整 suite 通過。
- `@earendil-works/pi-tui@0.83.0` 已由人類核准並安裝，只改 Forge package、不改 `pi-main/`。
- custom factory seam 已修正：Forge 依 `(tui, hostTheme, keybindings, done)` 建立 `EditorTheme` adapter，移除冗餘 `onEscape`；有效答案在嘗試 resume 後結束 command。
- focused regression tests 3/3 通過，`npm run check` exit 0；final Standards／Spec review 皆 0 blocker，scope blast 無 sibling bug。
- Plan A implementation 與 automated/scripted gates 已完成：focused 83/83、canonical `npm test` 124/124、`npm run check` 兩段通過；scripted PI TUI focused 1/1、full 4/4；無 OOM／timeout。
- final review Standards 0 findings；Spec finding 已修正，closure 0 findings。下一步是等待使用者決定是否進入 Plan B 人工視覺驗收。

## 修改檔案

- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `forge-runtime/package.json`
- `forge-runtime/package-lock.json`
- 本 handoff、`CONTEXT.md`、ADR-0009、`docs/PLAN-A.md`、`docs/PLAN-B.md`、ticket state 與 OOM log 僅作狀態同步。

## 已知驗證與歷史 OOM evidence

- Plan A prompt-contract：focused 5/5；當時完整 `npm test` 116/116；`npm run check` exit 0；Standards／Spec review 各 0 findings。
- Plan B selector：歷史 71/71；不是 current full suite。
- 精準 custom test：1/1；standalone `pi-tui` import 正常；Jiti loader 為 `moduleCache:false`。
- 歷史完整 extension test 曾約 75 至 76 秒後約 4GB heap OOM；原始證據保留於 `agent-state/wait-user-fixed-custom-input-20260815-oom-diagnosis.log`。目前 canonical suite 已 124/124 通過，該 OOM 不再是 current blocker。

## 已嘗試但不足的假設

1. 頂層 runtime import 改為 dynamic import：仍 OOM。
2. dynamic import 移入 async factory：仍 OOM。
3. 刪除冗餘 selector test 回到 71 tests：仍 OOM。

目前根因仍未知；證據只支持問題位於非精準 `node:test`／`tsx` 載入探索或 Jiti 重複保留路徑，不能下定論。

## 未完成與風險

- ### 下一階段最高優先級

  - WAIT_USER sticky marker：`publishWaitUser` 在 `requireWaitUser`、`publishState`、`ctx.ui.select`／`ctx.ui.custom` 完成前即寫入 published marker；若後續拋錯、選擇取消、custom 不存在或 UI 不存在，stage／marker 可能殘留，相同 `decisionId` 重試會被視為已發布而 no-op。
  - 下一階段先以 RED 測試覆蓋失敗、取消、無 UI、相同 ID 重試，再定義並實作 rollback／commit 語意。
  - answered `decisionId` 的 runtime reuse enforcement，以及 WAIT_USER 期間不同 `decisionId` reentry 應 reject、ignore 或 replace，分列為尚待使用者決策，不宣稱已解決。
  - 2026-08-16 使用者已知悉並接受這項風險，授權本次照樣 commit；此授權不代表問題已解決。

- `selectList` formatter 尚無實際 autocomplete render coverage。
- Plan B 人工視覺驗收、固定 widget tree、selectList autocomplete render coverage 尚未完成，需使用者核准與驗收。
- prompt contract 不能機器證明自然語言 options 一定是完整答案。
- `ctx.ui.custom`／`Editor` 僅適用 TUI；非 TUI 自然文字路徑必須保留。
- 不修改 `pi-main/`，不執行舊 OOM 探針，不擴大成 harness refactor。

## 起手訊息

請先閱讀本檔與相關 durable 文件，向使用者說明 Plan A 已完成，並等待使用者決定是否進入 Plan B 人工視覺驗收。不修改 `pi-main/`；不要把 Plan B 未完成項目宣稱為已完成。

## 2026-08-16 設計確認與下一 session（歷史）

- 使用者已確認 WAIT_USER 的開放回答、語意不足時的新 clarification decision、單次 pending WAIT_USER、無通用 Confirm／Reject、Evidence 摘要與 completion 後無 assistant prose；詳見 `CONTEXT.md`、`docs/adr/ADR-0009-wait-user-fixed-custom-input.md`。
- 舊流程與 47/44/OOM 數字保留作歷史；目前以本檔「目前狀態」與最終驗證基線為準。

## 最終交接結論

- Plan A implementation、focused/full automated tests、static check、scripted PI TUI gates 與 final review 均完成。
- 未解風險：無 decisionId ingress 無法做 pending-id dedupe；Plan B 人工視覺驗收仍待使用者決定。
