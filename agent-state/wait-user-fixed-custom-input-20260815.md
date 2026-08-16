# WAIT_USER 固定自行輸入

Ticket：`wait-user-fixed-custom-input-20260815`

狀態：部分實作；設計與依賴決策已核准；完整驗證被 current extension test heap OOM 阻塞，ticket 尚未完成。

## 已完成項目

- 分析真實執行 log，確認 option-only selector 會把操作指示記錄成 decision，造成重複追問。
- 以 CodeGraph 追出 `WAIT_USER` selector、follow-up、input handler 與 `resumeGrillWithAnswer` 的共用路徑。
- 確認 PI 上游既有 `ctx.ui.custom` + `Editor` 可重用，不需修改 `pi-main/`。
- 使用者核准：每個 `WAIT_USER` 固定顯示系統「自行輸入…」。
- 已同步 `CONTEXT.md`、ADR-0009、Plan A 增補、Plan B 與 handoff。

## 重要決策

- 「自行輸入…」由 runtime 擁有並固定排最後，不由模型輸出、不依文案辨識。
- trim 後的非空文字沿既有 resume path 記錄同一 `decisionId`；前後空白不保留，空白不送出；Escape 返回 selector 且不記錄 decision。
- `ctx.ui.custom` 必須依 PI 實際四參數契約 `(tui, hostTheme, keybindings, done)` 執行；Forge 內將 host `Theme` 轉成 `EditorTheme` 後建立 Editor。
- 無 follow-up bridge 時，普通選項無法 resume 必須維持 `WAIT_USER` 並結束 command；只有空白 Enter 或 Escape 返回 selector。
- options 必須是完整可記錄答案；自由輸入由 WAIT_USER UI 負責。
- 不新增 schema、workflow stage、completion status 或 TUI factory；Forge package runtime dependency 固定為 `@earendil-works/pi-tui@0.83.0`，不修改 `pi-main/`。

## 修改檔案

- `CONTEXT.md`
- `docs/PLAN-A.md`
- `docs/PLAN-B.md`
- `docs/handoff.md`
- `docs/adr/ADR-0008-grill-completion-recovery-and-interactive-acceptance.md`
- `docs/adr/ADR-0009-wait-user-fixed-custom-input.md`
- `agent-state/wait-user-fixed-custom-input-20260815.md`

## 測試結果

- 歷史 milestone（設計與文件同步當時）：未執行測試，production code 未修改；目前 production/custom path 已部分實作，完整驗證仍被 OOM 阻塞。

## 未解問題

- prompt contract 只能降低操作指示型 options，不能做自然語言語意證明。
- focused regression tests 已直接驗證四參數 factory 與 host `Theme` → `EditorTheme` adapter。
- `Editor` 的 Escape 由 Forge wrapper 攔截；冗餘 `onEscape` assignment 已移除。
- `ctx.ui.custom`／`Editor` 只適用 TUI；非 TUI 必須保留既有自然文字路徑。
- workspace root 沒有 Git baseline，後續 review 需依指定檔案與 runtime evidence 進行。

## 歷史執行順序（已被目前狀態取代）

1. 歷史上先讀取 `docs/handoff.md`、CONTEXT、ADR-0008、ADR-0009、Plan A、Plan B 與本狀態檔，展示摘要並等待使用者確認。
2. 歷史上由獨立測試角色為 Plan A prompt-contract 增補打 RED；該增補已完成。
3. 歷史上由獨立實作／驗證角色完成 Plan A GREEN、focused test、當時完整 suite 與 type check；目前驗證狀態已被 OOM blocker 取代。
4. 歷史上預計由 Plan B 實作角色組合 `ctx.ui.custom` + `Editor`；目前 production path 已部分存在，剩餘驗收與 current full validation 仍未完成。現行 next step 見 171 至 173 行。

## Milestone：Plan A prompt-contract 增補完成

### 已完成項目

- 已完成兩個 TDD slices。

### 重要決策

- 保留 `string[]`。
- 不加 schema。
- 自由文字交由 `WAIT_USER` UI 處理。

### 修改檔案

- `forge-runtime/src/grill/grill-skill.ts`
- `tests/grill/grill-skill.test.ts`

### 測試結果

- focused test：5/5。
- `npm test`：116/116，exit 0。
- `npm run check`：exit 0。
- Standards review：0 findings。
- Spec review：0 findings。

### 未解問題

- prompt 語意無法機器證明。
- 真 PI TUI acceptance 待 Plan B。

### 下一步

- 執行 Plan B 固定「自行輸入…」slice。

## Milestone：Plan B selector 固定選項完成

### 已完成項目

- 已固定「自行輸入…」為 selector 最後選項。
- 一般 option follow-up 行為維持不變。

### 重要決策

- 不修改原 state options。
- 「自行輸入…」label 由 runtime 擁有。

### 修改檔案

- `forge-runtime/extensions/forge-runtime.ts`
- `tests/extensions/forge-runtime-extension.test.ts`

### 測試結果

- focused extension tests：71/71，exit 0。

### 已決策事項

