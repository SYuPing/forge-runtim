# TypeBox Loader Compatibility

## 已完成項目

- 重現使用者的 `pi` 啟動失敗：extension loader 解析 `typebox/schema` 時尋找不存在的 `typebox/build/index.mjs/schema`。
- 以 CodeGraph 確認 PI loader 僅提供 `typebox`、`typebox/compile`、`typebox/value`，而 completion parser 使用未支援的 `typebox/schema`。
- 建立本 ticket 的 CONTEXT、ADR-0007 follow-up、Plan A 與 handoff 記錄。

## 重要決策

- 在 Forge package 端改用 `typebox/compile`，不修改 `pi-main/`；這是最小且符合上游 core 邊界的修正。
- 回歸 seam 是 PI source CLI 明確載入 Forge extension 後的 `--help` 自動退出，不是 direct `tsx` import。

## 修改檔案

- `CONTEXT.md`
- `docs/adr/ADR-0007-grill-completion-tool.md`
- `docs/PLAN-A.md`
- `docs/handoff.md`
- `agent-state/typebox-loader-compatibility.md`
- `forge-runtime/tests/extensions/pi-extension-loader.test.ts`
- `forge-runtime/src/grill/grill-result.ts`

## 測試結果

- 實際 `pi` 重現：exit code 1，載入 `forge-runtime/src/grill/grill-result.ts` 時找不到 `typebox/build/index.mjs/schema`。
- 已建立 `forge-runtime/tests/extensions/pi-extension-loader.test.ts`；但 PI source CLI 直接載入 Forge extension 的兩個 assertions 在舊程式碼即 2/2 通過，故不是有效的紅燈 regression guard。
- 已改用 global compiled `pi --offline --no-session --no-extensions --extension .pi/extensions/forge-runtime.ts -p "loader smoke"`；focused test 的兩個 assertions 均紅燈，且在模型/offline 階段前命中原始 TypeBox loader error。
- 修正後 focused loader test 2/2 通過、完整 `npm test` 99/99 通過、`npm run check` 通過，global compiled PI runtime probe exit 0 且不含三個原始 extension loader error 字串。

## 未解問題

- global compiled CLI 與 source CLI 的 loader 分支不同：前者採 built alias，後者採 virtual modules；實作後仍須驗證 global compiled CLI 已越過 extension loader。
- loader regression test 依賴 PATH 中可用的 compiled `pi` CLI；缺少時會明確失敗，這是 integration prerequisite 而非靜默 skip。

## Final review

- 獨立檔案審查沒有 Standards 或 Spec finding；`typebox/compile` 只替換 compile import，未改 schema 或 completion lifecycle。
- workspace 無 Git baseline，故無法完成固定起點 diff review；CodeGraph 也未能逐行載入新增測試與文件。這些限制由 focused 2/2、完整 99/99、type check 與 compiled PI runtime probe 補強，但不等同 commit diff evidence。

## 下一步

- 本 ticket 已完成。後續若更新 PI loader alias 或升級 TypeBox，先重跑 `pi-extension-loader.test.ts` 與 global compiled PI probe。
