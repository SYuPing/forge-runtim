# WAIT_USER 固定自行輸入

Ticket：`wait-user-fixed-custom-input-20260815`

狀態：Plan A implementation 與 automated/scripted gates 完成；等待使用者決定是否進入 Plan B 人工視覺驗收。舊 OOM、44/47 與 RED 尚未完成均已 supersede。

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

- 歷史 milestone（設計與文件同步當時）：未執行測試，production code 未修改；當時的 OOM 阻塞已由最終 closure supersede。

## 未解問題

- prompt contract 只能降低操作指示型 options，不能做自然語言語意證明。
- focused regression tests 已直接驗證四參數 factory 與 host `Theme` → `EditorTheme` adapter。
- `Editor` 的 Escape 由 Forge wrapper 攔截；冗餘 `onEscape` assignment 已移除。
- `ctx.ui.custom`／`Editor` 只適用 TUI；非 TUI 必須保留既有自然文字路徑。
- workspace root 沒有 Git baseline，後續 review 需依指定檔案與 runtime evidence 進行。

## 歷史執行順序（已被目前狀態取代）

1. 歷史上先讀取 `docs/handoff.md`、CONTEXT、ADR-0008、ADR-0009、Plan A、Plan B 與本狀態檔，展示摘要並等待使用者確認。
2. 歷史上由獨立測試角色為 Plan A prompt-contract 增補打 RED；該增補已完成。
3. 歷史上由獨立實作／驗證角色完成 Plan A GREEN、focused test、當時完整 suite 與 type check；當時的 OOM blocker 狀態已由 final closure 取代。
4. 歷史上預計由 Plan B 實作角色組合 `ctx.ui.custom` + `Editor`；當時剩餘驗收與 current full validation 未完成，已由 final closure 取代。現行 next step 見文件末尾。

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

### 歷史下一步（已取代）

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

- 歷史狀態：production/custom test 已修改，但完整驗證未通過；已由下方 final closure 取代。

## 2026-08-16 同步狀態

### 已完成項目

- Plan A prompt-contract 增補完成：當時 focused 5/5、`npm test` 116/116、`npm run check` exit 0、Standards／Spec review 各 0 findings。
- Plan B selector slice 僅有歷史 71/71；`@earendil-works/pi-tui@0.83.0` 已核准安裝；selector／trim production path、四參數 factory 與 Theme adapter 已完成；focused regression tests 3/3 通過。

### 歷史未完成／阻塞（已 supersede）

- blank Enter、Escape 已由 focused regression tests 驗證；真實 PI TUI acceptance 未驗證。
- 歷史結果：最近一次完整測試嘗試為 47 中 44 pass、3 fail，另有 loader timeout／約 4GB heap OOM；已由 final closure 取代，不是 current blocker。
- 已嘗試頂層 dynamic import、async factory dynamic import、刪除冗餘 selector test，均不足以解除 OOM；精準 test、standalone import 正常，Jiti `moduleCache:false`，根因未知。

### 歷史下一步（已取代）

- 下一個 session 先讀 handoff 並展示摘要，等待使用者確認；確認後由測試子代理先做 RED，實機 PI TUI 放在後續 verification。
## 2026-08-16 custom factory 崩潰修正 milestone（歷史 milestone，已被 final closure 取代）

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

- 歷史未完成狀態：真實 PI TUI acceptance 與 current full suite 未完成；47/44、loader timeout 與 OOM 已由 final closure 取代。
- 舊 OOM／type-import probe 未執行。

## Milestone：2026-08-16 設計補充已確認，待 RED→GREEN（歷史，已 supersede）

### 已完成項目

- 已將使用者核准的 WAIT_USER 開放回答、clarification、單次發布、UI 顯示、Evidence 摘要與 completion 收束契約同步至 Context、ADR、Plan A、Plan B 與 handoff。
- 已保留既有 Accepted 狀態、completed sections、OOM 與未完成驗收，不將 ticket 標記完成。

### 重要決策

- options 是推薦／快捷回答，不是封閉集合；trim 後非空自由文字有效。
- 語意不足由下一輪 GRILL 提出新的 clarification decision，不稱為非法選項、不重發原 `decisionId`。
- 同一 pending `decisionId` 只發布一次 WAIT_USER；不顯示通用 Confirm／Reject；exact evidence id 去重後主畫面只顯示唯一數量，完整 ID 保留在 runtime state／紀錄；completion 後無 assistant prose。
- 預設 production seams：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/ui/wait-user-panel.ts`、`forge-runtime/src/grill/grill-skill.ts`；測試為 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/grill/grill-skill.test.ts`、新建 `forge-runtime/tests/ui/wait-user-panel.test.ts`。共 6 檔，超過 5 檔但分屬三個既有 seam；不預先修改 session-state。