- 使用既有 `ctx.ui.custom` + `Editor` 時，在 `forge-runtime/package.json` 與 `forge-runtime/package-lock.json` 新增 `@earendil-works/pi-tui@0.83.0`。
- 使用者已批准此依賴；只改 Forge package，不改 `pi-main/`。
- 不改用 `ctx.ui.editor`／`input`，不自製 Editor。

### 歷史執行順序（已被目前狀態取代）

- 當時由獨立測試角色先為 custom Editor、trim、blank 與 Escape 行為打 RED，再由獨立實作角色完成最小 GREEN；當時 blank／Escape 尚未驗證，現已由 2026-08-16 focused regression 3/3 補上，但真 PI TUI acceptance 仍待驗收。現行 next step 見 171 至 173 行。

## Hunt handoff：完整 extension test heap OOM

### Symptom

- extension focused test 以精準 custom pattern 執行為 1/1，約 0.82 秒。
- 完整測試檔約 75 至 76 秒後以約 4 GB heap OOM 失敗。
- 新增依賴前，同一檔案為 71/71。

### Hypotheses Tested

1. 頂層 TUI runtime import 累積：改為動態 import；完整檔仍 OOM。
2. `ui.custom` factory 前 eager dynamic import：移進 async factory；完整檔仍 OOM。
3. 第 72 個冗餘 harness test 越界：刪除冗餘 test 回到 71；完整檔仍 OOM。

### Evidence

- `pi-tui` standalone node/tsx import 正常。
- 精準 custom test 連續通過。
- PI loader 為 `Jiti moduleCache:false`。
- 診斷 log：`agent-state/wait-user-fixed-custom-input-20260815-oom-diagnosis.log`。
- 驗證命令／結果：精準 custom pattern extension test → 1/1、約 0.82 秒、連續通過；完整 extension test file → 約 75 至 76 秒後約 4 GB heap OOM；刪除冗餘 harness test 後仍 OOM。

### Ruled Out


- package runtime 本身。
- 單純預設 heap（提高至 4 GB 仍失敗）。
- 只由新增測試數造成。

### Unknowns

- type-only import 是否仍被 Jiti 解析或保留。
- package install 是否改變 loader scan。
- 需要 heap/import trace 區分上述兩者。

### Suggested Next

- 取得使用者方向後，以單一判別探針暫時移除 type-only package import，改用 local structural types（不改行為）驗證。
- 或改造 test harness cache；此屬較大 refactor，需另批處理。

### 目前狀態

- production/custom test 已修改，但完整驗證未通過；不得標記完成。

## 2026-08-16 同步狀態

### 已完成項目

- Plan A prompt-contract 增補完成：當時 focused 5/5、`npm test` 116/116、`npm run check` exit 0、Standards／Spec review 各 0 findings。
- Plan B selector slice 僅有歷史 71/71；`@earendil-works/pi-tui@0.83.0` 已核准安裝；selector／trim production path、四參數 factory 與 Theme adapter 已完成；focused regression tests 3/3 通過。

### 未完成／阻塞

- blank Enter、Escape 已由 focused regression tests 驗證；真實 PI TUI acceptance 未驗證。
- current 完整 extension test 約 75 至 76 秒、約 4GB heap OOM；current full suite 未完成，`npm run check` exit 0，final Standards／Spec review 皆 0 blocker，ticket 不得完成。
- 已嘗試頂層 dynamic import、async factory dynamic import、刪除冗餘 selector test，均不足以解除 OOM；精準 test、standalone import 正常，Jiti `moduleCache:false`，根因未知。

### 下一步（已獲使用者批准）

- 由使用者實機重試相同「自行輸入…」路徑；不修改 `pi-main/`，不執行舊 OOM／type-import probe，不標記 ticket 完成。
## 2026-08-16 custom factory 崩潰修正 milestone

### 已完成項目

- 修正 `ctx.ui.custom` 四參數 factory 與 host `Theme` → `EditorTheme` adapter，移除冗餘 `onEscape`。
- 有效 custom 答案與普通選項在嘗試 resume 後結束 command；無 bridge 時維持 `WAIT_USER`。
- focused regression tests 3/3、`npm run check` exit 0；final Standards／Spec review 皆 0 blocker，scope blast 無 sibling bug。

### 修改檔案

- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `CONTEXT.md`
- `docs/adr/ADR-0009-wait-user-fixed-custom-input.md`
- `docs/PLAN-A.md`
- `docs/PLAN-B.md`
- `docs/handoff.md`
- `agent-state/wait-user-fixed-custom-input-20260815.md`
- `Memory/record.md`

### 驗證結果

- focused tests：3/3 pass。
- `npm run check`：exit 0。
- `npm test`：exit 1；47 tests 中 44 pass、3 fail，約 123 秒、約 4GB heap OOM，另有 2 個 loader timeout。
- final review：Standards／Spec 皆 0 blocker；`selectList` formatter 尚無實際 autocomplete render coverage。

### 未解問題

- 真實 PI TUI acceptance 與 current full suite 未完成；ticket 不得標記完成。
- 舊 OOM／type-import probe 未執行。

### 下一步

- 使用者實機重試相同「自行輸入…」路徑。
