---
title: Forge Runtime v4 Context
type: context
scope: Forge Runtime v4 設計、實作與交接
updated: 2026-08-29
source: FORGE_RUNTIME_Arch_v4.md、docs/adr、docs/PLAN-A.md、docs/handoff.md
status: design-approved-ready-for-red
---

# Forge Runtime v4 Context

日期：2026-08-21

## 目標

- 在 `forge-runtime/` 內建立 Forge Runtime v4 的可實作基線。
- 基線必須遵守 `FORGE_RUNTIME_Arch_v4.md`：Workflow 決定流程與 state，LLM 只負責理解、推理、產生候選與寫碼。
- 實作形式預設是 PI package / extension / skill，不修改 `pi-main/` core；只有使用者核准且由 ADR-0012／Plan A 限定的 display-only 最小 core 例外可修改 coding-agent core，其他 core 變更仍禁止。

## 目前 repo 狀態

- repo root 已包含 `docs/`、`agent-state/`、`Memory/` 等交付文件；Forge 新實作仍只位於 `forge-runtime/`，`pi-main/` 維持上游參考用途。
- `forge-runtime/` 已建立獨立 TypeScript package，含 state machine、orchestrator、light discovery、candidate relevance gate、deep executor、context builder、repair routing 與最小 extension entry。

## 2026-08-21 Intent route-only LLM 現行基線

- `INTENT_UNDERSTANDING` 只輸出嚴格 JSON `{ "route": "passthrough" | "start_forge" }`；輸出不包含 goal、taskKind、ambiguities 或 seeds。
- router 規則只放在 `systemPrompt`；不可信的 raw user input 以獨立 `user` message 傳入，只作分類資料，不得改變規則。明確聊天、翻譯、改寫、一次性資訊查詢與非工程任務判為 `passthrough`；工程或不確定輸入判為 `start_forge`。missing model、completion error、timeout、abort、無效 JSON／schema 都 fail-closed 為 `start_forge`。
- workflow guard 先處理 WAIT_USER、open workflow 與 slash control；`/grill-run` 以 canonical payload wrapper 直接進 `start_forge`，不送 LLM 分類。
- 自然輸入保留 rawText；start_forge 的 goal 與 seed 準備由原始有效文字處理，seed fixed-point helper 留在 extension handoff 的 private helper，不屬 Intent contract；Light Discovery production 與內部測試不在本 ticket scope。
- `understandIntent(input, context)` 的第二參數是唯一 model seam：`IntentModelContext`；`IntentInput` 不含 model context。使用 PI 提供的 `ctx.model` 與 `ctx.modelRegistry.complete()`，固定 10 秒 timeout；本 ticket 未修改 `pi-main/`。
- finalgreen 證據：intent 12/12、Forge extension 91/91、loader smoke 2/2、`npm run check` exit 0、完整 `npm test` 146/146；證據位於 `.tmp/intent-route-only-systemprompt-*.log`。獨立 Standards 與 Spec final review 均為 0 findings，本 ticket 已完成；下一步只能等待使用者確認後再進入 Light Discovery。
- `docs/handoff.md`、`CONTEXT.md`、`docs/adr/` 在本次設計前皆不存在；本次依 workflow 補齊。

## 2026-08-22 Light Discovery 設計詞彙

- `Light Discovery`：在 `start_forge` 之後，依原始 `userMessage` 從受限知識來源找出候選檔案的獨立流程。
- `Discovery public seam`：Light Discovery 對外唯一入口；只接收 workspace/root 與 raw `userMessage`。
- `Input normalization`、`deterministic Core`、`Output normalization`：Light Discovery 內部固定的三段責任邊界。
- `File metadata match`：以檔名、相對路徑與穩定 metadata 比對候選，不代表已讀取或理解檔案內容。
- `Partial discovery`：部分來源或檔案失敗時保留可用 matches，並附 warning；是否 `WAIT_USER` 仍由 workflow 決定。
- 本設計只涵蓋 `wiki/` 與 `code_base/` 的候選檔名／metadata；不改 Intent route-only contract，也不推進 Grill 或 Deep Knowledge。

## 2026-08-22 Light Discovery 實作與驗證完成

- 使用者已核准 ADR-0014 第一階段實作：只掃 `wiki/`、`code_base/` 一般檔案 metadata，每來源最多 3 筆、相對路徑固定排序，輸出 `matches`、`warnings`、`sourceAvailability`；既有缺失來源人工核准流程保留。
- production public seam 位於 `forge-runtime/src/discovery/light-discovery.ts`，只收 rootDir 與 raw userMessage；normalize、scan、output 均在 module 內完成，不產生 full content、summary 或 snapshot。
- `forge-runtime/extensions/forge-runtime.ts` 在模組外建立 Grill／Deep Knowledge 相容 adapter；兩個 caller 傳 raw message。adapter 已讀取內容後依 raw request seeds 真實計算 path/content、`matchedSeeds`、`score`，只讓符合契約者進入 `codeBaseCandidates`。
- 測試遷移已清除 2 個 stale old API callers，刪除 10 個 ADR 淘汰測試、改寫／保留 5 個，還原 2 個強相關 Deep expectations。
- 驗證完成：互動 9/9、focused 79/79、`npm run check` exit 0、完整 `npm test` 140/140，0 fail/skip/todo；僅有既有 Node `DEP0190` warning。implementation、verification 與 two-axis review 均完成。

