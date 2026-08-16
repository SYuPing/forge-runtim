# Forge Runtime v4 Context

日期：2026-08-13

## 目標

- 在 `forge-runtime/` 內建立 Forge Runtime v4 的可實作基線。
- 基線必須遵守 `FORGE_RUNTIME_Arch_v4.md`：Workflow 決定流程與 state，LLM 只負責理解、推理、產生候選與寫碼。
- 實作形式必須是 PI package / extension / skill，不修改 `pi-main/` core。

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
- 以 package + extension + skills 形式落地，不碰 `pi-main/`。
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
- 為符合 PI coding-agent 的 `ctx.ui.custom` factory contract，Forge 以四參數 `(tui, hostTheme, keybindings, done)` 接收 callback，並在 Forge 內將 host `Theme` 轉成 `EditorTheme`：`borderColor` 使用 `hostTheme.fg("borderMuted", text)`，`selectList` 使用既有 accent／muted formatter。Forge package runtime dependency 固定為 `@earendil-works/pi-tui@0.83.0`；只修改 `forge-runtime` package manifest／lockfile，不修改 `pi-main/`，不改用 `ctx.ui.editor`／`input`，也不自製 Editor。
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
- **PI Extension Surface**：PI 是 Forge 的承載 runtime；Forge 只使用 PI 公開的 extension、session、tool 與 UI surface，不修改 PI core。
- **Extension Loader Compatibility**：Forge package 只依賴 PI extension loader 公開支援的 runtime module alias；package 匯入相容性不改變 workflow 或 completion contract。

## Not Building

- 不修改 `pi-main/` 的 runtime workflow、其他功能或依賴；僅依核准的 Plan A #14 增加 test-only terminal injection seam。
- 不在第一版導入完整 REST / Web / CI 介面層。
- 不在第一版接上所有知識來源。
- 不在第一版做大型 reasoning plugin 生態。
- 不在第一版做完整 UI polish。

## ADR-0009 現況同步（2026-08-16）

- Plan A prompt-contract 增補已完成：focused 5/5、當時 `npm test` 116/116、`npm run check` exit 0，Standards／Spec review 各 0 findings。這些是該增補當時的驗證，不代表目前 Plan B 或完整 extension suite 已通過。
- Plan B selector slice 的歷史驗證為 71/71；不得描述為目前完整 suite 通過。
- 使用者已核准並安裝 `@earendil-works/pi-tui@0.83.0`，只修改 Forge package，不修改 `pi-main/`。Forge 已依 PI 四參數 `(tui, hostTheme, keybindings, done)` factory 建立 `EditorTheme` adapter，並移除冗餘 `onEscape` 指派。
- 有效 custom 答案與普通選項在嘗試 resume 後會結束 command；空白 Enter 不送出，Escape 才返回 selector。三個 focused regression tests 3/3 通過，`npm run check` exit 0，scope blast 未發現 sibling bug。
- `npm test` exit 1：47 tests 中 44 pass、3 fail；約 123 秒、約 4GB heap OOM，另有 2 個 loader timeout。final Standards／Spec review 皆 0 blocker；`selectList` formatter 尚無實際 autocomplete render coverage。
- 真實 PI TUI acceptance 與 current full suite 尚未完成，ticket 不得標記完成；舊 OOM／type-import probe 未執行。下一步由使用者實機重試相同「自行輸入…」路徑。