### 修改檔案

- `CONTEXT.md`
- `docs/adr/ADR-0009-wait-user-fixed-custom-input.md`
- `docs/PLAN-A.md`
- `docs/PLAN-B.md`
- `docs/handoff.md`
- `agent-state/wait-user-fixed-custom-input-20260815.md`

### 測試結果

- 本次未執行測試（文件同步 ticket，且明確禁止主代理執行測試）。
- 歷史完整測試嘗試：47 中 44 pass、3 fail，另有 loader timeout／約 4GB heap OOM；已由最終 focused/full gates 取代。既有 focused regression 3/3 與 `npm run check` exit 0 保留為獨立證據。

### 未解問題

- RED 尚未由測試子代理執行；三個 production seams 與三份 focused tests 已明列於 Plan A/B。
- 真實 PI TUI、`selectList` autocomplete render、current full suite 仍未驗收；44/47、OOM 與 loader timeout 風險保留。
- ticket 尚未完成。

### 下一步

- 唯一步驟：下一 session 先讀 handoff 並展示摘要，等待使用者確認；確認後由測試子代理先打 RED，再由實作角色做最小 GREEN，實機 PI TUI 放在後續 verification。

## Milestone：2026-08-16 WAIT_USER panel RED

### 已完成項目

- 新增一個公開介面行為測試，驗證 WAIT_USER panel 應以 exact evidence id 去重後顯示唯一數量，且不顯示 raw id 或通用 Confirm／Reject。
- 未修改任何 production code、`pi-main/` 或其他 ticket 文件。

### 修改檔案

- `forge-runtime/tests/ui/wait-user-panel.test.ts`
- `agent-state/wait-user-fixed-custom-input-20260815.md`
- `agent-state/wait-user-fixed-custom-input-20260815-red-ui-panel.log`

### 測試結果

- 測試：`WaitUserPanel_WhenEvidenceIdsRepeat_ShouldShowUniqueEvidenceCountWithoutGenericActions`
- 命令：`cd forge-runtime && npx tsx --test tests/ui/wait-user-panel.test.ts`
- exit code：`1`（1 test failed、0 passed）
- 失敗原因：既有 panel 仍輸出 `Evidence: ev-a, ev-a, ev-b`，沒有 `Evidence: 2 項`，並仍包含通用 Confirm／Reject。
- 證據：測試斷言位於 `forge-runtime/tests/ui/wait-user-panel.test.ts:18-20`；既有缺口位於 `forge-runtime/src/ui/wait-user-panel.ts:10-12`。

### 未解問題

- RED 已確認為預期功能缺口，等待獨立實作角色在既有 panel seam 做最小 GREEN。
- 其餘開放回答、clarification、單次 WAIT_USER 與 completion prose slices 尚未執行。

## Milestone：2026-08-16 WAIT_USER free-text public-boundary contract

### 結論

- 既有 public-boundary test 已完整覆蓋本 ticket contract：trim 後非空自由文字回傳 `transform`、建立 `grill-2`、保留 immutable snapshot candidate id、帶入 trim 後答案，且不需 `/forge-runtime continue`。
- 未新增重複測試；僅將既有自由文字案例改為帶前後空白，並把既有答案 assertion 明確改為驗證 `answer.trim()`。

### 修改檔案

- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts:458-526`
- `agent-state/wait-user-fixed-custom-input-20260815-contract-test.log`

### 驗證結果

- 測試：`Extension_WhenWaitUserAnswerIsOptionOrFreeText_ShouldReuseFetchedSnapshotEvidenceInNextGrillRound`
- 命令：`cd forge-runtime && npx tsx --test --test-name-pattern="^Extension_WhenWaitUserAnswerIsOptionOrFreeText_ShouldReuseFetchedSnapshotEvidenceInNextGrillRound$" tests/extensions/forge-runtime-extension.test.ts`
- exit code：`0`；`1 passed、0 failed`。

### 未解風險

- 同檔其他既有 panel assertion 仍與已更新 panel contract 不一致；本 focused test 未受影響，未擴大修正範圍。

### 下一步

- 主代理確認此 RED 後，交由 production 實作角色修正 `buildWaitUserPanel`；不要在本角色追加測試或修改其他 seam。

## Milestone：2026-08-16 WAIT_USER panel GREEN

### 已完成項目

- `WaitUserPanel_WhenEvidenceIdsRepeat_ShouldShowUniqueEvidenceCountWithoutGenericActions` 已由 RED 轉 GREEN。

### 測試結果

- 命令：`cd forge-runtime && npx tsx --test tests/ui/wait-user-panel.test.ts`
- exit code：`0`
- 結果：1 passed、0 failed。
- log：[wait-user-fixed-custom-input-20260815-green-ui-panel.log](wait-user-fixed-custom-input-20260815-green-ui-panel.log)

### 證據

- 測試：`forge-runtime/tests/ui/wait-user-panel.test.ts:18-20`
- panel production seam：`forge-runtime/src/ui/wait-user-panel.ts:10-12`

### 未解問題

- 其餘開放回答、clarification、單次 WAIT_USER 與 completion prose slices 尚未執行。

## Milestone：2026-08-16 clarification decisionId RED

### 結論

- 已確認指定 prompt contract 測試為預期 RED；未修改 production code 或 test code。

### 測試結果

- 測試：`BuildGrillingSkillInvocation_WhenAnswerRemainsInsufficient_ShouldRequireNewClarificationDecisionId`
- 命令：`cd forge-runtime && npx tsx --test --test-name-pattern="^BuildGrillingSkillInvocation_WhenAnswerRemainsInsufficient_ShouldRequireNewClarificationDecisionId$" tests/grill/grill-skill.test.ts`
- exit code：`1`；`0 passed、1 failed`。
- 單行失敗原因：prompt 缺少「若回答語意仍不足，下一輪提出新的 clarification decision」契約，且未包含「不得重用已回答的 decisionId」。
- 完整 log：[wait-user-fixed-custom-input-20260815-red-grill-clarification-decision-id.log](wait-user-fixed-custom-input-20260815-red-grill-clarification-decision-id.log)

### 證據

- 測試斷言：`forge-runtime/tests/grill/grill-skill.test.ts:55-56`
- 失敗輸出顯示現有 prompt 未匹配 `/若回答語意仍不足.*下一輪.*新的 clarification decision/`。

### 未解問題

- 等待獨立實作角色在既有 `buildGrillingSkillInvocation` seam 做最小 GREEN；本角色不追加修改。

## Milestone：2026-08-16 clarification decisionId GREEN（二次獨立驗證）

### 結論

- 指定測試已通過，確認 RED→GREEN。

### 測試結果

- 測試：`BuildGrillingSkillInvocation_WhenAnswerRemainsInsufficient_ShouldRequireNewClarificationDecisionId`
- 命令：`Set-Location forge-runtime; npx tsx --test --test-name-pattern="^BuildGrillingSkillInvocation_WhenAnswerRemainsInsufficient_ShouldRequireNewClarificationDecisionId$" tests/grill/grill-skill.test.ts`
- exit code：`0`；`1 passed、0 failed`。
- 單行結果：`✔ BuildGrillingSkillInvocation_WhenAnswerRemainsInsufficient_ShouldRequireNewClarificationDecisionId`
- 完整 log：[wait-user-fixed-custom-input-20260815-green-grill-clarification-decision-id.log](wait-user-fixed-custom-input-20260815-green-grill-clarification-decision-id.log)

### 證據

- 測試檔：`forge-runtime/tests/grill/grill-skill.test.ts:55-56`

### 未解風險

- 僅執行指定精準測試；未執行 full suite 或 check。
追加 milestone：2026-08-16 同一 pending WAIT_USER 重複發布 RED

### 結論

- 指定測試已重現預期 RED；未修改 production 或 test。
- 第二次相同 pending WAIT_USER 發布在狀態轉移階段拋出 `Invalid transition: WAIT_USER -> WAIT_USER`，顯示尚未完成 selector/panel 單次發布的冪等收束。

### 測試結果

- 測試：`Extension_WhenSamePendingWaitUserDecisionIsPublishedTwice_ShouldShowSelectorAndPanelOnlyOnce`
- 命令：`Set-Location forge-runtime; npx tsx --test --test-name-pattern="^Extension_WhenSamePendingWaitUserDecisionIsPublishedTwice_ShouldShowSelectorAndPanelOnlyOnce$" tests/extensions/forge-runtime-extension.test.ts`
- exit code：`1`；`0 passed、1 failed、0 cancelled、0 skipped`。
- 完整輸出：[wait-user-fixed-custom-input-20260815-red-single-wait-user.log](wait-user-fixed-custom-input-20260815-red-single-wait-user.log)

### selector/panel actual vs expected

- actual：第二次發布於 `forge-runtime/src/workflow/state-machine.ts:86` 拋錯，未完成第二次 selector/panel 可觀測發布。
- expected：同一 pending `decisionId` 只顯示 selector 一次、panel 一次，不因重複發布拋錯。

### 未解問題

- 等待獨立 production 實作角色在既有 extension/session workflow seam 做最小 GREEN；本角色不追加修改。

## Milestone：2026-08-16 同一 pending WAIT_USER 重複發布 GREEN（第三次獨立驗證）

### 結論

- 指定測試已通過，確認 RED→GREEN；同一 pending `decisionId` 重複發布不再造成重複 selector 或 panel。

### 測試結果

- 測試：`Extension_WhenSamePendingWaitUserDecisionIsPublishedTwice_ShouldShowSelectorAndPanelOnlyOnce`
- 命令：`Set-Location forge-runtime; npx tsx --test --test-name-pattern="^Extension_WhenSamePendingWaitUserDecisionIsPublishedTwice_ShouldShowSelectorAndPanelOnlyOnce$" tests/extensions/forge-runtime-extension.test.ts`
- exit code：`0`；`1 passed、0 failed、0 cancelled、0 skipped`。
- 完整 log：[wait-user-fixed-custom-input-20260815-green-single-wait-user.log](wait-user-fixed-custom-input-20260815-green-single-wait-user.log)

### selector/panel actual vs expected

- actual：`selectorCalls = 1`、`publishedPanels.length = 1`。
- expected：同一 pending `decisionId` 只顯示 selector 一次、panel 一次。

### 證據

- 測試斷言：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts:2319-2323`