## 2026-08-23 至 2026-08-24 Grill 到 Deep Knowledge 交接完成

- 狀態：implemented。Grill 負責查證證據與取得人類決策；Deep 沿用同一份 immutable snapshot 與已確認決策，不重讀相同 `wiki/`／`code_base/` 證據。
- Deep 只補 snapshot 沒有、且後續明確需要的新來源。進 Deep 前同步關閉 Grill pending／round；Deep 不直接向使用者提問。
- 只有新 Evidence ID 帶來新歧義時，Workflow 才可建立新 Grill round；重複 evidence／decisionId 不得循環。
- relevance failure 定義為 Discovery clarification：回答後依 `WAIT_USER → USER_CONFIRMED → LIGHT_DISCOVERY` 重新探索，並建立新 snapshot。
- debug completion 必須走正式 gate；round identity 採使用者裁決的方案 A：runtime-issued `roundId + kind + decisionId`。unknown round reject、同一已回答舊 round 的精確重播保持 idempotent，新 round 即使重用相同 ID 仍可接受。
- formal、debug、relevance 與 UI lease 路徑共用相同 identity；fetched evidence 只屬於目前 snapshot。Deep 前同步釋放 Grill boundary，stale `message_end` 與 `/continue` 不得重開 Grill；relevance `/confirm` 不代替使用者回答。
- 驗證：`npm run check` 兩個 tsconfig 通過；`npm test` 157/157、0 fail、0 skip；Standards／Spec final review 的 P0、P1、P2 均為 0。
- 詳細決策見 [`ADR-0015`](docs/adr/ADR-0015-grill-deep-knowledge-handoff-boundary.md)；本 ticket 已完成。

## 2026-08-24 Deep Knowledge Retrieval／Understanding 設計核准

- 設計階段歷史快照（其後已完成）：當時狀態為 ready-for-implementation，本段是下一個 ticket 的設計基線；目前完成狀態見下方「2026-08-25 Deep Knowledge 實作與驗證完成」。
- Grill 只收集足以讓人做決策的最小證據；Deep 只接收 Grill 實際引用的完整 `content`／`metadata` 與 immutable decisions，不重讀相同 evidence。Deep 可補查客觀缺口，但新需求、取捨或矛盾必須由 Workflow 建立新的 `WAIT_USER` round；證據整體不足則回 `LIGHT_DISCOVERY`。
- Grill snapshot 保持不變；Deep 產生衍生 Evidence Package，合併 inherited evidence 與 supplemental evidence。新增來源必須使用新的 Evidence ID，並標示 `origin: grill | deep_retrieval`。
- Deep 分成兩階段：`Deep Retrieval` 可使用 `forge_deep_search` 補查並由 `forge_deep_retrieval_complete` 鎖定證據集合；`Knowledge Understanding` 只能讀取固定集合，透過 `forge_deep_complete` 產生 Evidence Package。兩階段沿用主 session active model，不加入模型派發、fallback 或 custom loop。
- 結果只有 `completed`、`needs_decision`、`needs_discovery`。完成結果必須通過 deterministic validator：Evidence ID 唯一、每個 finding 至少引用一個 Evidence ID，且所有引用 ID 必須存在於 package、證據保留來源與完整內容；blocking gap／conflict 不得進入 completed。Evidence Package 僅含 `evidence`、`decisions`、`findings`、非阻擋 `limitations`，不另設重複 `citations`。
- `attemptId + sourceRoundId + phase` 是 Deep attempt identity；stale call 拒絕，失敗／取消保留輸入，`/continue` 以新 attemptId 重試，技術錯誤不回 Grill。target source 只接受 Grill snapshot 已明確存在的檔案；不明確時走 `needs_decision`，來源不足走 `needs_discovery`。
- 本 ticket 完成點是通過驗證的 Evidence Package 並轉入 `CONTEXT_BUILD`；不生成 Context／ADR／SPEC／Ticket 內容、不做 Pattern Card、持久化、第二 verifier、UI 或 `pi-main/` 修改。詳細計畫見 [`docs/PLAN-A.md`](docs/PLAN-A.md) 與 [`ADR-0016`](docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md)。
- 使用者已核准 Evidence Package public seams：`createEvidencePackage({ inherited, supplemental, decisions, findings, limitations })` 與 `validateEvidencePackage(package)`；前者自動標記 `origin`、固定 inherited 後 supplemental 順序且不公開 merge 細節，後者以 `{ ok: true }`／`{ ok: false, errors: string[] }` 回傳正常驗證結果、不 throw。
- Evidence 欄位固定為 `evidenceId`、`kind: string`、`source`、`title`、`content`、`metadata: Record<string, unknown>`、`origin: "grill" | "deep_retrieval"`；limitation 為 `{ statement, blocking }`，blocking 時不得完成；package 內 ID 必須唯一，finding 至少引用且只能引用存在的 ID。
- Deep retry 保留 `sourceRoundId`、只更換 `attemptId`；第一個 public test seam 驗收名稱為 `EvidencePackage_WhenInheritedAndSupplementalEvidenceMerge_ShouldPreserveOrigins`。詳情以 [`ADR-0016`](docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md) 為單一決策來源，實作清單見 [`docs/PLAN-A.md`](docs/PLAN-A.md)。
- 使用者於 2026-08-25 核准 Deep Session State 行為：狀態只放在 `ForgeSessionState`，不新增 UI state interface；public test seam 沿用或擴充 `ForgeSessionState`，方法命名留在最小實作細節。
- Deep identity 固定為 `attemptId + sourceRoundId + phase`。retry 保留 `sourceRoundId` 與 current input，只更換 `attemptId`；stale call 回傳可辨識的 stale 結果，不以 throw 表示。cancel 清除 active attempt 但保留 current input。
- 同一 snapshot 的 retry／cancel 保留 supplemental evidence；切換新 snapshot 時清除舊 supplemental evidence。snapshot 沿用 immutable object identity，不新增 hash 或持久化 ID。

