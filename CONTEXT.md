# Forge Runtime v4 Context

日期：2026-08-17

## 目標

- 在 `forge-runtime/` 內建立 Forge Runtime v4 的可實作基線。
- 基線必須遵守 `FORGE_RUNTIME_Arch_v4.md`：Workflow 決定流程與 state，LLM 只負責理解、推理、產生候選與寫碼。
- 實作形式預設是 PI package / extension / skill，不修改 `pi-main/` core；只有使用者核准且由 ADR-0012／Plan A 限定的 display-only 最小 core 例外可修改 coding-agent core，其他 core 變更仍禁止。

## 目前 repo 狀態

- repo root 已包含 `docs/`、`agent-state/`、`Memory/` 等交付文件；Forge 新實作仍只位於 `forge-runtime/`，`pi-main/` 維持上游參考用途。
- `forge-runtime/` 已建立獨立 TypeScript package，含 state machine、orchestrator、light discovery、candidate relevance gate、deep executor、context builder、repair routing 與最小 extension entry。
- `docs/handoff.md`、`CONTEXT.md`、`docs/adr/` 在本次設計前皆不存在；本次依 workflow 補齊。

## 已驗證的上游 PI 事實

- PI core 明確走 minimal 路線，擴充應優先使用 extension，而不是把 workflow 能力塞進 core。來源：`pi-main/CONTRIBUTING.md`。
- `pi-main/packages/coding-agent/README.md` 明確說明：PI 提供 Extensions、Skills、Prompt Templates、Themes、Pi Packages；sub agents 與 plan mode 不內建，鼓勵由第三方 package 擴充。
- `pi-main/packages/coding-agent/examples/extensions/with-deps/package.json` 顯示 package 可透過 `package.json` 內的 `pi.extensions` 掛載 extension。
- `pi-main/packages/coding-agent/src/core/extensions/types.ts` 顯示 Extension API 已具備事件、tool hook、session、UI widget 與自定義工具註冊能力，足以承載 runtime orchestration 的外掛層。
- `pi-main/packages/agent/src/harness/skills.ts` 與 `pi-main/packages/coding-agent/src/core/skills.ts` 顯示 skill 會從目錄遞迴載入，適合把 Forge workflow-native skills 包在 Forge package 中。

## v4 的固定架構邊界

- Forge 不 fork PI core。
- Forge 是建在 PI 之上的 workflow runtime，而不是一組 prompt collection。
- Workflow 擁有 state transition 最終控制權。
- Mandatory stages 至少包含：Light Discovery、Grill、Deep Knowledge、Context、ADR、Planning、Implement Gate、TDD、Validation、Review、Judge、Repair。
- Recommendation 不等於 Decision；涉及設計歧義時必須進入 `WAIT_USER`。

## Grill Recovery 術語

- `Grill Invocation Transport`：從 Forge `input` transform 到模型 provider request 的完整受控傳遞鏈；其內容在 provider 消費前不得被顯示或歷史整理邏輯改寫。
- `Provider-Facing Grill Invocation`：實際送交模型的結構化 Grill 訊息，包含 completion contract、runtime-issued `roundId`、snapshot manifest 與目前任務；它不同於使用者原始請求的畫面呈現。
- `Completion Omission`：一個 Grill attempt 以 assistant 終局結束，但未呼叫 `forge_grill_complete`。
- `Grill Attempt`：同一 round／snapshot 的一次有界執行；明確 retry 會建立新 attempt，但不建立新 round 或 snapshot。
- `RECOVERY_REQUIRED`：completion omission 後的 Grill substate／marker，不是新的 top-level workflow stage。
- `Grill Recovery`：顯示 retry／cancel／switch 後停止背景活動並等待使用者；不包含自動 replay 或自動 Deep。
- `Settled`：目前沒有待送出的 follow-up、steer 或 assistant turn；只有新的使用者輸入可以再啟動動作。

### Completion recovery interface（使用者於 2026-08-13 確認）