### 未解風險

- 僅執行指定精準測試；未執行 full suite 或 check。
@@
## Milestone：2026-08-16 completion suppression public-boundary contract

### 結論

- 既有 `Extension_WhenCompletionSuccessIsFollowedByTerminalProse_ShouldSuppressOnlyThatTurn` 已完整覆蓋 Plan A observable contract「completion 後不顯示 assistant prose」；未新增重複測試。
- 測試同時確認 completion 後 terminal assistant prose 被替換且不外洩、WAIT_USER 狀態仍成立，以及下一回合 prose 不被誤抑制。

### 修改檔案

- `agent-state/completion-suppression-contract-20260816.log`

### 測試結果

- 命令：`Set-Location forge-runtime; npx tsx --test --test-name-pattern="^Extension_WhenCompletionSuccessIsFollowedByTerminalProse_ShouldSuppressOnlyThatTurn$" tests/extensions/forge-runtime-extension.test.ts`
- exit code：`0`；`1 passed、0 failed、0 cancelled、0 skipped`。
- 證據：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts:566-631`。

### 未解風險

- 未執行完整 suite；本 ticket 僅要求 completion suppression public-boundary 精準驗證。

## Milestone：2026-08-16 Plan A focused batch 驗證

### 結論

- 指定三檔 focused batch 完成，但未通過；80/81 通過、1/81 失敗，exit code 1。

### 測試結果

- 命令：`Set-Location forge-runtime; npx tsx --test tests/extensions/forge-runtime-extension.test.ts tests/grill/grill-skill.test.ts tests/ui/wait-user-panel.test.ts`
- 結果：81 tests、80 pass、1 fail、0 cancelled、0 skipped；耗時約 2.389 秒。
- 失敗：`Extension_WhenPanelIsEmitted_ShouldUseVisibleContentContract`（`forge-runtime/tests/extensions/forge-runtime-extension.test.ts:366`）。
- 失敗摘要：實際 panel 已輸出 `Evidence: 1 項` 且移除通用 Confirm／Reject，但既有測試仍期待 `Evidence: EV-4242` 與 Confirm／Reject 文案。
- 完整 log：[agent-state/plan-a-focused-batch-20260816.log](plan-a-focused-batch-20260816.log)。

### 未解風險

- focused batch 尚未全綠；此結果不支持宣稱 Plan A 驗證完成。未執行 full suite、check 或任何重試。

## Milestone：2026-08-16 visible content contract GREEN 驗證

### 結論

- 指定 extension public-boundary 測試通過；確認 WAIT_USER panel 保留 Decision、顯示 evidence count，且不含 raw evidence ID、Confirm 或 Reject。
- 未修改 production code、test code 或文件。

### 測試結果

- 命令：`Set-Location forge-runtime; npx tsx --test --test-name-pattern="^Extension_WhenPanelIsEmitted_ShouldUseVisibleContentContract$" tests/extensions/forge-runtime-extension.test.ts`
- exit code：`0`；`1 passed、0 failed、0 cancelled、0 skipped、0 todo`。
- 完整 log：[agent-state/wait-user-fixed-custom-input-20260815-green-visible-content-contract-20260816.log](wait-user-fixed-custom-input-20260815-green-visible-content-contract-20260816.log)

### 未解風險

- 僅執行指定精準測試；未執行其他測試、full suite 或 check。

## Milestone：2026-08-16 Plan A focused batch 通關驗證

### 結論

- 指定三檔 focused batch 全數通過；未修改 production code、test code 或文件。

### 測試結果

- 命令：`Set-Location forge-runtime; npx tsx --test tests/extensions/forge-runtime-extension.test.ts tests/grill/grill-skill.test.ts tests/ui/wait-user-panel.test.ts`
- exit code：`0`；`81 tests、81 pass、0 fail、0 cancelled、0 skipped、0 todo`。
- 測試耗時：`1488.7996 ms`；外層執行耗時：`2653 ms`。
- OOM：無；timeout：無。
- 完整 log：[agent-state/plan-a-focused-batch-20260816-pass2.log](plan-a-focused-batch-20260816-pass2.log)。

### 未解風險

- 本次僅執行指定 focused batch；未執行 full suite 或 check。

## Milestone：2026-08-16 current full suite 驗證

### 結論

- 依 `forge-runtime/package.json` 與 Plan A canonical script 執行 `npm test`；完整 suite 通過。
- 未修改 production code、test code 或文件；本 milestone 僅追加 state 與測試 log。

### 測試結果

- 命令：`Set-Location forge-runtime; npm test`
- package script：`tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/**/*.test.ts`
- exit code：`0`；`122 tests、122 pass、0 fail、0 cancelled、0 skipped、0 todo`。
- 測試內耗時：`31034.0745 ms`；外層耗時：`00:00:31.7731572`。
- OOM：無；timeout：無；未加入 heap flag、未縮小 pattern、未自動重試。
- 完整 log：[full-suite-20260816.log](../forge-runtime/agent-state/full-suite-20260816.log)

### 未解風險

- 本次僅完成 current full suite；未在此 milestone 執行 `npm run check` 或其他額外驗證。

## 靜態檢查里程碑（2026-08-16）

- 指令：`cd forge-runtime && npm run check`
- 結果：exit code `0`；`tsc --noEmit -p tsconfig.json` 與 `tsc --noEmit -p tsconfig.pi-interactive.check.json` 均通過。
- 耗時：`13260 ms`（約 13.26 秒）。
- 完整輸出：[forge-runtime/agent-state/static-check-20260816.log](../forge-runtime/agent-state/static-check-20260816.log)
- 本里程碑未修改程式碼或文件。

## Milestone：2026-08-16 relevance-failure WAIT_USER dedupe RED

### 結論

- 指定 relevance-failure 重入測試已確認預期 RED；未修改 production code 或 test code。
- 重入路徑在 dedupe／publish-count 斷言前，先因 `WAIT_USER -> WAIT_USER` 非法 transition 失敗。

### 測試結果

- 測試：`Extension_WhenRelevanceFailureIsReentered_ShouldPublishTheSameWaitUserPanelOnlyOnce`
- 命令：`Set-Location forge-runtime; npx tsx --test --test-name-pattern="^Extension_WhenRelevanceFailureIsReentered_ShouldPublishTheSameWaitUserPanelOnlyOnce$" tests/extensions/forge-runtime-extension.test.ts`
- exit code：`1`；`1 failed、0 passed、0 cancelled、0 skipped、0 todo`。
- 完整 log：[agent-state/wait-user-fixed-custom-input-20260815-red-relevance-failure-dedupe.log](wait-user-fixed-custom-input-20260815-red-relevance-failure-dedupe.log)

### 具體失敗點

- 測試斷言：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts:205`。
- 非法 transition：`forge-runtime/src/workflow/state-machine.ts:86`；呼叫路徑經 `orchestrator.ts:39`、`session-state.ts:268`、`extensions/forge-runtime.ts:793`。
- 因此尚未進入 publish count 斷言；目前證據是重入的非法 transition，而非計數結果。