### 2026-08-25 Deep Knowledge 實作與驗證完成

- Deep 三個工具與 Grill 兩個工具均已實作並通過驗證。Retrieval／Understanding 的 identity 固定為 `attemptId + sourceRoundId + phase`；retry 產生新 attempt、保留 source round 並回到原 Deep phase，cancel 保留 input／evidence，`continue` 回原 Deep phase，不回 Grill。
- 所有 stale outcome 都先安靜拒絕；active-tools capability 對 active identity 採 fail-closed，無法安全確認時拒絕啟動 Deep。
- 人類決策持久格式精確為 `問題：…；決定：…`；同一 decisionId 首筆不可覆寫。Evidence Package 先注入人類決策，模型 duplicate decisionId 會被拒絕。
- 固定安全上限已落地：query 1500 Unicode code points、同 source／Grill round 最多 8 次搜尋且 retry／cancel 不重設、單筆 256 KiB、整輪 2 MiB（含 Grill fetched 與 Deep supplemental）、decisions／findings／limitations 各 50、每段 statement 4,000 Unicode code points。超限在寫入 state 前拒絕且不改 state；讀檔先 stat，恰好上限可讀。
- Evidence Package 驗證 ID 唯一、finding 引用存在、blocking limitation 不可 complete；Deep 重用 Grill fetched evidence，不重讀。
- 初次 Deep 實作驗證：`npm test` 208/208、`npm run check` exit 0；identity handoff follow-up 完成後完整 suite 為 209/209，詳見本文件下方收尾紀錄。

### 2026-08-25 Workflow 分流介面核准

- 使用者已核准 `ForgeSessionState` 的單一 public seam：`handleDeepResult(identity, result)`。
- `result` union 僅包含 `completed`、`needs_decision`、`needs_discovery`；technical failure 不屬於 result，走 cancel／no-op，保留原 Deep phase 與 input，等待 `/continue`。
- `completed` 依 `identity.phase` 分流：`Deep Retrieval` → `Knowledge Understanding`；`Knowledge Understanding` → `CONTEXT_BUILD`。
- `needs_decision` 建立全新的 `WAIT_USER` round，`kind` 為 `deep_decision`，`roundId` 使用目前 `attemptId`，不冒充 Grill round；保留 input／evidence，並使該 attempt 後續呼叫回傳 stale。
- `needs_discovery` 轉入 `LIGHT_DISCOVERY` 並結束目前 attempt；stale 結果靜默忽略，不改變 state。
- public test seam 補為 `handleDeepResult(identity, result)`；第一個 Workflow 紅燈測試為 `StateMachine_WhenRetrievalCompletes_ShouldEnterKnowledgeUnderstanding`。

### 2026-08-25 Deep 工具契約核准

- `forge_deep_search` 接收 attempt identity、`query` 與單一 `source`（`wiki`、`code_base` 或 `target`），每次最多 3 筆；`target` 只接受 snapshot 中可唯一匹配的明確 target source，缺失或多義時回 `needs_decision`，不得猜測。
- supplemental ID 由 runtime 產生；已存在的 inherited／supplemental evidence 必須重用，不重讀、不重複加入。
- `forge_deep_retrieval_complete` 接收 attempt identity 與 `completed`／`needs_decision`／`needs_discovery` outcome；completed 時 runtime 鎖定全部實際 inherited 與 accepted supplemental evidence，模型不可任選並轉 Understanding，其他 outcome 交由 `handleDeepResult`。
- `forge_deep_complete` 接收 attempt identity 與同一 outcome；completed 時模型只提交 decisions、findings、limitations，runtime 注入 locked evidence 並驗證 Evidence Package，成功才轉 `CONTEXT_BUILD`，invalid 不轉移，其他 outcome 交由 `handleDeepResult`。
- Retrieval 只啟用 search＋retrieval-complete，Understanding 只啟用 deep-complete；完成、轉 decision／discovery 或 cancel 後恢復原 active tools，無法安全限制時拒絕啟動 Deep。技術失敗走 cancel／no-op 並保留 input/evidence，stale 安靜忽略。
- Integration 測試使用現有 `forge-runtime-extension.test.ts` 輕量 `registeredTools` harness，不啟動完整 TUI。

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
- `INTENT_UNDERSTANDING` 的現行最小 contract 只有 `route`：LLM 驗證後輸出嚴格 JSON `{ "route": "passthrough" | "start_forge" }`；原始 `userMessage` 保留在 workflow context，其他理解資料不屬 Intent 輸出。
- `LIGHT_DISCOVERY` v1 只讀根目錄 `wiki/` 與必要的極窄 local code lookup；`docs/`、`CONTEXT.md`、ADR 與 Plan 不再是 Light Discovery 來源。
- `passthrough` 只保留給純問答、閒聊、翻譯、改寫與非工程任務；工程請求一律先過 Forge router。
- Intent 使用官方 `ctx.model` 與 `ctx.modelRegistry.complete()`，固定 10 秒 timeout；missing model、completion error、timeout、abort、invalid JSON 或 invalid schema 一律 fail-closed 為 `start_forge`。WAIT_USER、open workflow 與 slash control 先由 workflow guard 處理；`/grill-run` 明確進 `start_forge`。
- `goal` 由 start_forge 後的原始有效文字取得；`taskKind`、`ambiguities`、`lightDiscoverySeeds`、`resumeSelection` 移出 Intent，seed fixed-point helper 留在 extension handoff private helper；Light Discovery production 與內部測試不在本 ticket scope。
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
- **深度知識後的歧義**：ADR-0016 已定義 `needs_decision` 經 `Workflow → WAIT_USER → Grill` 處理；Deep 不直接詢問人類。`needs_discovery` 則回到 Light Discovery。

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