- `ForgeSessionState` 以私有 attempt 狀態維護每個 attempt 的 omission budget；內部 attemptId 與 omission marker 不進 `GrillRound` 公開 contract。
- 公開 `recordCompletionOmission(): boolean`：只在該 attempt 首次 omission 時記錄並進入 recovery，回傳 `true`；同 attempt 重複事件回傳 `false` 且 no-op。
- 公開 `retryGrillRound(): GrillRound | undefined`：只在 recovery 中可用，以原 roundId、request 與 immutable snapshot 建立／回傳 retry round，並重置 omission budget。
- 新 attempt 的 observable contract 是 retry 後首次 omission 可再次回傳 `true`。
- 此 interface 刻意保持小而深，避免測試耦合私有 attempt 狀態。

### Grill acceptance 進度（2026-08-14）

- Plan A #1 至 #17 已完成並 GREEN；final review 的 Standards 1 個 P1 與 Spec 2 個驗收缺口均已修正，當前 0 open findings。
- production 已落在 `forge-runtime/src/runtime/session-state.ts` 與 `forge-runtime/extensions/forge-runtime.ts`：session seam 維護 per-attempt omission budget，extension 完成 omission settle／restore tools、recovery continue 拒絕與明確一次 retry followUp。
- #8 至 #13 已完成互動、Deep、panel、prompt、空 manifest 與 relevance gate slices；`116` 僅為預估，刪除 stale test 後淨測試數不固定。
- #14 seam 精確形狀已核准：`InteractiveModeOptions` 新增 optional `terminal?: Terminal`，constructor 將 options.terminal 轉交既有 `createInteractiveTui`；省略時仍由 factory 建立 `ProcessTerminal`。
- seam 僅供真 PI TUI test-only 使用；不得注入 TUI factory、不得新增依賴、不得改 runtime workflow 語意或 pi-main 其他功能。
- 非 active Grill attempt 的兩個 Grill 工具已以 `pendingGrillRun && stage===GRILL` 共同 gate，並加上 execute guard，確保 fail-closed。
- 正常 TUI 明確排除 `continue`；omission 靜置不自動 retry，只有 `/forge-runtime retry` 建立下一 attempt。
- `forge-runtime/tsconfig.pi-interactive.check.json` 已加入 Plan A 文件邊界；durable state 的 upstream 測試路徑已修正為 `pi-main/packages/coding-agent/test/interactive-tui.test.ts`。
- 驗證證據：P1 1/1 exit 0（`agent-state/plan-a-review-p1-green.log`）、TUI 4/4 exit 0（`agent-state/plan-a-review-tui-green.log`）、`npm run check` exit 0（`agent-state/plan-a-final-check.log`）、`npm test` 114/114 exit 0（`agent-state/plan-a-final-suite-after-review.log`）。upstream seam Vitest 4/4；upstream `npm run check` 僅剩既有 `packages/ai` 測試型別錯誤，非 terminal seam。

## 本次設計選定的實作範圍

- 先做 MVP：能在 `forge-runtime/` 內跑出 deterministic workflow skeleton，並把 state machine、mandatory stage、evidence traceability、WAIT_USER contract 固定下來。
- UI / widget / 視覺化 confirmation panel 獨立成後續 Plan B，不阻塞 Plan A 的底層基線。
- 初版 fan-out 只保留角色隔離與 orchestration contract，不一開始拆成十幾個 agent。

## 核心模組落點

- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/src/workflow/`
- `forge-runtime/src/discovery/`
- `forge-runtime/src/grill/`
- `forge-runtime/src/knowledge/`
- `forge-runtime/src/evidence/`
- `forge-runtime/src/decision/`
- `forge-runtime/src/execution/`
- `forge-runtime/src/validation/`
- `forge-runtime/src/repair/`
- `forge-runtime/skills/`
- `forge-runtime/schemas/`
- `forge-runtime/tests/`

## 已確定決策

- 使用 `forge-runtime/` 作為唯一新實作根目錄。
- 以 package + extension + skills 形式落地，預設不碰 `pi-main/`；僅使用者核准且由 ADR-0012／Plan A 限定的 display-only 最小 core 例外可修改，其他 `pi-main`／core 仍不碰。
- 真 PI TUI #14 至 #17 是明確核准的 test-only 例外：只增加 `InteractiveModeOptions.terminal` seam，不改 pi-main runtime workflow 或其他功能。
- 先把 workflow contract 做對，再補 TUI / custom UI。
- TDD 與獨立 review 是 runtime policy，不是提示詞建議。
- 正式 ingress 僅限一般自然工程請求與 asset approval；控制命令不構成新的正式 ingress。
- v1 每個 session 只允許一個 open workflow；`WAIT_USER` 與 `open_workflow` 皆優先走 resume，不雙開新題。
- `INTENT_UNDERSTANDING` 的最小 contract 固定為：`route`、`goal`、`taskKind`、`ambiguities`、`lightDiscoverySeeds`。
- `LIGHT_DISCOVERY` v1 只讀根目錄 `wiki/` 與必要的極窄 local code lookup；`docs/`、`CONTEXT.md`、ADR 與 Plan 不再是 Light Discovery 來源。
- `passthrough` 只保留給純問答、閒聊、翻譯、改寫與非工程任務；工程請求一律先過 Forge router。
- 只要有歧義或跨人類決策邊界，就必須進 `GRILL`；`INTENT_UNDERSTANDING` 不可代替使用者做設計決策。
- `GRILL` 可使用工具，但只限對 `LIGHT_DISCOVERY` 明確產出的候選來源做唯讀查核；不得擴大成 repo-wide／OS-wide 搜尋，也不得修改 workspace。工具權限必須由 Workflow／Extension gate 控制，不可只靠 LLM prompt。
- `GRILL` 是受控的多輪決策迴圈：`NEEDS_CONFIRMATION` 必須透過 completion payload 提交恰好一題；使用者每次作答後記錄該決策並自動進入下一輪 `GRILL`，只有 `READY_FOR_DEEP` 可離開迴圈進入 Deep Knowledge。
- 同一個 `GRILL` 決策迴圈固定使用同一份 `LIGHT_DISCOVERY` snapshot；只有使用者改變 task goal、target 或技術範圍時，才明確重新執行 Light Discovery，`GRILL` 不可自行擴大候選集合。
- `GRILL` 每輪完成時必須以專用 `forge_grill_complete` tool 提交結構化結果；工具蒐證與 workflow completion 是分離的控制通道。
- `GRILL` v1 的工具面只包含 `forge_grill_evidence(candidateId)` 與 `forge_grill_complete(payload)`；`tool_call` 採 deny-by-default，所有原生與未知工具一律阻擋。
- `GRILL` 使用不可變的 `GrillEvidenceSnapshot`，僅收錄 Light Discovery 明確引用的 `wiki` 文件、`code_base` 候選與存在時的對應 target source；模型只能以 opaque `candidateId` 查核。
- `forge_grill_complete` 成功後必須原子地完成狀態轉移，並壓制同一 agent turn 餘下的 streaming 與終局 prose；不可用 `abort()` 取代此規則。
- `forge_grill_complete` 的結果只保留 `NEEDS_CONFIRMATION` 與 `READY_FOR_DEEP`；候選證據不足時以單一 `NEEDS_CONFIRMATION` 問題請使用者補來源或明確改變 Discovery 範圍。
- completion payload 的 `evidence` 僅能引用本 workflow 已由 `forge_grill_evidence` 回傳的 candidate id；非空 snapshot 的第一輪至少須成功查核一筆 evidence，空 manifest 則允許零 evidence 的單一來源／scope 問題，後續 round 可重用既有查核結果。
- `WAIT_USER` 的 options 是快捷選擇與 recommendation，不限制使用者；每個 TUI selector 固定把 runtime 擁有的「自行輸入…」排在最後，選取後在同一互動中接受自由文字。trim 後的非空自由回答與選項回答同樣記錄為該 `decisionId` 的人類決策，再進入下一輪 `GRILL`；空白不送出，取消只返回 selector。UI 不得依選項文案猜測是否需要自訂輸入。
- 為符合 PI coding-agent 的 `ctx.ui.custom` factory contract，Forge 以四參數 `(tui, hostTheme, keybindings, done)` 接收 callback，並在 Forge 內將 host `Theme` 轉成 `EditorTheme`：`borderColor` 使用 `hostTheme.fg("borderMuted", text)`，`selectList` 使用既有 accent／muted formatter。Forge package runtime dependency 固定為 `@earendil-works/pi-tui@0.83.0`；除使用者核准的 ADR-0012 display-only core 例外外，不修改 `pi-main/`，不改用 `ctx.ui.editor`／`input`，也不自製 Editor。
- 只有明確 `/forge-runtime switch <request>` 可要求改變 task scope；replacement 必須經正式 ingress 建立新的 Light Discovery snapshot，不得經 `/grill-run` bridge。其他自由回答皆保留在現有 decision loop，候選不足時只能請使用者使用 switch。
- 若 assistant 終局未呼叫 `forge_grill_complete`，runtime 必須記錄該 attempt 首次 `Completion Omission`，保留目前 round，並進入 `GRILL + RECOVERY_REQUIRED`；顯示 `retry / cancel / switch` 後 settled，不做 background steer、auto replay 或自動 Deep。
- `/forge-runtime retry` 是 completion omission 的唯一重跑入口：使用同一 round／snapshot 建立新 attempt；`/forge-runtime continue` 不再承擔 omission recovery。
- `NEEDS_CONFIRMATION` 立即顯示問題並進 `WAIT_USER`；回答後自動下一輪 Grill。`READY_FOR_DEEP` 通過 runtime gate 後立即自動進 Deep Knowledge，兩者都不要求 `continue`。
- 可見 panel 的訊息契約固定為 `content: panelText`、`display: true`。
- Grill prompt 不輸出 assistant prose；需要確認時只能由 `forge_grill_complete.questions` 提交恰好一題，不再使用「只輸出一個問題」的 assistant-output 指令。
- `forge_grill_complete` payload 固定為既有 `StructuredGrillResult` 加 runtime-issued `roundId`：`roundId`、`status`、`questions`、`recommendation`、`evidence`、`requiresUserConfirmation`；`questions[0].id` 即 `decisionId`。
- 正常 runtime 不得再以 assistant 終局文字 JSON 推進 `GRILL`；`/forge-runtime grill-result` 與 `/forge-runtime grill ambiguous <json>` 僅保留為明確的測試／除錯 injection。
- Workflow 每輪發出不可由模型自訂的 `roundId`，`forge_grill_complete` 必須帶回該 id；`NEEDS_CONFIRMATION` 的 `questions[0].id` 是穩定 `decisionId`，已回答的 decision 不可重問或重複提交。
- active workflow control 的一般 UX 使用 `/forge-runtime continue`、`cancel`、`switch <request>`；completion omission recovery 另使用明確 `/forge-runtime retry`。
- `switch` 的語義固定為 `cancel + start_forge(new request)`，不引入 queue 或 parallel workflows。
- 知識來源固定分三層：`wiki/` 管文件知識、`code_base/` 管代碼知識、當前專案原始碼管真實落地。
- `LIGHT_DISCOVERY` 與 `DEEP_KNOWLEDGE` 的文件知識來源都只允許讀取根目錄 `wiki/`；不得 fallback 到 repo 其他目錄或整個作業系統。
- `code_base/` 是代碼知識庫，供 agent 做範例學習、模式比對與參考查詢；不得當成當前專案真實狀態。
- `wiki/` 與 `code_base/` 的 metadata 都是 optional acceleration layer，不是必要前置條件；沒有 metadata 時，agent 仍須能靠路徑、檔名、標題、檔案類型與內容關鍵字窄搜運作。
- 若根目錄缺少 `wiki/` 或 `code_base/` 任一目錄，agent 必須停下來詢問使用者是否接受在缺少正式知識庫/代碼庫的情況下繼續。
- 若 `code_base/` 與當前專案原始碼衝突，agent 必須停下來展示衝突點，待使用者釐清後才能繼續。

## 穩定 Runtime 語意

- **Formal Ingress**：自然工程請求與 asset approval 建立正式 workflow；`/grill-run` 只作歷史相容 alias，必須正規化進 formal ingress 並取得正式 round／snapshot。
- **Debug Injection**：`/forge-runtime grill-result <json>` 與 `/forge-runtime grill ambiguous <json>` 只供測試／除錯，不是正式 ingress。
- **Open Workflow**：一個 session 同時只允許一個未完成 workflow；`continue` 維持既有工作、`cancel` 放棄它、`switch` 以新請求取代它。
- **Grill Tool Boundary**：Grill 只允許 evidence 與 completion 兩個 domain tool；缺少可強制此邊界的 runtime capability 時不得啟動 Grill。
- **Grill Evidence Snapshot**：Light Discovery 為一個決策迴圈建立不可變候選集合；候選以 opaque id 查核，Grill 不得自行擴大來源。
- **Grill Decision Loop**：`NEEDS_CONFIRMATION` 進 `WAIT_USER`，回答成為人類決策後自動開始下一 round；`READY_FOR_DEEP` 才能離開 Grill。
- **Grill Completion Recovery**：completion omission 進 `GRILL + RECOVERY_REQUIRED` 並 settled；只有明確 `retry` 可重跑同 round／snapshot 的新 attempt，`continue` 不承擔 omission recovery。
- **Discovery Completion Guard**：非空 manifest 的首輪需要已查核 evidence；空 manifest 與 relevance failure 必須轉成可回答的來源／scope 問題。
- **Visible Panel**：面向使用者的問題、狀態與 recovery action 必須可見；不可只存在於隱藏 details 或 tool result。
- **PI Extension Surface**：PI 是 Forge 的承載 runtime；Forge 預設只使用 PI 公開的 extension、session、tool 與 UI surface，不修改 PI core；唯一例外是使用者核准且由 ADR-0012／Plan A 限定的 display-only 最小 core 變更，其他 core 變更仍禁止。
- **Extension Loader Compatibility**：Forge package 只依賴 PI extension loader 公開支援的 runtime module alias；package 匯入相容性不改變 workflow 或 completion contract。

## Not Building

- 不修改 `pi-main/` 的 runtime workflow、其他功能或依賴；本 ticket 的唯一核准例外是 ADR-0012 所定義的 coding-agent display-only core 路徑。Plan A #14 的 test-only terminal injection seam 亦維持原界線。
- 不在第一版導入完整 REST / Web / CI 介面層。
- 不在第一版接上所有知識來源。
- 不在第一版做大型 reasoning plugin 生態。
- 不在第一版做完整 UI polish。

## ADR-0009 現況同步（2026-08-16 最終基線）

- Plan A prompt-contract 增補已完成：focused 5/5、當時 `npm test` 116/116、`npm run check` exit 0，Standards／Spec review 各 0 findings。這些是該增補當時的驗證，不代表目前 Plan B 或完整 extension suite 已通過。
- Plan B selector slice 的歷史驗證為 71/71；不得描述為目前完整 suite 通過。
- 使用者已核准並安裝 `@earendil-works/pi-tui@0.83.0`，只修改 Forge package，不修改 `pi-main/`。Forge 已依 PI 四參數 `(tui, hostTheme, keybindings, done)` factory 建立 `EditorTheme` adapter，並移除冗餘 `onEscape` 指派。
- 有效 custom 答案與普通選項在嘗試 resume 後會結束 command；空白 Enter 不送出，Escape 才返回 selector。三個 focused regression tests 3/3 通過，`npm run check` exit 0，scope blast 未發現 sibling bug。
- focused Plan A：83/83 pass；canonical `npm test`：124/124 pass，無 OOM／timeout；`npm run check` 兩段 `tsc --noEmit` 均通過。
- scripted PI TUI focused 1/1、full 4/4 通過；final review Standards 0 findings、Spec finding 已修正，closure 0 findings。
- production 已覆蓋 custom Editor／trim／blank Enter／Escape／shared resume、clarification decisionId、相同 pending decisionId 的一次性 publish、unique evidence count、completion prose suppression。
- 未完成且不可宣稱：Plan B 人工視覺驗收、固定 widget tree、selectList autocomplete render coverage；需使用者核准與驗收。

## WAIT_USER ticket closure（2026-08-16）

- Plan A implementation 與 automated/scripted gates 已完成；下一步等待使用者決定是否進入 Plan B 人工視覺驗收。
- 無 decisionId 的 ingress 無法做 pending-id dedupe；此為低風險邊界，policy 不由 agent 代決。

## WAIT_USER 固定輸入術語（2026-08-16）

- **WAIT_USER Answer**：針對待處理問題提交的人類回答，可為快捷回答或自由回答。
- **Clarification Decision**：用來補足語意或範圍的下一個 Grill 決策。
- **Pending Decision**：尚未完成的人類決策及其 `decisionId`。
- **Single Pending Decision**：同一時間只有一個待決策；不同 `decisionId` 的新問題不得取代目前待決策。
- **Same-ID Reentry**：同一待決策的 `decisionId` 再次出現，表示重顯目前問題，不建立新的待決策。
- **Different-ID Reentry**：待決策尚未完成時出現不同 `decisionId`，extension 依 first-pending-wins 靜默忽略新問題；不得拋錯、覆寫原待決策或發布第二個 UI。
- **Unanswered WAIT_USER**：取消、Escape、沒有 UI 或互動失敗而未提交回答時，待決策仍存在，可由自然文字或相同 `decisionId` 再次嘗試。
- **Evidence Presentation**：將證據引用轉成使用者可讀的摘要呈現。
- **Completion Finality**：completion 成功後，該輪不再追加對話內容。

## WAIT_USER ticket 實作與驗證完成（2026-08-17）

- production 已在 `forge-runtime/extensions/forge-runtime.ts` 分離 pending identity 與 UI in-flight lease：不同 ID 靜默忽略；同 ID UI 返回後可重顯；active UI 去重；`finally` 涵蓋正常、Escape／undefined 與 throw；成功回答清除 identity。
- 精準測試套件：87 通過、0 失敗、0 略過；`npm test`：128 通過、0 失敗、0 略過；`npm run check` 兩段 tsc 均通過。
- Standards 審查曾找到文件過期與英文標題，現已修正；Spec 無 runtime 發現、無範圍膨脹。
- 未解缺口：缺少 `decisionId` 的 ingress 不做 dedupe；上游 UI component 不呼叫 `done` 可能永久 pending；方案 B 人工視覺驗收仍待使用者決策。

## 跨工作項目可重用經驗（2026-08-17）

- 待決策識別與 UI 執行中租約必須分開。前者代表決策仍存在，只在成功回答時清除；後者只涵蓋一次 UI 發布到返回，並用 `finally` 清理。
- 同 ID 的依序重顯，與 UI 尚未返回時的重複發布，是不同契約，測試必須分開。
- 紅燈測試必須因目標契約缺失而失敗。編譯、缺依賴、缺生成資料或無關例外，都不是有效紅燈。
- 驗證失敗時，先判定是產品回歸還是環境阻礙。既有 manifest、lock 與正式 hydration 流程能修復環境時，不可改正式程式碼掩蓋問題。
- `CONTEXT.md`、ADR、Plan、handoff 與 agent-state 必須跟完成狀態同步；保留舊狀態時要標示為歷史。

## Grill 呼叫傳輸完整性同步（2026-08-17）

- 三條 production slice 已完成：初始 ingress、知識庫缺失後 approval、`WAIT_USER` 回答後下一 round 均保留完整 Grill invocation 送給 provider。
- 已移除 `pendingUserMessageRewrite` 的宣告、三個 setter、clear 與 user `message_end` replacement；assistant suppression／recovery 行為不變。
- 實際 provider-context 測試為 `PiIngress_WhenInitialGrillIngress_ShouldPreserveFullGrillInvocationInProviderContext`、`PiProvider_WhenKnowledgeBaseApprovalStartsGrill_ShouldReceiveStructuredInvocationInsteadOfApprovalText`、`PiProvider_WhenWaitUserAnswerStartsNextRound_ShouldReceiveStructuredInvocationInsteadOfAnswer`；post-cleanup targeted batch 為 3 pass、0 fail。
- post-review-fix 驗證：full PI TUI 7 pass／0 fail／0 skip；canonical `npm test` 130 pass／0 fail／0 skip；`npm run check` 兩段 tsc 均 pass、no diagnostics。final review 已完成：Standards 0 findings、Spec 0 findings；本 ticket acceptance／closure 完成。
- 「顯示訊息」與「送給 provider 的訊息」分離 seam 列為後續設計待辦，不屬本 ticket scope，尚未核准或實作；若要推進，必須另走 `design-plan-workflow` 並取得人類決策。

## Grill 成功完成的終止邊界（2026-08-19）

- **Grill 成功完成**：`forge_grill_complete` 成功接受後，是目前 Grill 嘗試的終止邊界；該完成事件封口當前代理回合，不能只靠顯示抑制表示結束。
- **WAIT_USER**：代表工作流程正在等待人類回答；產生該狀態的前一個代理回合已經終止，回答後才建立新的 Grill 回合。
- **KNOWLEDGE_UNDERSTANDING**：v1 `READY_FOR_DEEP` 路徑在深度知識完成後的穩定結束點；後續工作流程可由此進入既有下游階段。
- **深度知識後的歧義**：`KNOWLEDGE_UNDERSTANDING → GRILL → WAIT_USER` 的新轉移尚未定義，不由本 ticket 推測或實作。

## Grill 完成終止邊界最終同步（2026-08-20）

- Plan A 已實作完成，使用者已授權修改 `pi-main`；不執行 Plan B。
- `displayOnly` 是 public delivery union；streaming 不 steer/followUp、不 trigger turn，但仍 append/event/persist。`excludeFromContext` 經 provider conversion、compaction rehydrate、branch summarization rehydrate 與 session-file round-trip；不修改 agent harness wire。public `CustomMessage` 與 `CustomAgentMessages.custom` 維持 HEAD，marker 僅在 internal intersection。
- Forge 只在 successful `NEEDS_CONFIRMATION` 傳送 display-only WAIT_USER state message；tool result `terminate=true`。其他 state delivery 不擴張。READY 仍自動進 Deep，不要求 idle。
- 人類回答流程固定為 `WAIT_USER → USER_CONFIRMED → GRILL`：UI/command 先 resume，重用 `pendingReplayInvocation`，再送完整 followUp invocation；direct human input 仍用 `transform`，避免 nested `emitInput`。
- READY regression 與 NEEDS regression 的觀測點以 session/provider marker 為準，不以 roundId viewport 作唯一等待條件。
- 最終驗證見 `docs/PLAN-A.md` 與 state：Forge 132 passed、interactive 9 passed；PI focused 5 files 76 passed／2 skipped；Biome 991 files；branch summarization RED／GREEN 均有 log；PI tsgo 僅保留 `packages/ai` 六個 baseline errors。Forge post-review check/full 均 exit 0；canonical `npm run check` 未跑，因含 `--write`，已改跑唯讀子命令。
- 已知風險：queued steer、extension API fire-and-forget lifecycle、Node `DEP0190` warning、PI `packages/ai` 六個 baseline errors。

## Canonical 語意補充（2026-08-20）

- **Display-only Custom Message**：ExtensionAPI 的 `deliverAs: "displayOnly"`；優先於 `triggerTurn`／`steer`／`followUp`／`nextTurn`。訊息進入 UI、transcript、session persistence/reload，但永不進 provider／LLM context，也永不觸發 turn。持久 marker 是 `excludeFromContext?: boolean`；建立時為 `true`，舊 session 缺欄位時維持舊語意，不重用 `display`。
- **Grill Completion Termination Boundary**：成功 `forge_grill_complete` 回傳 `terminate: true` 封口目前代理回合；`NEEDS_CONFIRMATION` 的 WAIT_USER state message 使用 display-only，回答後建立新 Grill round；`READY_FOR_DEEP` 依既有分流進深度知識。terminate 仍可能被已排入的 steer 延續，需由 PI core queue 語意另行驗證。
- **支援基線**：coding-agent `0.83.0`、repo commit `321bbe69e909de9551906967629908a99167d11e`（`321bbe6`）、branch `main`。不建議降版、不保證降版相容、不回填舊 session；舊 PI 不應重開含 display-only 訊息的 session，若必須降版請使用新 session。
- **Not Building**：不修改 `packages/agent/src/harness/*`，不保證跨 package 共用 JSONL；不改 Forge 其他 command/retry/cancel/switch/deep knowledge/state message 的 delivery 語意；不回填舊 session 或提供降版轉換器。

## 2026-08-20 Post-review durable sync

- Spec review P2 已修正：移除 public custom augmentation；public `CustomMessage` 與 `CustomAgentMessages.custom` 回到 HEAD，只有 internal intersection 保留 `excludeFromContext` marker。
- display-only 的排除範圍明確包含 branch summarization rehydrate，不只一般 compaction；summarizer provider conversion 不得洩漏 marker 訊息。
- 最終 review 後下一步為 targeted re-review 與 final handoff；不得再描述為僅完成普通 compaction。