### 未解問題

- 等待獨立 production 實作角色在既有 relevance-failure／WAIT_USER dedupe seam 做最小 GREEN；本角色不追加修改。

## Milestone：2026-08-16 review-fix 後 canonical full suite 驗證

### 結論

- 在 `forge-runtime` 依 `package.json` canonical script 執行一次 `npm test`；完整 suite 通過。
- 本次未修改 production code、test code 或文件；僅新增測試 log 並追加本 milestone。

### 測試結果

- 命令：`Set-Location forge-runtime; npm test`
- package script：`tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/**/*.test.ts`
- exit code：`0`；`123 tests、123 pass、0 fail、0 cancelled、0 skipped、0 todo`。
- 測試內耗時：`19935.5302 ms`；外層耗時：`00:00:20.5941174`。
- OOM：無；timeout：無；未加入 heap flag、未縮小 pattern、未自動重試。
- 完整 log：[post-review-full-suite-20260816.log](../forge-runtime/agent-state/post-review-full-suite-20260816.log)。

### 未解風險

- 本次僅完成 canonical full suite；未執行 `npm run check`、TUI 或其他額外驗證。

## Milestone：2026-08-16 review-fix 後靜態檢查

### 結論

- 在 `forge-runtime` 依 `package.json` canonical script 執行一次 `npm run check`；兩個 TypeScript no-emit 檢查均通過。
- 本次未修改 production code、test code 或文件；僅新增檢查 log 並追加本 milestone。