## 2026-08-25 首次 Grill→Deep identity handoff 修正完成

### 最終完成

- Grill READY 建立 active identity 後，首次模型回合已透過既有 decision-retry 的 `pi.sendUserMessage(..., { deliverAs: "followUp" })` transport 收到含 `attemptId`、`sourceRoundId`、`phase` 的 identity-bearing invocation。
- `forge-runtime/extensions/forge-runtime.ts` 的三個 caller 以 closure-local setter 傳遞 `pendingReplayInvocation`；`continueDeepKnowledge` 建立 attempt 後先設定 marker，再送出 identity-bearing followUp。
- identity 不放入 tool details；Deep tools 不自取 identity；未修改 stale guard、tool schema、`pi-main/`，也未加入 sequential 設定。
- 驗證完成：handoff regression 由 114 pass/1 fail（handoff undefined）修正為 115/0；聚焦 4/4；相關 147/147（`.tmp/deep-related-green-20260825.log`）；完整 209/209（`.tmp/deep-full-green-20260825.log`）；`npm run check` exit 0（`.tmp/deep-caller-check-20260825.log`）；final quick review 為 0 functional findings。
- 尚未由使用者在真實 PI session 重跑原始情境；這不是目前 blocker。

### 2026-08-25 最後驗證與工作樹狀態

- 工作期間 HEAD 由外部移至並同步 `origin/main` 的 `324501a0412bbfdead9642aeb845bb26192b57cc`；這不是本代理建立的 commit。
- 目前本 ticket 剩九檔 tracked 修改未提交。隔離 detached worktree 只套用九檔 diff 後，`npm run check` exit 0，四個關鍵測試均 4/4 exit 0；證據：`forge-runtime/.tmp/deep-isolated4-check-20260825.log`、`forge-runtime/.tmp/deep-isolated4-targeted-20260825.log`。
- 主工作樹完整 suite 仍為 209/209；未解仍只有使用者尚未在真實 PI session 重跑原始情境。

## 2026-08-26 Deep 階段輸出守門完成

- Ticket：`deep-stage-output-guard-20260826`。Deep Retrieval／Knowledge Understanding 只準備後續實作所需證據，不在此階段開始實作。
- Guard 只在存在 active Deep attempt，且 stage 為 `DEEP_KNOWLEDGE_RETRIEVAL` 或 `KNOWLEDGE_UNDERSTANDING` 時成立；`message_update` 與 `message_end` 都移除 assistant `text`／`thinking`，保留合法 `toolCall`。
- 不沿用 Grill recovery，不影響 `WAIT_USER`、Deep cancel 後或後續階段；Deep active tool 清單維持排除 write/edit 類工具。
- 根因已確認：assistant prose guard 只覆蓋 Grill；Deep active 後只切換 active tools，`message_update` 與 `message_end` 未同步攔截 `text`／`thinking`。
- 修正已完成：新增 `hasActiveDeepAttempt`；Deep Retrieval／Understanding active attempt 的串流清空 `text`／`thinking`，final message 只保留合法 `toolCall`。
- 驗證完成：先由 `PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue` 以 `FORBIDDEN_IMPLEMENTATION_MARKER` 形成紅燈（exit 1），修正後 targeted 9/9；修正 retrieval／understanding fixture schema 與過時 transition assertion 後，`npm test` 209 passed/0 failed/0 skipped，`npm run check` exit 0。production review 零 functional findings，scope on target。
- 不新增 Plan B、不修改 `pi-main/`。Grill 的 `message_end` 含 toolCall 分支仍依賴 `message_update` 先清文字，列為未證實後續風險，不在本 ticket 擴修。

## 2026-08-26 Deep identity handoff activation 修正設計核准

- Runtime observation：`forge_grill_complete` 接受後已正確進入 `DEEP_KNOWLEDGE_RETRIEVAL`，但新 Deep attempt 建立後立即啟用 Deep tools；identity-bearing `followUp` 要等目前 assistant turn 結束才進入 `input`，因此空窗期間模型以舊 identity 呼叫，全部被 stale guard 安靜拒絕，followUp 到達後重試才成功。
- 已核准最小修正：移除／延後當下的 `activateDeepRetrievalTools()`；在既有 `pi.on("input", ...)` 的 exact pending replay invocation 條件內，先清除 `pendingReplayInvocation`，再啟用 Deep Retrieval tools，之後沿用 `{ action: "continue" }`。
- 保留 identity 三元組、stale quiet reject、followUp transport、主 session 與既有 verifier；不修改 `pi-main/`。
- 明確不做：把 identity 放入 completion tool result、新增 custom loop／sequential 設定／新狀態機／UI、Plan B，以及 Grill `message_end` 含 toolCall 的文字清除 sibling risk。
- 脆弱假設已由 test harness 驗證：followUp bridge 會在下一次模型推論前重入 input handler；exact marker 可作一次性 gate。
- 本 ticket 狀態：design-approved-ready-for-red（修正前歷史狀態）。預計 production 只改 `forge-runtime/extensions/forge-runtime.ts`，測試只改 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`；先紅燈，再做最小 production 修正。

## 2026-08-26 Deep identity handoff activation 修正完成

- 本 ticket 已完成：Deep Retrieval activation 已從 `continueDeepKnowledge` 延後至既有 `pi.on("input", ...)` 的 exact `pendingReplayInvocation` input gate；gate 先清除 marker，再啟用 Deep Retrieval tools，最後沿用 `{ action: "continue" }`。
- 保留 identity 三元組、stale quiet reject、followUp transport、主 session 與既有 verifier；未修改 `pi-main/`，未新增 custom loop、sequential 設定、新狀態機、UI 或 Plan B。
- 新增 2 個 timing regression；targeted 117/117、完整 `npm test` 211/211、`npm run check` exit 0。修改與測試證據見本 ticket、`docs/PLAN-A.md`、`docs/handoff.md` 與 agent-state。
- 狀態：implemented-and-verified。本輪未發現新 bug。
- 未解風險：Grill `message_end` 含 toolCall 的文字清除 sibling risk 仍不在本 ticket，且未由本輪驗證證實；另保留使用者尚未在真實 PI session 重跑原始情境的既有非 blocker。

## 2026-08-27 Deep stale-result loop 修正完成

- 唯一目標：修正「過期的 Deep Retrieval 完成結果已忽略。」反覆循環，不擴大到其他流程。
- 根因：Deep identity followUp 在 input preflight 就清 pending；Deep stage panel streaming 可成為 steer 並先 drain，舊 identity completion 因而先執行並被 stale guard 忽略。
- 修正：初始 Deep stage panel 使用 `displayOnly`；input 只預載本回合 Deep tools，不清 pending；matching user `message_start` 才清 pending；pending 期間 Deep tool_call block。工具預載與 delivery 授權分離，避免 `Tool forge_deep_search not found`。
- 真實 AgentSession／InteractiveMode／faux provider regression：未修版正式 RED 1 fail；修正版正式 GREEN 1 pass，後續合法 Deep search accepted。TUI 以 `waitForScrollBuffer` 驗證 Deep stage。
- 驗證完成：extension targeted 117/117、PI integration 10/10、完整 `npm test` 212/212、`npm run check` exit 0；logs 位於 `forge-runtime/artifacts/test-logs/`。
- review 僅針對指定 scope；未修改 `pi-main/`，無暫時 debug probe。殘餘風險：blocked tool result `terminate=false` 可能延遲 followUp；其他 Deep `/continue` panel 預設 sendMessage 仍可能形成 steer；尚待使用者在真實 PI session 重跑原始情境。

### Final review medium finding 修正

- `requireDeepToolBoundary` 現在必須同時確認 tool boundary 與 `sendUserMessage` 可送出 identity-bearing followUp，兩者缺一不可；若 followUp 無法送出，不宣稱 handoff 已完成，避免半完成狀態。
- 修正後驗證：targeted 117/117、`npm test` exit 0、`npm run check` exit 0；本輪未發現新 bug。

## 2026-08-26 Deep stale-result loop 修正前狀態

- Ticket：`deep-stale-result-loop-20260826`；目前狀態為 `plan-approved-ready-for-red`，只處理「過期的 Deep Retrieval 完成結果已忽略」反覆循環。
- 目前不變量：Deep identity 仍為 `attemptId + sourceRoundId + phase`；stale outcome 維持 quiet reject；不改 Grill completion、WAIT_USER、cancel/retry/switch、relevance、state transition、snapshot、合法 Deep 後續或 `pi-main/`。
- 已核准最小方向：Deep stage panel 使用 `displayOnly`；pending identity 保留到 matching user message 進入 `message_start` 才 consume；pending 期間 Deep tool-call gate 維持不可用。
- 尚未修改 production 或 tests；先由測試代理建立真實 PI agent-loop queue priority／followUp drain regression 並打紅燈，再進行最小 production 修正。

## 2026-08-27 Deep target source contract 完成驗證

- Ticket `deep-target-source-contract-20260827` 狀態為 `implemented-and-verified`；本輪聚焦 Grill→Deep Retrieval 的 target manifest 轉換與輸入驗證，不改其他 Deep semantic flow。
- 契約唯一真相來源為 [`ADR-0017`](docs/adr/ADR-0017-deep-target-source-contract.md)：follow-up 列出既有 `workflow.snapshot.candidates`，target 分支要求 `targetSource`；缺少時 retryable invalid 且保留 attempt，非唯一匹配才進 `WAIT_USER`；stale sibling 回 `terminate: true`。
- production schema 已使用 discriminated union；handler 在預算扣除前拒絕缺少 `targetSource`，保留 attempt／budget；follow-up 明確帶 target manifest（含空清單），四個 stale outcomes 均終止 sibling。
- 五個指定情境測試均通過；完整 `npm test` `217/217`（`forge-runtime/.tmp/post-schema-test.log`）；`npm run check` exit 0（`forge-runtime/.tmp/post-schema-check.log`）；Standards／Spec re-review PASS。未修改 `pi-main/`、`session-state.ts` 或 snapshot 契約，不自動選 target、不加 sequential。僅有 Node `DEP0190` 非阻塞警告；下一步為使用者檢閱／提交。

## 2026-08-28 Deep completion stale termination 實作與驗證

- Ticket `deep-completion-stale-termination-20260828` 狀態為 `implemented-verified-reviewed`；只補齊 `forge_deep_retrieval_complete` 與 `forge_deep_complete` 的六個 stale return，使每個 stale 結果回傳 `terminate: true`。
- 不變量：每個 active Deep attempt 最多接受一個 `needs_decision`；接受後進入 `WAIT_USER` 並清除當前 attempt。舊 identity 後續 completion 只回 stale、不得改 state，且必須 terminate。使用者回答保留 `sourceRoundId`／`phase` 並建立新 attempt；新 attempt 可再次 `needs_decision`。
- Building 只涵蓋上述 production branches 與 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 測試；不改 `session-state.ts`、Grill、`CONTEXT_BUILD`、UI、schema/API、`pi-main/`，不做 Plan B。
- 兩個 public fresh-attempt regression 先紅 `terminate undefined` 後綠；四個 inner branch 因無公開 deterministic seam，不新增私有 mock／test hook。focused 124/124、full 219/219、`npm run check` pass；mixed tool batch `every(terminate)` 風險不在 scope。

- 正式測試名稱為 `Extension_WhenRetrievalNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt` 與 `Extension_WhenUnderstandingNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt`，完整覆蓋 needs_decision→WAIT_USER/clear→舊 identity stale+terminate/state-tools 不變→fresh identity preserved→再次 needs_decision；既有三個 stale tests 補上 terminate assertion。PI smoke 成功啟動，真實模型回 `smoke ok`、exit 0（`forge-runtime/.tmp/pi-smoke.log`）。

## 2026-08-28 Deep retryable recovery contract 設計核准

- Ticket `deep-recovery-contract-20260828` 只完成設計文件，尚未實作；唯一契約見 [`ADR-0018`](docs/adr/ADR-0018-deep-retryable-recovery-contract.md)，執行計畫見 [`docs/PLAN-A.md`](docs/PLAN-A.md) 對應段落。
- `manifest=[]` 且 `source=target` 時回 retryable invalid，保留相同 `attemptId`／`sourceRoundId`／`phase`，不進 `WAIT_USER`；明確要求模型自行改用 `wiki`／`code_base`，runtime 不自動選 source／target。
- duplicate `decisionId` 維持拒絕、不靜默去重；保留同一 `KNOWLEDGE_UNDERSTANDING` attempt，以相同 identity 重送修正後唯一 IDs。invalid／rejection 不推進 stage，也不寫入 `CONTEXT_BUILD`；既有 stale guard 保留。
- production 預設只改 `forge-runtime/extensions/forge-runtime.ts`；只有 RED 證明 extension seam 不足時才回報 `session-state.ts` blocker。文件不新增 API／schema／UI／scheduler、不擴充 snapshot、不自動 fallback、不接受 basename 模糊匹配，且只有 Plan A。

### 2026-08-28 Deep retryable recovery contract 實作與驗證

Ticket 已完成實作、驗證、初次 review fix 與最終雙軸 re-review，狀態為 `implemented-verified-reviewed`。空 target snapshot manifest 在共用 target ambiguity branch 前回 retryable invalid，要求模型改用 `wiki`／`code_base`，不呼叫 `handleDeepResult`，因此 identity／stage／budget 不變；Evidence Package validator 只有 rejection 錯誤包含 `決策 ID 重複` 時增加 `retryable:true`，可用同一 identity 修正重送，其他 validation failure 不因本 ticket 自動標 retryable。既有 validator、stale guard、state advance 保留。Production 僅為 `forge-runtime/extensions/forge-runtime.ts`，tests 僅為 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。

初次 review findings 均已修正並保留為歷史：durable state、setup 重複、budget coverage、retryable 過寬、stale state 與 Plan A baseline 標示。Final test refactor 後 extension 129/129；本地排除 `pi-grill-interactive` suite 214/214；標準 `npm test` 214 pass/1 fail，唯一既存失敗是缺少 qwen token-plan JSON；final `npm run check` 38 個既存 baseline errors，沒有錯誤指向本 ticket 修改的 `forge-runtime.ts` 或 `forge-runtime-extension.test.ts`。`pi-grill-interactive.test.ts` 不是本 ticket 修改檔。最終 re-review：Standards P0/P1/P2=0；Spec P0/P1/P2=0。真實 PI 原情境人工驗收尚待完成；Node `DEP0190` 為非阻塞 warning。詳情與 logs 見 ticket、ADR-0018、Plan A。

## 2026-08-29 Deep mixed-tool batch termination barrier 設計核准

- 本 ticket 狀態為 `design-approved-ready-for-red`；本 session 只完成文件更新，尚未實作、測試或 commit。mixed-batch contract 唯一真相來源為 [`ADR-0019`](docs/adr/ADR-0019-deep-mixed-tool-batch-termination-barrier.md)。
- 核准以 extension-local ephemeral `DeepRetrievalBatch` 按 call ID 管理 mixed batch；completion deterministic retryable reject 且 `terminate=true`、保留 identity、不轉 stage；current-identity searches 全部 `terminate=true`，全 settle 後只 queue 一個同 identity follow-up；下一個 completion-only batch 才接受並 transition。
- prompt guidance 區分 `needs_decision`（需人類選擇）與 `needs_discovery`（缺來源／證據）；kind 是唯一正式 route。Forge-only，不改 `pi-main/`、telemetry、scheduler、`session-state.ts`、public schema/API 或依賴。
- 新 session 先讀 handoff、CONTEXT、ADR-0019、ticket、agent-state、Memory 兩檔，檢查 `git status`／`git diff`，展示摘要並等待確認；確認後用 `execute-designed-plan` 從 RED 開始。預期新增 6 測試，baseline 219 + 6 = 225 pass；PI 原生完整測試不是 gate。

## 2026-08-29 自動進入 Deep 的階段面板刪除決策

- 使用者已核准：不修改 `pi-main`，刪除 `continueDeepKnowledge` 在自動進入 Deep 前的單次 `await publishState(..., { deliverAs: "displayOnly" })`。這是純 UI side effect；目前 PI 不認得 `displayOnly` 時，可能把它當成會觸發模型回合的訊息，干擾 identity-bearing followUp 與 Deep 工具時序。
- 只移除自動進入 Deep 的階段面板發布；保留 `WAIT_USER`、recovery、confirmation panel、session state、active tools、pending fail-closed gate、status 與其他既有 UI。需要人類決策的流程仍必須顯示面板。
- 本決策取代「自動 Deep 階段面板使用 `displayOnly`」的未完成方案；不新增替代 UI 或新的 delivery contract。歷史上的「尚未修改、待 RED」描述保留於本段作為決策快照；目前完成狀態見下段。

## 2026-08-29 Deep mixed-tool batch barrier 與自動 Deep 面板修正完成

- Ticket `deep-mixed-tool-batch-termination-20260829` 已完成實作與驗證，狀態為 `implemented/verified-with-existing-workspace-caveats`。Extension 已建立以 call ID 管理的 ephemeral mixed batch barrier；mixed completion 會 retryable reject 且 `terminate=true`，current-identity search 全部 terminate，全部 search settle 後只 queue 一個同 identity follow-up，completion-only replay 才接受；prompt guidance 區分 `needs_decision` 與 `needs_discovery`。
- 自動進入 Deep 的階段面板已先以 RED→GREEN 回歸驗證，再移除 `sendMessage`／`publishState(...displayOnly...)` 的多餘 UI side effect；正式流程保留 `ctx.ui.setStatus(buildWorkflowStatusText(nextState))` 更新狀態。`WAIT_USER`、recovery、confirmation panel 與 pending fail-closed gate 保留。
- 修改範圍維持 Forge extension 與指定測試；`pi-main/` 無 tracked 改動。
- 驗證證據：auto-panel unit 1/1、AgentSession after-status 1/1、三個受影響 tests 3/3、extension isolated `tsconfig.json` 67/67。較早的 pi-config 134/134 是 status 修正前結果，不作最終證據；最後 pi-config log 只有逐項 ✔，沒有 summary。`npm run check` exit 2，但 production 0 錯誤、本 ticket test 1199 後 0 錯；既有 TUI terminal 10 錯與 pi-main highlight.js 21 錯屬 workspace baseline。完整 pi-grill 受既有 TUI 兩個失敗阻斷，但本 ticket targeted 測試通過。

## 2026-08-29 WAIT_USER UI-only state publication 設計待實作

- Ticket `wait-user-ui-only-state-publication-20260829` 只完成設計與交接，狀態為 `planned`／`approved-awaiting-user-session-confirmation`；本輪未修改 production、tests、`pi-main`、全域 PI 或 project `.pi`。
- 目前 `WAIT_USER` 的 `publishState()` 仍會呼叫 `pi.sendMessage`，並傳送 `deliverAs: "displayOnly"`。PI current 與官方 0.84.3 的 delivery contract 只支援 `steer`、`followUp`、`nextTurn`；未知值在 streaming 會落入 `steer`，因此純顯示訊息可能干擾 agent loop。
- 下輪唯一 Plan A：移除 WAIT_USER `forge-stage` custom message 投遞，保留 workflow state、`setStatus`、WAIT_USER selector／custom editor、使用者回答與 followUp；不新增替代 UI、persistence 或 core delivery contract。實作前先由測試代理建立 RED，再做最小 production 刪除。
- 這是不同於已完成的「自動 Deep 階段面板移除」ticket；後者只處理不需人類決策的自動 Deep UI side effect，已完成並保留 `setStatus`。

## 2026-08-29 WAIT_USER UI-only state publication 實作與驗證完成

- Ticket `wait-user-ui-only-state-publication-20260829` 狀態為 `implemented/verified-with-existing-workspace-caveats`。`publishState` 先更新 `setStatus`，`displayOnly` 直接返回，不呼叫 `sendMessage`；omission branch state 使用 display-only，recovery panel 保持 `triggerTurn: false`。
- state／status／selector／custom editor、answer followUp、retry／recovery 均保留；未修改 `pi-main`。Interactive harness 依目前僅有 `tuiMode` 的 `InteractiveModeOptions`，10 個 tests 使用 test-local `attachVirtualTerminal`、`init`、`run`、`waitForRender`。
- 驗證：extension targeted 2/2；PI targeted 3/3（含 no-auto-replay 與 explicit retry callCount 2→3）；static touched errors 0，剩餘 pi-main highlight.js 21 個 baseline errors；`git diff --check` 0、`pi-main` diff 0。
- 真實 PI 0.84.3 no-session smoke 的合法 `/grill-run` WAIT_USER `display-only smoke` 通過並完成 confirm；observed normal active `forge-stage` 皆在 WAIT_USER 前，沒有 WAIT_USER-specific stage 證據。cancel 因在 streaming 送入而 inconclusive；第一次 forged roundId fail-closed 拒絕，不算產品失敗。
- 修正前歷史快照：Full PI file 10/11，唯一 Deep dirty-scope failure `PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue`（single search terminate true／no followup）當時尚未修正；已由下方最新 11/11 GREEN 取代。完整 npm suite 於既有 integration hang（85 pass／0 fail）後中止並保留 log。
- 修正前歷史快照：核心規範／安全 review PASS；manual retry gap 已補。private renderer terminal cast 是 upstream 無 public injection seam 的測試 caveat，未新增抽象。當時未解包含 Deep dirty-scope failure、完整 suite hang、可選真實 cancel smoke；Deep failure 已由下方最新結果取代，static／hung suite caveat 仍保留。

## 2026-08-29 Deep pure-search continuation 修正完成

- 使用者實測 pure `forge_deep_search` 後回合終止但沒有接續；根因是 `forge-runtime/extensions/forge-runtime.ts:1284` 的 `!batch.mixed` guard 讓 coordinator 提前返回。`continue` 沿用 `sourceRoundId`，3 + 5 次後達 8 次上限只是後續結果，不是根因。
- 正式修正只移除 pure-batch guard；保留 terminate=true、全部 settle barrier、followUpQueued、identity／active checks、mixed reject、completion-only、quota、fail-closed 與 `pi-main` 不變。public seam 見 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts:1585,1836-1948`。
- 驗證：PI TUI RED 轉 GREEN 1/1；完整 PI 互動 11/11；新增 extension 兩測 2/2；extension 完整 assertions 68 pass／0 fail，但背景程序於 summary 後 180 秒未退出。check／第二段 tsc 只剩既有 `pi-main` `highlight.js` 21 個 baseline；bounded npm test 卡在既有 human-decision integration，未宣稱整套正常退出。兩份獨立 review 無阻擋 finding。