### 檢查結果

- 指令：`Set-Location forge-runtime; npm run check`
- 檢查段落：`tsc --noEmit -p tsconfig.json`、`tsc --noEmit -p tsconfig.pi-interactive.check.json`
- exit code：`0`。
- 外層耗時：`10703 ms`（約 10.70 秒）。
- 完整 log：[agent-state/post-review-static-check-20260816.log](post-review-static-check-20260816.log)

### 未解風險

- 本次僅完成靜態檢查；未執行測試、TUI 或其他額外驗證。

## Milestone：2026-08-16 review-fix 後 scripted PI TUI gate

### 結論

- 依序完成 focused 與完整 scripted PI TUI gate；兩道 gate 均通過。
- 本次未修改 production code、test code 或文件；僅新增兩份測試 log 並追加本 milestone。

### 測試結果

- focused 指令：`Set-Location forge-runtime; npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-name-pattern="^PiTui_WhenNeedsConfirmationCompletes_ShouldShowQuestionAndAdvanceAfterAnswer$" tests/extensions/pi-grill-interactive.test.ts`
- focused 結果：exit code `0`；`1 test、1 pass、0 fail、0 cancelled、0 skipped、0 todo`；測試內耗時 `5342.3916 ms`；外層耗時 `6325 ms`。
- focused 完整 log：[agent-state/wait-user-fixed-custom-input-20260815-post-review-tui-focused-20260816.log](wait-user-fixed-custom-input-20260815-post-review-tui-focused-20260816.log)
- full 指令：`Set-Location forge-runtime; npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit tests/extensions/pi-grill-interactive.test.ts`
- full 結果：exit code `0`；`4 tests、4 pass、0 fail、0 cancelled、0 skipped、0 todo`；測試內耗時 `6395.8749 ms`；外層耗時 `7391 ms`。
- full 完整 log：[agent-state/wait-user-fixed-custom-input-20260815-post-review-tui-full-20260816.log](wait-user-fixed-custom-input-20260815-post-review-tui-full-20260816.log)

### 證明範圍

- 證明 review-fix 後指定 `pi-grill-interactive.test.ts` 的 4 個 scripted PI TUI 情境均可通過，包含 NEEDS_CONFIRMATION 問題顯示與回答後前進。
- focused gate 只證明指定 NEEDS_CONFIRMATION 情境；full gate 證明該檔案目前列出的 4 個測試。

### 未解風險

- 本次未執行 canonical full suite、`npm run check` 或其他非 scripted TUI 驗證；其結果不由本 milestone 證明。

## Milestone：2026-08-16 同一 needs-confirmation grill result 重入 RED

### 結論

- 指定測試已確認預期 RED；未修改 production code 或 test code。
- 第二次相同 `needs-confirmation` grill result 重入時，在 selector／panel 單次顯示斷言前因 `WAIT_USER -> WAIT_USER` 非法 transition 失敗。

### 測試結果

- 測試：`Extension_WhenSameNeedsConfirmationGrillResultIsReentered_ShouldShowSelectorAndPanelOnlyOnce`
- 命令：`Set-Location forge-runtime; npx tsx --test --test-name-pattern="^Extension_WhenSameNeedsConfirmationGrillResultIsReentered_ShouldShowSelectorAndPanelOnlyOnce$" tests/extensions/forge-runtime-extension.test.ts`
- exit code：`1`；`1 failed、0 passed、0 cancelled、0 skipped`。
- 完整 log：[agent-state/wait-user-fixed-custom-input-20260815-red-grill-result-reentry.log](wait-user-fixed-custom-input-20260815-red-grill-result-reentry.log)

### 具體失敗點

- 測試斷言：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts:2379`。
- 錯誤：`Invalid transition: WAIT_USER -> WAIT_USER`。
- 呼叫路徑：`forge-runtime/src/workflow/state-machine.ts:86` → `src/workflow/orchestrator.ts:39` → `src/runtime/session-state.ts:268` → `extensions/forge-runtime.ts:201` → `extensions/forge-runtime.ts:545`。

### 未解問題

- 等待獨立 production 實作角色在既有 grill result／WAIT_USER dedupe seam 做最小 GREEN；本角色不追加修改。

## Milestone：2026-08-16 final focused batch 驗證

### 結論

- 指定三檔 focused batch 全數通過；未修改 production code、test code 或文件。

### 測試結果

- 命令：`Set-Location forge-runtime; npx tsx --test tests/extensions/forge-runtime-extension.test.ts tests/grill/grill-skill.test.ts tests/ui/wait-user-panel.test.ts`
- exit code：`0`；`83 tests、83 pass、0 fail、0 cancelled、0 skipped、0 todo`。
- 測試內耗時：`1365.8401 ms`；外層耗時：`2483 ms`。
- OOM：無；timeout：無。
- 本次輸出已回傳父代理；未執行其他 batch。

### 未解風險

- 本次僅完成指定 focused batch；未由本角色執行其他驗證。

## Milestone：2026-08-16 canonical full suite 驗證

### 結論

- canonical `npm test` 全數通過；本次未修改程式碼或文件，僅新增測試 log 並追加本 milestone。

### 測試結果

- 命令：`Set-Location forge-runtime; npm test`
- exit code：`0`；`124 tests、124 pass、0 fail、0 cancelled、0 skipped、0 todo`。
- 測試內耗時：`22117.2854 ms`；外層耗時：`22.74 s`。
- OOM：無；timeout：無；重試：無；額外 flags：無。
- 完整 log：[forge-runtime/final-full-suite-validation-20260816.log](../forge-runtime/final-full-suite-validation-20260816.log)

### 未解風險

- 本次僅證明 canonical `npm test`；未由本角色執行其他 batch、靜態檢查或 TUI 驗證。

## Milestone：2026-08-16 forge-runtime static check 驗證

### 結論

- `forge-runtime` 的 `npm run check` 通過；本次未修改程式碼或其他文件。

### 檢查結果

- exit code：`0`。
- 第一段：`tsc --noEmit -p tsconfig.json`，通過。
- 第二段：`tsc --noEmit -p tsconfig.pi-interactive.check.json`，通過。
- 耗時：`10505 ms`（外層計時）。
- Log：[forge-runtime/static-check-20260816.log](../forge-runtime/static-check-20260816.log)

### 未解風險

- 本次僅完成指定 static check；未執行其他 batch 或驗證命令。

## Milestone：2026-08-16 final scripted PI TUI gate 驗證

### 結論

- 指定 focused 與 full scripted PI TUI gate 均通過；本次未修改程式碼或文件，僅新增測試 log 並追加本 milestone。

### 測試結果

- focused 命令：`npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-name-pattern="^PiTui_WhenNeedsConfirmationCompletes_ShouldShowQuestionAndAdvanceAfterAnswer$" tests/extensions/pi-grill-interactive.test.ts`
  - exit code：`0`；`1 test、1 pass、0 fail、0 cancelled、0 skipped、0 todo`。
  - 測試內耗時：`5594.5604 ms`；外層耗時：`6726 ms`。
  - Log：[forge-runtime/final-scripted-tui-focused-20260816.log](../forge-runtime/final-scripted-tui-focused-20260816.log)
- full 命令：`npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit tests/extensions/pi-grill-interactive.test.ts`
  - exit code：`0`；`4 tests、4 pass、0 fail、0 cancelled、0 skipped、0 todo`。
  - 測試內耗時：`6313.2305 ms`；外層耗時：`7453 ms`。
  - Log：[forge-runtime/final-scripted-tui-full-20260816.log](../forge-runtime/final-scripted-tui-full-20260816.log)

### 未解風險

- 本次僅完成指定 scripted PI TUI focused/full gate；未由本角色執行其他 batch、靜態檢查或修改。

## 最終 closure milestone（2026-08-16）

### 已完成項目

- WAIT_USER custom Editor／trim／blank Enter／Escape／shared resume 已覆蓋。
- 新 clarification decisionId、相同 pending decisionId 在 completion、grill ambiguous、grill-result、relevance failure ingress 共用一次性 publish seam。
- panel 僅顯示 unique evidence count，不顯示 raw IDs、Confirm／Reject；保留 Decision；completion prose suppression 通過。
- final review closure 完成；Plan A implementation、automated/scripted gates 完成。

### 重要決策

- 無 decisionId ingress 無法做 pending-id dedupe；保留此低風險邊界，不替使用者決定 policy。
- Plan B 人工視覺驗收不是 Plan A code failure，須由使用者核准後進行。

### 修改檔案

- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/src/grill/grill-skill.ts`
- `forge-runtime/src/ui/wait-user-panel.ts`
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `forge-runtime/tests/grill/grill-skill.test.ts`
- `forge-runtime/tests/ui/wait-user-panel.test.ts`
- 本 ticket durable docs：`CONTEXT.md`、`docs/adr/ADR-0009-wait-user-fixed-custom-input.md`、`docs/PLAN-A.md`、`docs/handoff.md`、本檔。