## 2026-08-29 Deep Discovery fallback 與 human premise 設計核准

- Ticket `deep-discovery-fallback-human-premise-20260829` 狀態為 `design-approved-ready-for-red`，尚未修改 production/test。
- Retrieval 與 Understanding 合併計算 `needsDiscoveryCount`；第一次 `needs_discovery` 自動重用 Light Discovery→Grill，第二次及之後進入 `WAIT_USER`，kind=`deep_discovery_fallback`，固定問題為「此專案資料來源不足，將以前次 grill/ 資料來源所得之證據進行後續開發，請確認」。
- 僅接受 trim 後整句「同意」或「確認」。確認後建立 fresh `KNOWLEDGE_UNDERSTANDING` identity，只允許 `forge_deep_complete`；Understanding 完成且 validator 通過才進 `CONTEXT_BUILD`。
- 同一 workflow 的 Grill／Deep evidence 依 evidenceId 去重並跨 snapshot 保留；零外部來源建立 `human_premise` Evidence。由已驗證 evidence 直接成立的事實性 finding 可維持事實陳述；implementation inference 必須以「推論：」開頭並引用有效 Evidence ID。只引用 `human_premise` 且沒有 verified evidence 時，validator 強制「推論：」；混合 evidence 仍須標示實際推論，既有引用／ID 檢查不放寬。
- 不修改 `pi-main/`、新 tool/UI、第三次自動 retry、CONTEXT_BUILD 下游或舊 WAIT_USER parser。下一 session 先讀 handoff／CONTEXT／ADR-0021／PLAN-A，展示摘要並等待確認，再以 TDD RED 開始。

## 2026-08-30 Deep Discovery fallback 與 human premise 完成驗證

- Ticket 已完成。Evidence Package 支援並驗證 `human_premise`；Retrieval 與 Understanding 共用 `needsDiscoveryCount`。第一次 `needs_discovery` 經正式 `tool_result` transform 自動重跑 Light Discovery→Grill，第二次進精確問題的 `WAIT_USER`，只接受 trim 後完整 `同意`／`確認`。
- 確認後建立新的 Knowledge Understanding identity，只允許 `forge_deep_complete`。Grill／Deep evidence 跨第一次 snapshot switch 累積，依 ID 去重，並在 cancel、switch、new workflow、reset 清除。human premise 含 goal、question、answer、`needsDiscoveryCount`、兩輪 `sourceRoundIds`，且 decision 會引用它。
- READY_FOR_DEEP 使用 terminate 與 pending settled invocation，在 `agent_settled` 的下一個 task 送普通 user message，再重驗 identity、stage、tools；pending handoff 關閉 Deep tool gate；WAIT_USER publication 會 await；`message_end` callback 有 ctx；fallback 無 locked evidence 的 `needs_decision` 將兩個 accumulator keys 視為合法 evidence。
- 最終證據：Evidence 13/13；Session State 22/22；Extension 142/142；PI interactive 12/12；`npm test` 248/248；Standards／Spec 獨立審查均 PASS。`npm run check` exit 1，Forge Runtime 自身零錯誤，唯一失敗是未修改的 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21` 缺少 `highlight.js` declaration（TS7016），不修改 `pi-main`。