### 測試結果

- focused Plan A：83/83 pass。
- canonical `npm test`：124/124 pass，無 OOM／timeout。
- `npm run check`：兩段 `tsc --noEmit` 通過。
- scripted PI TUI：focused 1/1、full 4/4 pass。
- final review：Standards 0 findings；Spec finding 已修正，closure 0 findings。

### 未解問題

- Plan B 人工視覺驗收、固定 widget tree、selectList autocomplete render coverage 尚未完成。
- 無 decisionId ingress 無法做 pending-id dedupe。

### 下一步

- 等待使用者決定是否進入 Plan B 人工視覺驗收。

## Milestone：2026-08-16 sticky marker 風險列為下一階段最高優先級

### 已完成項目

- 已將 WAIT_USER sticky marker 失敗、取消、無 UI 與相同 `decisionId` 重試風險記錄至 `docs/handoff.md`。
- 已將此風險列為下一階段最高優先級，並保留 answered `decisionId` reuse enforcement 與不同 `decisionId` reentry policy 的待決策狀態。

### 重要決策

- 下一階段先以 RED 測試覆蓋失敗、取消、無 UI、相同 ID 重試，再定義並實作 rollback／commit 語意。
- 2026-08-16 使用者已知悉並接受這項風險，授權本次照樣 commit；此授權不代表問題已解決。

### 修改檔案

- `docs/handoff.md`
- `agent-state/wait-user-fixed-custom-input-20260815.md`

### 測試結果

- 獨立代理已在隔離 worktree 對 staged tree 完成驗證：`npm test` 124/124、`npm run check` exit 0、聚焦 PI TUI 1/1、完整 PI TUI 4/4。
- 先前失敗皆因隔離 worktree 缺少 ignored fixtures 或 dependencies；補齊與主 repo 相同的唯讀測試資產後全數通過，未涉及程式修正。

### 未解問題

- sticky marker 的 rollback／commit 語意尚未定義或實作。
- answered `decisionId` 的 runtime reuse enforcement 尚未實作。
- WAIT_USER 期間不同 `decisionId` reentry 的 reject、ignore 或 replace policy 尚待使用者決策。

### 下一步

- 由獨立測試代理先針對失敗、取消、無 UI 與相同 ID 重試建立 RED，再依使用者決策實作最小修正。
