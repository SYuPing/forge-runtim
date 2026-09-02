---
title: Deep Knowledge 檢索、理解與證據包交接
type: handoff
scope: intent-route-only-llm-20260821、light-discovery-file-metadata-20260822、grill-deep-boundary-risk-20260823、deep-knowledge-retrieval-understanding-20260824、deep-stale-result-loop-20260826、deep-target-source-contract-20260827、deep-completion-stale-termination-20260828、deep-recovery-contract-20260828、deep-mixed-tool-batch-termination-20260829、wait-user-ui-only-state-publication-20260829、deep-decision-replay-ui-only-stage-20260830、knowledge-understanding-context-build-deliverable-20260830、knowledge-summary-authority-boundary-20260831
updated: 2026-09-02
source: ADR-0013、ADR-0014、CONTEXT.md、docs/PLAN-A.md、docs/adr/ADR-0015-grill-deep-knowledge-handoff-boundary.md、docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md、docs/adr/ADR-0017-deep-target-source-contract.md、docs/adr/ADR-0018-deep-retryable-recovery-contract.md、docs/adr/ADR-0019-deep-mixed-tool-batch-termination-barrier.md、docs/adr/ADR-0020-wait-user-ui-only-state-publication.md、docs/adr/ADR-0023-knowledge-understanding-context-build-deliverable.md、docs/adr/ADR-0024-knowledge-summary-authority-boundary.md、agent-state/knowledge-summary-authority-boundary-20260831.md、scoped validation logs
status: implemented-verified-reviewed
---

# Intent route-only LLM 交接

## WAIT_USER UI-only state publication 收尾（2026-08-29）

Ticket `wait-user-ui-only-state-publication-20260829` 已完成實作、targeted verification 與 review；`publishState()` 不再投遞不受支援的 WAIT_USER `displayOnly` custom message，並保留 state、status、selector／custom editor、followUp 與 recovery。未修改 `pi-main`、全域 PI 或 scheduler。

後續 session 以 Deep 既有 caveats 與真實 PI cancel smoke 的未決風險為優先，詳見本交接末尾收尾段與 [`ADR-0020`](adr/ADR-0020-wait-user-ui-only-state-publication.md)。

## Deep mixed-tool batch termination barrier 交接（2026-08-29）

`deep-mixed-tool-batch-termination-20260829` 已完成，狀態為 `implemented/verified-with-existing-workspace-caveats`。以下第一段是實作前歷史交接；目前實作與驗證結果見本節末的新收尾段。

唯一契約見 ADR-0019。只改 Forge extension 與指定 tests；不得改 `pi-main`、`@earendil-works/pi-telemetry`、PI scheduler、`session-state.ts`、public schema/API 或依賴。先由獨立測試角色新增 6 個 PascalCase regression 並跑 RED，再由 implementation、驗證、final review 角色分工；預期 baseline 219 + 6 = 225 pass。Forge contract 與 AgentSession/faux-provider integration 是自動 gate；PI 原生完整測試不是 gate；真實 PI session 是發布前人工 gate。

## 2026-08-29 自動 Deep 階段面板刪除核准交接

使用者已確認採用最小修正：不修改 `pi-main`，刪除 `continueDeepKnowledge` 自動進入 Deep 前的 `await publishState(..., { deliverAs: "displayOnly" })`。這行只負責顯示階段面板；目前 PI 不保證辨識 `displayOnly`，可能把它當成會觸發模型回合的訊息，干擾 Deep identity followUp 與工具時序。

只刪除自動進入 Deep 的這個 UI side effect；保留 `WAIT_USER`、recovery、confirmation panel、session state、active tools、pending fail-closed gate、status 與其他既有 UI。這項決策取代先前「自動 Deep 使用 `displayOnly` 面板」的未完成方案，不新增替代 UI 或 delivery contract。

上述「已核准、待實作」是歷史交接快照。實作時已先以 regression RED→GREEN 證明並修正問題；沒有為測試放寬正式 gate，也沒有修改 `pi-main`。

### 實作與驗證收尾

- mixed batch barrier 已完成：五個 extension contracts 與一個 AgentSession/faux-provider parallel mixed batch integration 通過；call ID barrier、retryable mixed reject、全 search terminate、單一同 identity follow-up、completion-only replay、stale／route 防重複與 prompt guidance 均保留。
- 自動進入 Deep 的階段面板先經 RED→GREEN 回歸，再刪除 `sendMessage`／`publishState(...displayOnly...)` 的多餘 UI side effect；保留 `ctx.ui.setStatus(buildWorkflowStatusText(nextState))` 更新狀態。`WAIT_USER`、recovery、confirmation panel 與 pending fail-closed gate 保留。
- 驗證：auto-panel unit 1/1、AgentSession after-status 1/1、三個受影響 tests 3/3、extension isolated `tsconfig.json` 67/67。較早 pi-config 134/134 是 status 修正前結果，不可作最終證據；最後 pi-config log 只有逐項 ✔、沒有 summary。
- `npm run check` exit 2：production 0 錯誤、本 ticket test 1199 後 0 錯；既有 TUI terminal 10 錯與 pi-main highlight.js 21 錯。完整 pi-grill 受既有 TUI 兩個失敗阻斷，但本 ticket targeted pass。這是既有 workspace caveat，不是本 ticket production error。

## Deep retryable recovery contract 交接（2026-08-28）

### 狀態

`deep-recovery-contract-20260828` 已完成實作、驗證、初次 review fix 與最終雙軸 re-review，狀態為 `implemented-verified-reviewed`，已可交付。策略唯一真相來源為 [`ADR-0018`](adr/ADR-0018-deep-retryable-recovery-contract.md)；執行計畫為 [`docs/PLAN-A.md`](PLAN-A.md) 對應段落。

### 核准策略

`manifest=[]` 且 `source=target` 回 retryable invalid，保留同一 `attemptId`／`sourceRoundId`／`phase`，不進 `WAIT_USER`，要求模型自行改用 `wiki`／`code_base`；runtime 不自動選 source／target。duplicate `decisionId` 維持拒絕、不靜默去重；Evidence Package validator 只有錯誤包含 `決策 ID 重複` 時標 `retryable:true`，保留同一 `KNOWLEDGE_UNDERSTANDING` attempt，以相同 identity 重送修正後唯一 IDs。其他 validation failure 不因本 ticket 自動標 retryable；invalid／rejection 不推進 stage 或寫 `CONTEXT_BUILD`，既有 stale guard 保留。

### 相關文件

- `CONTEXT.md`
- `docs/adr/ADR-0018-deep-retryable-recovery-contract.md`
- `docs/PLAN-A.md`
- `docs/tickets/deep-recovery-contract-20260828.md`
- `agent-state/deep-recovery-contract-20260828.md`
- `Memory/record.md`
- `Memory/lesson_learn.md`
- `forge-runtime/extensions/forge-runtime.ts`（本 ticket 唯一 production 修改）
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`（本 ticket 唯一測試修改）

### 基線、風險與執行順序

初次 review findings 均已修正並保留為歷史：durable state、setup 重複、budget coverage、retryable 過寬、stale state 與 Plan A baseline 標示。Final test refactor 後 extension `129/129`（`forge-runtime/.tmp/deep-recovery-final-refactor-focused.log`）；排除 `pi-grill-interactive.test.ts` 的本地 suite `214/214`（`forge-runtime/.tmp/deep-recovery-review-local.log`）。標準 `npm test` 為 `214 pass/1 fail`，唯一既存缺 qwen token-plan JSON（`forge-runtime/.tmp/deep-recovery-review-npm-test.log`）；final `npm run check` 為 38 個既存 baseline errors，沒有錯誤指向本 ticket 修改的 `forge-runtime.ts` 或 `forge-runtime-extension.test.ts`（`forge-runtime/.tmp/deep-recovery-final-check.log`）。`pi-grill-interactive.test.ts` 不是本 ticket 修改檔。最終 re-review：Standards P0/P1/P2=0；Spec P0/P1/P2=0。

新 session 可直接視本 ticket 為已驗證、已 review、可交付；下一步只剩真實 PI 原情境人工驗收，以及由使用者決定是否提交。Node `DEP0190` 為非阻塞 warning。未改 `session-state.ts`、`pi-main`、API/schema/UI/scheduler/snapshot，未新增依賴、Plan B、自動 fallback 或模糊 matching。

## 結論

Intent 已完成 route-only 實作、finalgreen 驗證與獨立 final review；Standards 與 Spec 均為 0 發現事項。Light Discovery 第一階段的實作、驗證與雙軸審查均完成。

## Scope

- LLM 僅判斷 `passthrough`／`start_forge`，嚴格 JSON、TypeBox 驗證、10 秒 fail-closed。路由規則在 `systemPrompt`，raw input 以獨立 `user` message 傳入，並由 injection structure regression 固定隔離。
- workflow guard、自然 rawText、`/grill-run` canonical payload wrapper、extension handoff private seed fixed-point helper 與唯一第二參數 `IntentModelContext` model seam；`IntentInput` 不含 model context。

## Non-scope

- 不改造 Grill／Deep Knowledge，不新增永久 route audit log，不加入第三種 route，不修改 `pi-main/`。

## 修改檔案

- Production：`forge-runtime/src/intent/intent-understanding.ts`、`forge-runtime/src/intent/intent-types.ts`、`forge-runtime/extensions/forge-runtime.ts`；刪除 `forge-runtime/src/intent/resume-check.ts`（session resume guard 移到 extension／共用 model 前置流程）。Light Discovery production 不在 scope。
- Tests：`forge-runtime/tests/intent/intent-understanding.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`（公開 seed characterization test）、`forge-runtime/tests/extensions/pi-extension-loader.test.ts`（loader smoke 修正）。Light Discovery 內部測試不在 scope。
- Tests：另含 `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`；其 faux provider queue 與 route call-count 已配合 router completion 調整。
- 文件：`CONTEXT.md`、`docs/adr/ADR-0013-intent-route-only-llm.md`、`docs/PLAN-A.md`、本檔、`Memory/record.md`、`Memory/lesson_learn.md`、`agent-state/intent-route-only-llm-20260821.md`。

## 驗證

從 `forge-runtime/` 執行：

```text
npx tsx --test tests/intent/intent-understanding.test.ts
npx tsx --test tests/extensions/forge-runtime-extension.test.ts
npx tsx --test tests/extensions/pi-extension-loader.test.ts
npm run check
npm test
```

結果為 intent 12/12、Forge extension 91/91、loader smoke 2/2、check exit 0、完整 suite 146/146；證據位於 `.tmp/intent-route-only-systemprompt-*.log`。loader smoke 已拆除無關 LLM prompt，仍需既有 `pi-grill`／PI runtime dist 前置條件。

## Final review

- Standards review：0 findings。
- Spec review：0 findings。
- 本階段只完成使用者輸入到 Intent Understanding；未推進 Light Discovery。

## Rollback

回退本 ticket 的 production/test commit 與同步文件；不修改 `pi-main/`。若 loader smoke 再次 timeout，先重跑既有 loader 前置條件，不以修改 router contract 掩蓋環境問題。

## Light Discovery 交接

- ADR-0014：Accepted。Light Discovery 採單一 public seam，input 只收 workspace/root 與 raw userMessage，內部依序為 Input normalization、deterministic Core、Output normalization。
- 只搜尋 `wiki/` 與 `code_base/` 的檔名、相對路徑與 v1 metadata：`source`、`relativePath`、`fileName`、`extension`；不搜尋全文，每個來源最多 3 筆，且固定排序。
- 單一檔案失敗時保留既有結果並附 warning，由 workflow 決定是否進入 WAIT_USER。Output 不含完整內容、summary、Pattern Card 或 Grill snapshot；既有 Grill 相容資料暫由 module 外 adapter 建立。
- Light Discovery 已完成 production 實作與測試遷移；使用者已於 2026-08-22 核准 ADR-0014 第一階段。只掃 `wiki/`、`code_base/` 一般檔案 metadata，每來源最多 3 筆、相對路徑 deterministic，回傳 warning/sourceAvailability；既有缺失來源人工核准流程保留。
- `forge-runtime.ts` 的相容 adapter 已讀取內容後依 raw request seeds 計算 path/content、`matchedSeeds`、`score`，只讓符合 relevance 契約者進入 `codeBaseCandidates`。此修復保留 Light Discovery metadata-only 邊界。
- 測試遷移已清除 2 個 stale old API callers，刪除 10 個 ADR 淘汰測試、改寫／保留 5 個，並還原 2 個強相關 Deep expectations。
- 最終驗證：互動 9/9、focused 79/79、`npm run check` exit 0、完整 `npm test` 140/140，0 fail/skip/todo；證據位於 `forge-runtime/.tmp/review-fix-verify-*.log`。僅有既有 Node `DEP0190` warning，無殘留程序。

### Light Discovery 實作修改檔案

- Production：`forge-runtime/src/discovery/light-discovery.ts`、`forge-runtime/extensions/forge-runtime.ts`。
- 參考／證據（未修改）：`forge-runtime/src/discovery/discovery-sources.ts`，僅作既有 discovery source 邊界參考。
- Tests：`forge-runtime/tests/discovery/light-discovery.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`，以及測試遷移涉及的三個既有 test 檔。
- Durable docs：本檔、`CONTEXT.md`、`docs/adr/ADR-0014-light-discovery-file-metadata-module.md`、`docs/PLAN-A.md`、`Memory/record.md`、`Memory/lesson_learn.md`、`agent-state/light-discovery-file-metadata-20260822.md`。

### Review handoff

實作、驗證與雙軸審查均完成。初次 Standards 與 Spec 審查各有 3 個發現事項；採納修正後 Spec re-review 為 0 發現事項，Standards re-review 僅發現過時數字，已修正。未解風險為既有 Node `DEP0190` warning；本 ticket 未擴大來源、未加入 full-content／summary／snapshot。依使用者核准的 v4 分階段交付例外，v4 end-state 不變，本 ticket 不宣稱完整多來源／Summary／Evidence ID 符合。

### PLAN-A 預定檔案範圍

- Production：`forge-runtime/src/discovery/light-discovery.ts`、`forge-runtime/extensions/forge-runtime.ts` 的 module 外相容 adapter。
- Tests：`forge-runtime/tests/discovery/light-discovery.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。
- 文件與狀態：`CONTEXT.md`、`docs/adr/ADR-0014-light-discovery-file-metadata-module.md`、`docs/PLAN-A.md`、`Memory/record.md`、`Memory/lesson_learn.md`、`agent-state/light-discovery-file-metadata-20260822.md`。

## Grill 到 Deep Knowledge 交接交班

本 ticket 已完成實作、驗證與雙軸複審。詳見 [`ADR-0015`](adr/ADR-0015-grill-deep-knowledge-handoff-boundary.md)、[`docs/PLAN-A.md`](PLAN-A.md) 與 [`agent-state/grill-deep-boundary-risk-20260823.md`](../agent-state/grill-deep-boundary-risk-20260823.md)。

交付規則如下：Grill 負責查證與人類決策；Deep 沿用 Grill 的 immutable snapshot 與決策，不重讀相同 `wiki/`／`code_base/` 證據，只補 snapshot 沒有且後續明確需要的新來源。進 Deep 前關閉 Grill pending／round，Deep 不直接向使用者提問；只有新 Evidence ID 帶來新歧義時，Workflow 才可建立新 Grill round。relevance failure 回到 Discovery clarification，回答後重新進 Light Discovery；debug completion 走正式 gate。WAIT_USER identity 採使用者裁決的方案 A：`roundId + kind + decisionId`；unknown round reject、精確舊 round replay idempotent、新 round 可重用相同 ID。stale `message_end`、`/continue` 與 relevance `/confirm` 均受 guard 保護。

實作涵蓋交接 seam、active-stage guard、relevance clarification 回流、snapshot identity、debug gate、UI lease 與 round identity。原計畫 7 個測試已完成，複審另補回歸案例：

- `RelevanceFailure_UserClarifies_RerunsLightDiscoveryBeforeGrill`
- `DeepStart_StaleGrillEvents_DoNotReopenGrill`
- `Extension_WhenDeepHandoffAwaits_ShouldCloseGrillBoundaryBeforeAwaitAndIgnoreStaleMessageEnd`
- `Extension_WhenRelevanceWaitUserReceivesConfirm_ShouldKeepClarificationPending`
- `DebugCompletion_InvalidRoundOrEvidence_IsRejectedByFormalGate`
- `UserConfirmed_DiscoveryClarification_AllowsLightDiscovery`
- `Reset_NewGrillRound_UsesMonotonicRoundId`
- `NewSnapshot_FetchedEvidence_DoesNotLeakFromPreviousSnapshot`
- `ReadyForDeep_ExistingDiscoverySnapshot_IsReusedWithoutDuplicateReads`
- `SessionState_WhenNormalConfirmationIdCollidesWithRoundId_ShouldStillEnterGrill`
- `Extension_WhenNormalConfirmationIdCollidesWithRoundId_ShouldRejectReadyForDeepReplay`

最終驗證：`npm run check` 兩個 tsconfig 通過；`npm test` 157/157、0 fail、0 skip；Standards／Spec final review 的 P0、P1、P2 均為 0。未來若要延伸，仍需另開 ticket 處理完整 semantic Deep、Pattern Card、持久化 session、第二個 verifier 或 Deep → Grill result type；本 ticket 不包含這些工作。

本 session 已完成交付；後續只需由使用者決定是否另開 out-of-scope 延伸 ticket。

## Deep Knowledge Retrieval／Understanding 交接

本段是 ticket `deep-knowledge-retrieval-understanding-20260824` 的設計階段交接快照，已由下方「最終實作與驗證」取代；當時程式碼、測試與 review 尚未完成。

### 結論

Grill 只準備決策所需的最小證據。Deep 直接接手 Grill 實際引用的完整 evidence 與 immutable decisions，不重讀相同 evidence；客觀缺口才可補查。Deep 先做 Retrieval 並鎖定證據，再做只能讀固定集合的 Knowledge Understanding，產出經 validator 驗證的 Evidence Package。結果為 `completed`、`needs_decision`、`needs_discovery`；completed 後進 `CONTEXT_BUILD`。

### Scope

- 三個工具：`forge_deep_search`、`forge_deep_retrieval_complete`、`forge_deep_complete`。
- 主 session active model；attempt identity 為 `attemptId + sourceRoundId + phase`。
- Evidence Package 的 inherited／supplemental evidence、decisions、findings、非阻擋 limitations 與 deterministic validator。
- `needs_decision` 由 Workflow → `WAIT_USER`，`needs_discovery` 回 `LIGHT_DISCOVERY`；stale call 拒絕，技術失敗／取消保留輸入。

### Non-scope

不做模型派發／fallback／custom loop、Pattern Card、持久化、第二 verifier、UI、Web／外部 API、任意 local source、Context／ADR／SPEC／Ticket 內容生成或任何 `pi-main/` 修改。不要修改未追蹤的 `forge-runtime-flow.html`、`progress-timeline.html`。

### 相關檔案

- ADR：`docs/adr/ADR-0015-grill-deep-knowledge-handoff-boundary.md`、`docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md`
- 計畫：`docs/PLAN-A.md` 的「Deep Knowledge Retrieval／Understanding／Evidence Package」段落
- Production：`forge-runtime/extensions/forge-runtime.ts`、`src/evidence/evidence-engine.ts`、`src/runtime/session-state.ts`、`src/knowledge/discovery-engine.ts`、`src/workflow/state-machine.ts`
- Tests：`tests/evidence/evidence-engine.test.ts`（NEW）、`tests/runtime/session-state.test.ts`、`tests/workflow/state-machine.test.ts`、`tests/extensions/pi-grill-interactive.test.ts`
- State：`agent-state/deep-knowledge-retrieval-understanding-20260824.md`

### 基線與驗證

（歷史快照）當時 baseline 為 `npm test` 157，預期新增 21 個測試；目前實際收尾結果以「最終實作與驗證」為準。

### 未解風險

- 主 session active model 的既有工具輪次是否能在兩階段切換工具並安全恢復，需由實作與測試確認；不可因風險偷偷加入 custom loop。
- target source 必須是 Grill snapshot 已明確存在的檔案；無法辨識時回 `needs_decision`。
- 模型可能漏掉語意問題；第二 verifier 不在本 ticket。

### 下一步（設計階段歷史；已由下方收尾取代）

### 最終實作與驗證（2026-08-25）

- 狀態：已實作、已驗證。共五個工具：`forge_grill_evidence`、`forge_grill_complete`、`forge_deep_search`、`forge_deep_retrieval_complete`、`forge_deep_complete`。
- Deep identity 固定為 `attemptId + sourceRoundId + phase`。retry 產生新 attempt、保留 source round、回原 Deep phase；cancel 保留 input／evidence，`continue` 回原 Deep phase，不回 Grill。stale outcome 優先 quiet reject；active-tools capability 對 active identity fail-closed。
- 人類決策持久格式是 `問題：…；決定：…`，同一 decisionId 首筆不可覆寫；Evidence Package 先注入 human decisions，模型 duplicate decisionId 拒絕。
- 固定上限：query 1500 Unicode code points；同 source／Grill round 最多 8 次搜尋且 retry／cancel 不重設；單筆 256 KiB（讀檔前 stat，恰好上限可）；整輪 2 MiB，包含 Grill fetched 與 Deep supplemental；decisions／findings／limitations 各 50；每段 statement 4,000 Unicode code points。超限先拒絕、不改 state。
- 「每次來源搜尋最多 3 個相關候選」仍保留，這是呈現／候選上限，不是 Evidence Package 每類 50 筆安全上限。Deep 不重讀 Grill fetched evidence；ID 唯一、finding 引用必須存在、blocking limitation 不可 complete。
- 驗證：初次 Deep 實作 `npm test` 208/208；identity handoff follow-up 完成後完整 209/209，`npm run check` exit 0。Standards 唯一 hard finding 是 README tool 清單過時，已修正；Divergent Change／Repeated Switches 是固定三來源與 Ponytail/YAGNI 下的 judgement call；Spec 無 production 缺口；adversarial 最終無 P0/P1。
- 下一步：由使用者在真實 PI session 重跑原始情境；目前未 commit、未 staged，無 production blocker。

### 首次 Grill→Deep identity handoff 修正交接（2026-08-25）

首次 READY→Deep 建立 active identity 後，已沿用 decision-retry 的 `pi.sendUserMessage(..., { deliverAs: "followUp" })`，將 `attemptId`、`sourceRoundId`、`phase` 傳入下一模型回合。

- production `forge-runtime/extensions/forge-runtime.ts` 的三個 caller 以 closure-local setter 傳遞 `pendingReplayInvocation`；`continueDeepKnowledge` 建立 attempt 後先設定 marker，再送出 identity-bearing followUp。
- identity 不放入 tool details；Deep tools 不自行取得 identity；不改 stale guard、tool schema、`pi-main/`、不加 sequential 設定。public seam 是現有 `registeredTools`／harness。
- 驗證：handoff regression red 為 114 pass/1 fail（handoff undefined），修正後 green 115/0；聚焦 4/4；相關 147/147（`.tmp/deep-related-green-20260825.log`）；完整 209/209（`.tmp/deep-full-green-20260825.log`）；`npm run check` exit 0（`.tmp/deep-caller-check-20260825.log`）；final quick review 0 functional findings。
- 修改檔案：production 1、tests 2，以及本次五份交付文件與兩份 Memory 文件。
- 未解風險：尚未由使用者在真實 PI session 重跑原始情境；這不是 blocker。

## Deep 階段輸出守門交接（2026-08-26）

- Ticket：`deep-stage-output-guard-20260826`。
- 狀態：implemented-and-verified。
- 目標：Deep Retrieval 與 Knowledge Understanding 只準備後續實作所需證據，不在此階段開始寫 RTL 或其他實作內容。
- 核准契約：guard 僅在有 active Deep attempt 且 stage 為 `DEEP_KNOWLEDGE_RETRIEVAL`／`KNOWLEDGE_UNDERSTANDING` 時成立；`message_update`／`message_end` 移除 assistant `text`／`thinking`，保留合法 `toolCall`。
- 邊界：不沿用 Grill recovery，不影響 `WAIT_USER`、Deep cancel 後或後續階段；不新增 Plan B、不修改 `pi-main/`。
- 根因：`forge-runtime/extensions/forge-runtime.ts` 的 assistant prose guard 只覆蓋 Grill；Deep active 後只換 active tools，未在 `message_update` 與 `message_end` 同時攔 `text`／`thinking`。
- 修正：新增 `hasActiveDeepAttempt`；Deep Retrieval／Understanding active attempt 的串流清空 `text`／`thinking`，final message 只保留合法 `toolCall`；不改 `pi-main/`。
- 驗證：`PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue` 先以 `FORBIDDEN_IMPLEMENTATION_MARKER` 紅燈（exit 1），修正後 targeted 9/9；修正 fixture schema 與過時 transition assertion 後，`npm test` 209 passed/0 failed/0 skipped，`npm run check` exit 0。production review 零 functional findings，scope on target。
- 修改檔案：production `forge-runtime/extensions/forge-runtime.ts`；tests `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`；以及本 ticket 交付文件與兩份 Memory 文件。
- 未解風險：Grill 的 `message_end` 含 toolCall 分支仍依賴 `message_update` 先清文字，未證實且不在本 ticket 擴修。
- Context／ADR／Spec／Ticket／Planning 尚未串成 runtime flow：這是本 ticket 範圍外的後續風險，不影響 `deep-stage-output-guard` 已完成；未來若啟用該串接，另開 ticket 建立各階段輸出契約。

（歷史快照）先建立紅燈、完成最小 production diff，再執行完整驗證與 review；上述工作已完成。

### 最後驗證與工作樹狀態（2026-08-25）

- 工作期間 HEAD 由外部移至並同步 `origin/main` 的 `324501a0412bbfdead9642aeb845bb26192b57cc`，不是本代理 commit；目前本 ticket 剩九檔 tracked 修改未提交。
- 隔離 detached worktree 只套用九檔 diff 後，`npm run check` exit 0，四個關鍵測試均 4/4 exit 0；logs：`forge-runtime/.tmp/deep-isolated4-check-20260825.log`、`forge-runtime/.tmp/deep-isolated4-targeted-20260825.log`。主工作樹 full 仍 209/209。
- isolated3 不列為通過：正式結果為 209/197/12，12 項皆在 assertion 前因 `ERR_MODULE_NOT_FOUND typebox`，根因是隔離 package-resolution setup 失敗；證據：`forge-runtime/.tmp/deep-isolated3-check-20260825.log`、`forge-runtime/.tmp/deep-isolated3-test-20260825.log`。
- 未解仍只有使用者尚未在真實 PI session 重跑原始情境；isolated3 caveat 不構成 production blocker。

## Deep identity handoff activation 修正交接（2026-08-26）

### 狀態

implemented-and-verified；已完成實作與驗證。使用者核准的「在 identity followUp 到達前不啟用 Deep tools」修正已落地。

### 根因與核准方案

`forge_grill_complete` 建立新 Deep attempt 後立即啟用 Deep tools，但 identity-bearing followUp 要等目前 assistant turn 結束才進入 `input`。空窗期間模型以舊 identity 呼叫，先被 stale guard 安靜拒絕；followUp 到達後重試才成功。

移除／延後當下的 `activateDeepRetrievalTools()`；在既有 `pi.on("input", ...)` exact pending replay invocation 條件內，先清除 `pendingReplayInvocation`，再啟用 Deep Retrieval tools，之後沿用 `{ action: "continue" }`。

保留 identity 三元組、stale quiet reject、followUp transport、主 session 與既有 verifier；不修改 `pi-main/`。不採 completion tool result 注入 identity，也不新增 custom loop、sequential 設定、新狀態機、UI 或 Plan B。Grill `message_end` 含 toolCall 的文字清除 sibling risk 不在本 ticket。

### 修改檔案與測試

- Production：`forge-runtime/extensions/forge-runtime.ts`。
- Tests：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。
- `Extension_WhenGrillCompletionQueuesDeepIdentity_ShouldEnableDeepToolsOnlyAfterFollowUpStarts`
- `Extension_WhenDeepHandoffIsPending_ShouldKeepDeepToolsUnavailableAndIgnoreStaleEvent`

### 驗證與收尾

Deep Retrieval activation 已從 `continueDeepKnowledge` 延後至 exact `pendingReplayInvocation` input gate；gate 先清 marker，再啟用 Deep Retrieval tools，之後沿用 `{ action: "continue" }`。新增加的 2 個 timing regression 已通過，targeted 117/117、完整 `npm test` 211/211、`npm run check` exit 0。本輪未發現新 bug。

未解風險：Grill `message_end` 含 toolCall 的文字清除 sibling risk 未由本輪證實，仍留待另案；使用者尚未在真實 PI session 重跑原始情境仍是既有非 blocker。未修改 `pi-main/`，不做 Plan B。

### Final review medium finding 修正（2026-08-26）

`requireDeepToolBoundary` 已修正為必須同時具備 tool boundary 與 `sendUserMessage`，才可完成 handoff。若無法送出 identity-bearing followUp，不能只完成工具邊界而宣稱成功，避免半完成狀態。修正後 targeted 117/117、`npm test` exit 0、`npm run check` exit 0；本輪未發現新 bug。

## Deep identity handoff recurring bug 診斷（2026-08-26）

### 真實 runtime 現象

使用者在 Deep stage panel 後，會連續看到多次 stale；直到 identity-bearing followUp 顯示後，流程才恢復正常。這不是單次 stale，而是 identity handoff 與實際 agent loop 排程不同步造成的 recurring bug。

### 根因

- 先前誤把 input event 當成 followUp 已交付；實際上，input 會在 enqueue 前觸發，不能代表 followUp 已經進入 PI agent loop 的可處理佇列（`forge-runtime.ts:1254`、`1914`、`1974`）。
- `publishState` 未指定 delivery；streaming 時 Deep stage panel 被轉成 `steer`。PI 會優先處理 `steer`，identity-bearing followUp 只有在工具／steering 停止後才 drain（`agent-session.ts:1142`、`1176`、`1456`；`agent-loop.ts:259`、`262`）。
- 因此 input gate 提前開啟 Deep tools；此時模型仍可能使用舊 identity 呼叫 Deep tools，stale guard 會安靜拒絕，形成下一輪重試的起點。

### stale loop 為何持續

stage panel 的 streaming `steer` 不斷搶在 identity-bearing followUp 前被 PI 處理；每次 gate 提前開啟 Deep tools 後，舊 identity 呼叫都先抵達並被 stale guard 拒絕。由於 followUp 尚未 drain，新的 Deep 回合無法取得 matching identity，於是「舊 identity → stale reject → stage panel／steer → 再次舊 identity」反覆循環；只有 followUp 真正 drain 並顯示後，identity 才匹配，流程才會停止 stale。

### 現有 harness 缺口

現有 fake harness 直接 execute，並把 input 當成 delivery；它沒有模擬真實 PI agent-loop 的 queue priority，因此未覆蓋 `steer` 優先於 followUp、以及 followUp 延後 drain 的時序（`tests/extensions/forge-runtime-extension.test.ts:2616`）。目前測試綠燈不能證明真實 runtime 已覆蓋此 recurring bug。

### 下個 session 建議修正範圍

- Deep stage panel 改為 `displayOnly`，不再以會參與 agent-loop 排程的 `steer` 傳遞。
- pending identity 保留到 matching user message 實際進入 `message_start`，不可在 input event 階段提前消費。
- pending identity 期間由 tool-call gate 阻擋 Deep tools。
- 補上真實 PI agent-loop integration regression，覆蓋 queue priority 與 followUp 實際 drain 時序。

### 本 session 狀態與邊界

本 session 僅完成診斷，尚未修改程式、尚未執行修正後測試；狀態為 `diagnosed-ready-for-red`。仍保留不修改 `pi-main/` 的邊界。若實作時發現 extension surface 無法建立 delivery gate，依 `FORGE_RUNTIME_Arch_v4.md` 停下來回報衝突，不自行跨越該邊界。

> 歷史註記：本段的 `displayOnly`／Deep stage panel 契約不是現況；自動 Deep 面板已移除。WAIT_USER 投遞改由 ADR-0020 另案處理，尚未實作。

## Deep stale-result loop 修正交接（2026-08-26）

### 狀態

Ticket `deep-stale-result-loop-20260826` 已完成規劃核准，狀態為 `plan-approved-ready-for-red`（修正前歷史狀態）；尚未修改程式或執行修正後驗證。

### 唯一目標

只修正「過期的 Deep Retrieval 完成結果已忽略」反覆循環：stage panel 的 `steer` 搶先於 identity-bearing followUp，且 input preflight 太早消費 pending identity／啟用 Deep，導致舊 identity 持續 stale reject。

### Plan A（修正前歷史狀態）

執行 `docs/PLAN-A.md` 的 `Deep stale-result loop` addendum。先由測試代理補真實 PI agent-loop queue priority／followUp drain regression 並打紅燈，再由主代理做最小 production 修正，最後由獨立驗證代理執行 targeted、完整 suite 與 check。無 Plan B。

### 不變量與禁止範圍

- stage panel 改為 `displayOnly`；pending identity 僅在 matching user message 進入 `message_start` 才 consume；pending 期間 Deep tools 不可用。
- 不改 Grill completion、WAIT_USER、cancel/retry/switch、relevance、state transition、snapshot、合法 Deep 後續、Grill `message_end` sibling risk 或 `pi-main/`。

### 下一步（修正前歷史狀態）

測試代理先建立並執行 RED regression；若 extension surface 無法建立 delivery gate，依 `FORGE_RUNTIME_Arch_v4.md` 停下並回報，不跨越架構邊界。

## Deep stale-result loop 修正完成（2026-08-27）

### 狀態與結論

Ticket `deep-stale-result-loop-20260826` 已 implemented-and-automated-verified-awaiting-real-session。只修正「過期的 Deep Retrieval 完成結果已忽略。」反覆循環；尚待使用者在真實 PI session 重跑原始情境。

### 根因、修正與驗證

- 根因：Deep identity followUp 在 input preflight 就清 pending；Deep stage panel streaming 可成為 steer 並先 drain，舊 identity completion 因而先執行並被 stale guard 忽略。
- 修正：初始 Deep stage panel 使用 `displayOnly`；input 只預載本回合 Deep tools，不清 pending；matching user `message_start` 才清 pending；pending 期間 Deep tool_call block。工具預載與 delivery 授權分離，避免 `Tool forge_deep_search not found`。
- 真實 AgentSession／InteractiveMode／faux provider：未修版正式 RED 1 fail；修正版正式 GREEN 1 pass，後續合法 Deep search accepted。TUI 以 `waitForScrollBuffer` 驗證 Deep stage。
- extension targeted 117/117、PI integration 10/10、完整 `npm test` 212/212、`npm run check` exit 0；logs 位於 `forge-runtime/artifacts/test-logs/`。
- 真實 PI v0.83.0 已從 repo root 以 `.\pi-main\pi-test.bat --approve` 啟動，啟動畫面列出 `forge-runtime.ts`；這只是 smoke check，尚未捕捉原始 stale 情境輸入／結果，人工情境驗收仍未完成。

### 邊界與未解風險

review 僅針對 target scope；未修改 `pi-main/`，無暫時 debug probe。blocked tool result `terminate=false` 可能延遲 followUp；其他 Deep `/continue` panel 預設 sendMessage 仍可能形成 steer；Grill `message_end` sibling risk 不在本 ticket。上述均未宣稱已修，未擴大本輪範圍。

> 歷史註記：本段描述的是已完成的舊 Deep stale-result 修正；自動 Deep 面板已移除。WAIT_USER `forge-stage` 投遞由 ADR-0020 取代，且目前尚未實作。

## Deep completion stale termination 交付交接（2026-08-28）

### 最新目標與狀態

Ticket `deep-completion-stale-termination-20260828` 已完成 direct Plan A，狀態為 `implemented-verified-reviewed`。目標是補齊 `forge_deep_retrieval_complete` 與 `forge_deep_complete` 共六個 completion stale return 的 `terminate: true`。

### 實作與驗證完成

Plan A 已獲核准。Retrieval／Understanding fresh-attempt 兩個 public regression（`Extension_WhenRetrievalNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt`、`Extension_WhenUnderstandingNeedsDecisionRepeatsAcrossFreshAttempts_ShouldIssueFreshAttempt`）先紅 `terminate undefined` 後綠；完整覆蓋 needs_decision→WAIT_USER/clear→舊 identity stale+terminate/state-tools 不變→回答後 fresh attempt identity preserved→再次 needs_decision；既有三個 stale tests 補上 `terminate` assertion。六個 stale return 均補上 `terminate: true`。四個 inner branch 因同步防禦路徑無公開 deterministic seam，不新增私有 mock／test hook。focused 124/124、full 219/219、`npm run check` pass；證據：`forge-runtime/.tmp/final-focused-test.log`、`forge-runtime/.tmp/final-full-test.log`、`forge-runtime/.tmp/final-check.log`。PI smoke：`.\pi-main\pi-test.bat --approve` 成功啟動，真實模型回 `smoke ok`、exit 0；log：`forge-runtime/.tmp/pi-smoke.log`。未改 `session-state.ts`、scheduler、UI、schema/API、`pi-main/`；mixed tool batch `every(terminate)` 風險仍不在 scope。Review 已完成，可交付／提交。

### 契約、範圍與風險

每個 active Deep attempt 最多接受一個 `needs_decision`；接受後進 `WAIT_USER` 並清除當前 attempt。同 identity 後續 completion stale、不改 state、terminate。使用者回答保留 `sourceRoundId`／`phase` 並建立新 attempt，新 attempt 可再次 decision。只改 `forge-runtime/extensions/forge-runtime.ts` 與 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`；不改 `session-state.ts`、Grill、`CONTEXT_BUILD`、UI、schema/API、scheduler、`pi-main/`，不做 Plan B。

脆弱假設：同批混有非 terminate 工具結果時，PI 的 `every(terminate)` 仍可能繼續；本 ticket 不修改 scheduler。

### 相關檔案與下一步

相關檔案為 `docs/PLAN-A.md`、`CONTEXT.md`、兩份 Deep ADR、ticket、agent-state 與 Memory 兩檔。Plan A、RED→GREEN、focused/full/check 與真實 PI smoke 均已完成；獨立 review 已完成，可交付／提交。

## Deep target source contract 設計交接（2026-08-27）

### 狀態

Ticket `deep-target-source-contract-20260827` 已完成實作、驗證與 Standards／Spec re-review，狀態為 `implemented-and-verified`。契約唯一真相來源是 [`ADR-0017`](adr/ADR-0017-deep-target-source-contract.md)。目前無待決設計；僅有 Node `DEP0190` 非阻塞警告。

### 範圍與決策

follow-up 從既有 `workflow.snapshot.candidates` 列出 target manifest，空清單也明確呈現；`forge_deep_search` 的 target 分支必填 `targetSource`。缺少時回 retryable invalid、保留 attempt 與 budget；明確但無唯一匹配才進 `WAIT_USER`。stale sibling 回 `terminate: true`。不修改 `pi-main/`、`session-state.ts`、snapshot 契約、合法 Deep 後續，不自動選 target，不加 sequential。

### 實作、驗證與下一步

- production schema 已改為 discriminated union：`target` 必填 `targetSource`，`wiki`／`code_base` 維持不要求。
- handler 對缺少 `targetSource` 在扣除預算前回 retryable invalid，保留 attempt／budget；明確但無唯一匹配時進 `WAIT_USER`。
- Deep follow-up 帶有 target manifest，包含空清單；四個 stale Deep outcomes 均回傳 `terminate: true`。
- 五個指定情境測試均通過；完整 `npm test` `217/217`（`forge-runtime/.tmp/post-schema-test.log`）；`npm run check` exit 0（`forge-runtime/.tmp/post-schema-check.log`）；Standards／Spec re-review PASS。
- 下一步：使用者檢閱並決定提交；目前不捏造 commit。僅剩 Node `DEP0190` 非阻塞警告。

## WAIT_USER UI-only state publication 實作交接（2026-08-29）

### 狀態與結論

Ticket `wait-user-ui-only-state-publication-20260829` 已完成，狀態為 `implemented/verified-with-existing-workspace-caveats`。`publishState` 先更新 `setStatus`；`displayOnly` 直接返回，不呼叫 `sendMessage`。omission branch state 使用 display-only，recovery panel 保持 `triggerTurn: false`。

### 保留範圍與修改

- 保留 workflow state/status、WAIT_USER selector、custom editor、answer followUp、retry 與 recovery；不修改 `pi-main`。
- `InteractiveModeOptions` 目前僅支援 `tuiMode`；10 個 tests 使用 test-local `attachVirtualTerminal`，完成 `init`、`run`、`waitForRender` 後才送入輸入。

### 驗證證據

- Extension targeted 2/2；PI targeted 3/3，含 no-auto-replay 與 explicit retry provider callCount 2→3。
- Static touched errors 0；剩餘 pi-main highlight.js 21 個 baseline errors；`git diff --check` 0，`pi-main` diff 0。
- 真實 PI 0.84.3 no-session smoke：合法 `/grill-run` 後 WAIT_USER `display-only smoke` PASS，confirm processed；normal active `forge-stage` 皆在 WAIT_USER 前，沒有 WAIT_USER-specific stage 證據。cancel 因在 streaming 送入而 inconclusive；第一次 forged roundId fail-closed 拒絕，不算產品失敗。
- Full PI file 11/11；`PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue` 已由 RED（actual pending responses 3、expected 0）修正為 GREEN。完整 npm suite 仍於既有 integration hang（bounded 180 秒）中止，不能宣稱整套正常退出。
- Core rules／security review PASS；manual retry gap 已補。private renderer terminal cast 是 upstream 無 public injection seam 的測試 caveat，未新增抽象。

必要 logs：`verify_three_wait_user_pi_contracts_with_retry_20260829.log`、`verify_two_wait_user_extension_contracts_final_20260829.log`、`verify_static_after_harness_sweep_20260829.log`、`verify_full_pi_grill_interactive_20260829.log`、`verify_full_forge_runtime_suite_20260829.log`。

### 下一步

只保留完整 suite integration hang 與可選真實 cancel smoke；Deep pure-search continuation 已修正並驗證完成，本 ticket 不需下一 session 再實作。

## Deep pure-search continuation 修正交接（2026-08-29）

Ticket `deep-mixed-tool-batch-termination-20260829` 已完成，狀態為 `implemented/verified-with-existing-workspace-caveats`。根因是 coordinator 在 `forge-runtime/extensions/forge-runtime.ts:1284` 的 `!batch.mixed` guard 提前返回，未排入 same-identity follow-up；不是搜尋失敗。`continue` 沿用 `sourceRoundId`，3 + 5 次達 8 次上限是後續的正確 quota 行為。

只移除 pure-batch guard；保留 terminate=true、全部 settle barrier、followUpQueued、identity／active checks、mixed reject、completion-only、quota、fail-closed 與 `pi-main` 不變。public-seam 測試位於 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts:1585,1836-1948`。

PI TUI 回歸 1/1、完整 PI 互動 11/11、新增 extension 測試 2/2。extension 完整 assertions 68 pass／0 fail，但 summary 後背景程序未退出而在 180 秒中止；check／第二段 tsc 只剩既有 21 個 `pi-main` `highlight.js` baseline 型別錯誤。bounded npm test 卡在既有 human-decision integration，未觀察失敗。兩份獨立 review 無阻擋 finding；低風險未解項為 synthetic failed result 與真實 awaited `message_end`／tool-call ID 假設。

## Deep Discovery fallback 與 human premise 設計交接（2026-08-29）

Ticket `deep-discovery-fallback-human-premise-20260829` 已完成設計核准，狀態為 `design-approved-ready-for-red`；本次只完成設計，尚未修改 production/test。契約見 [`ADR-0021`](adr/ADR-0021-deep-discovery-fallback-human-premise.md)。

Retrieval／Understanding 合併計 `needsDiscoveryCount`；第一次 `needs_discovery` 自動重用 Light Discovery→Grill，第二次及之後進入 `WAIT_USER`，kind=`deep_discovery_fallback`，固定問題完全等於「此專案資料來源不足，將以前次 grill/ 資料來源所得之證據進行後續開發，請確認」。只接受 trim 後整句「同意」或「確認」。確認後 fresh Understanding identity，只允許 `forge_deep_complete`；累積 evidence 依 evidenceId 去重，零外部來源建立 `human_premise`。由已驗證 evidence 直接成立的事實性 finding 可維持事實陳述；implementation inference 必須以「推論：」開頭並引用有效 Evidence ID。只引用 `human_premise` 且沒有 verified evidence 時，validator 強制「推論：」；混合 evidence 仍須標示實際推論，既有引用／ID 檢查不放寬。再次不足仍 WAIT_USER，不自動循環。

下一 session 起手句：`請閱讀 docs/handoff.md，然後呼叫 Skill(execute-designed-plan)。先向我展示 context 摘要，等待我確認後再開始實作。` 讀取 handoff／CONTEXT／ADR-0021／PLAN-A 後展示摘要，等待使用者確認，再依 TDD RED→最小實作→GREEN。驗證 followUp 時序、跨 snapshot 去重與 prompt／identity 不被當成自由文字路由；任一不成立即停下，不放寬 gate。

## Deep Discovery fallback 與 human premise 完成交接（2026-08-30）

Ticket `deep-discovery-fallback-human-premise-20260829` 已完成，目前無待做 production 項目，只剩上游 check baseline。Evidence Package 支援並驗證 `human_premise`；Retrieval／Understanding 共用 `needsDiscoveryCount`。第一次 `needs_discovery` 經正式 `tool_result` transform 自動重跑 Light Discovery→Grill，第二次進精確問題的 `WAIT_USER`，只接受 trim 後完整 `同意`／`確認`。確認後建立新的 Knowledge Understanding identity，只允許 `forge_deep_complete`。

Grill／Deep evidence 跨第一次 snapshot switch 累積並依 ID 去重，在 cancel、switch、new workflow、reset 清除。human premise 記錄 goal、question、answer、`needsDiscoveryCount`、兩輪 `sourceRoundIds`，decision 引用該 premise。READY_FOR_DEEP 使用 terminate 與 pending settled invocation，在 `agent_settled` 的下一個 task 送普通 user message，再重驗 identity／stage／tools；pending handoff 關閉 Deep tool gate；WAIT_USER publication await；`message_end` callback 帶 ctx；fallback 無 locked evidence 的 `needs_decision` 將兩個 accumulator keys 視為合法 evidence。

最終證據：Evidence 13/13、Session State 22/22、Extension 142/142、PI interactive 12/12、`npm test` 248/248；Standards／Spec 獨立審查均 PASS。`npm run check` exit 1，Forge Runtime 自身零錯誤，唯一失敗是未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21` 缺少 `highlight.js` declaration（TS7016）。不修改 `pi-main`。

## Decision replay 的 UI-only stage 修正交接（2026-08-30）

### 狀態與目標

Ticket `deep-decision-replay-ui-only-stage-20260830` 已完成設計文件並進入實作，狀態為 `implementation-in-progress`。使用者已核准先更新文件再開始實作；目前可沿既有核准方向繼續，不需再次確認。

實測問題是：`needs_decision` 回答後，純 UI 的 `forge-stage` 經 `pi.sendMessage` 進入 steer queue，排在新 attempt identity 前；current run 未終止，模型拿舊 identity 重試，造成多次 `Tool execution was blocked`。`CONTEXT_BUILD` stage 也可能進 provider context，被模型誤認成使用者要求。真 PI trace 另證明 Retrieval accepted／terminate 後 `callCount=5` 且 idle，表示 Retrieval→Knowledge Understanding 缺少 explicit continuation；這是 transport 缺口，不是 state machine 要重排。

### 核准設計與不變量

- `publishState` 唯一出口的所有 `forge-stage` 永遠 UI-only，使用 `ctx.ui.setStatus("forge-runtime", status)` 固定 key 加 status text，不進 `pi.sendMessage` 或 agent/provider context；只移除 `sendMessage` 會因 undefined text 讓 footer provider 刪除項目，不能採用。
- decision answer 後終止 current run，沿用既有 `agent_settled` + next task + ordinary user message；先送新 attempt identity，再允許 Deep call。
- 保留 pending marker、matching `message_start`、identity/stage/tools revalidation 與全部 fail-closed gate。
- Retrieval completed 與 Deep `needs_decision` answer 都只設定既有 `pendingSettledDeepInvocation`，等 `agent_settled` 後由既有 identity／active-tool／workflow guards 發送；不新增替代 transport。
- 第一次 Deep `needs_discovery` 的真 PI 實測顯示，將既有 restart invocation 拼入 tool-result content 不會產生下一個 provider user turn，accepted tool result 後會停住並留下 pending provider responses。保留既有 pendingDiscoveryRestart 與消費點，僅在 `toolCallId`、`toolName`、`isError=false`、workflow／identity 邊界全匹配時一次性消費，呼叫既有 `restartLightDiscoveryAndGrill`，改以 `pi.sendUserMessage(invocation, { deliverAs: "followUp" })` 排入下一 provider turn；缺少 sendUserMessage 或不匹配時 fail-closed，不新增 `tool_execution_end` API。
- 不影響 session-state、state machine、evidence、validator、Grill WAIT_USER 語意、needs_discovery 次數／人類確認規則、READY_FOR_DEEP、Context Build、cancel/retry/switch、合法 Deep 後續或 `pi-main`。若需要第二個 production 檔、public API 或新的事件 API，立即停下回報。

### 實作計畫

執行 [`docs/PLAN-A.md`](PLAN-A.md)，只有 Plan A、沒有 Plan B，因本 ticket 不改 UI 畫面，只隔離 transport。Production 只允許 `forge-runtime/extensions/forge-runtime.ts`；測試只允許 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 與 `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。

TDD vertical slices：A1) Extension `observedStatuses` 驗證固定 key `forge-runtime` 與 `CONTEXT_BUILD` status text；A2) 真 PI trace 必須真正到達 Context Build，且沒有 user-role stage，不能只用「沒有 literal」假綠；B) Retrieval trace `callCount=5` 且 idle，並驗證 fresh deep-2 首次成功、blocked=0；C) Extension pending replay 期間舊 attempt 仍被 gate 阻擋（targeted 1/1 green）。目前 production 已完成 status key、`forge-stage` UI-only 與兩個 settled producer；Extension full 144/144、A2／B／C targeted 綠。PI full 因第一次 `needs_discovery` transport 缺口仍紅，修正後重跑 fallback targeted、PI full、Extension full、type/check、whole suite。

### 相關文件與第一步

相關文件：[`CONTEXT.md`](../CONTEXT.md)、[`docs/PLAN-A.md`](PLAN-A.md)、[`docs/adr/ADR-0022-forge-stage-ui-only-settled-decision-replay.md`](adr/ADR-0022-forge-stage-ui-only-settled-decision-replay.md)、[`docs/tickets/deep-decision-replay-ui-only-stage-20260830.md`](tickets/deep-decision-replay-ui-only-stage-20260830.md)、[`agent-state/deep-decision-replay-ui-only-stage-20260830.md`](../agent-state/deep-decision-replay-ui-only-stage-20260830.md)。下一步先完成有效 A2／B RED，再實作兩個 settled producer；typecheck 需確認本地 `setStatus` 型別。不得改 Grill WAIT_USER、needs_discovery、READY、validator、evidence、state machine 或 `pi-main`。
## 2026-08-30 Intent 到 Context 流程圖同步

## 2026-08-30 Decision replay Discovery transport 覆核

先前記載的 Discovery direct follow-up 方向已被真 PI test-only spy 否證：`sendUserMessage(..., { deliverAs: "followUp" })` 確實被呼叫，但沒有 `queue_update`，provider `callCount=4`、`pendingResponses=4`；whole-file targeted 13 pass/1 fail、blocked=0。進一步的 test-only Promise trace 已確認根因：`agent_end → agent_settled → sendUserMessage` 的 Promise 已 resolve，但 `pi.on("input")` 在沒有 marker且 stage=`GRILL` 時回 `handled`（已有 workflow），因此 invocation 被吃掉；只有精確等於 `pendingReplayInvocation` 時才回 `continue`。下一步是保留既有 `pendingDiscoveryRestart` 與所有 settled guards，Discovery timer 在呼叫 `sendUserMessage` 前先設定 `pendingReplayInvocation = pendingDiscovery.invocation`；後續沿用既有 `message_start` full exact match 清除與 tool_call fail-closed gate，sendUserMessage 失敗時保留 marker。Deep 邏輯不改，其他輸入仍按原契約；文件與實作狀態維持 `implementation-in-progress`。

唯一視覺交付 `forge-intent-context-flow.html` 已依 current runtime 更新，九列 baseline 不變。同步內容包含 RECEIVE shortcut／`missingAssets`／fail-closed、WAIT_USER `displayOnly`／`transcript`、Deep stale identity 與 `needs_decision`／`needs_discovery` 回流、Evidence `human_premise` 與 Finding-only `推論：`，以及 CONTEXT_BUILD production wiring 的 partial 標示。無 runtime 或架構決策變更，不新增 ADR；`forge-runtime-flow.html`、`pi-main` 均未修改，且 `forge-runtime-flow.html` 本輪開始前已 dirty。

靜態 parser、純 HTML/CSS、semantic classes、九 state 通過；獨立內容 review P0=0、P1=0。沒有可用 browser instance，1280×900／390×844、console、overflow 與截斷實測未完成。未解風險為 CONTEXT_BUILD 尚未接上 production、空 Evidence Package 仍可能通過 validator，以及匿名 mixed-batch 細節未完全證實。
## 本輪交接完成（2026-08-30）

本 ticket 已完成。`publishState` 現在只更新 `ui.setStatus("forge-runtime", text)`；Deep decision answer、Retrieval completed，以及第一次 `needs_discovery` restart 都在 `agent_settled` 後以既有 replay 邊界送出正常 user message。Discovery restart 另保留獨立 settled marker，settled 時會重新驗證 workflow、GRILL、round、tool 與 `sendUserMessage`。`message_start` full exact 清除及 `tool_call` fail-closed gate 保持不變。

驗證：fallback 1/1；PI full 14/14（約 10.69 秒，無 blocked/pending/dispose async）；Extension 144/144（約 3.04 秒）；npm test 252/252（約 30.2 秒）；final review 無阻擋 finding。整體 `npm run check` 仍受既有 pi-main `syntax-highlight.ts` 的 highlight.js TS7016 共 21 筆阻擋，本 ticket 未修改上游。

未解風險僅有：PI interactive typecheck 的既有上游阻塞，以及尚未做 `sendUserMessage` 故障注入；兩者皆非本 ticket 必要條件。下一步可選修復上游依賴型別，不屬本 ticket 範圍。

## KNOWLEDGE_UNDERSTANDING→CONTEXT_BUILD 交付契約交接（2026-08-30）

Ticket `knowledge-understanding-context-build-deliverable-20260830` 已完成實作與驗證；狀態為 `implemented-verified-reviewed`。新 session 讀取 [`CONTEXT.md`](../CONTEXT.md)、[`docs/PLAN-A.md`](PLAN-A.md)、[`ADR-0023`](adr/ADR-0023-knowledge-understanding-context-build-deliverable.md)、ticket、agent-state 與 Memory 可接續後續工作。

`KNOWLEDGE_UNDERSTANDING` 完成時，必須原子化交付單一 Forge-owned immutable package 給 Context Build，包含 `decisions`、`findings`、`limitations`、trim 後非空且最多 4000 Unicode code points 的 `knowledgeSummary`，以及 runtime 從 validated evidence records 衍生的唯讀 `evidenceIds`。structured fields 是權威，summary 不得新增事實；blocking limitation 與引用驗證維持 fail-closed。

Package 必須在 stage transition 前建立、驗證、保存；失敗停留原 phase，不部分保存。Session state 只有一個 Forge-owned getter；Context Build 不讀 tool-result details、UI prose 或 transport marker。new workflow/reset/switch/cancel/full cleanup 必須清除舊 package。

最小 production scope：`forge-runtime/src/evidence/evidence-engine.ts`、`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/src/knowledge/context-builder.ts`。測試候選：`evidence-engine.test.ts`、`discovery-evidence.test.ts`、`forge-runtime-extension.test.ts`；cleanup 測試位置待 CodeGraph 窄查。不得修改 `pi-main/`、新增依賴或建立重複 DTO。自動啟動／排程 Context Build provider 是獨立 continuation gap，若要納入須另案設計。

## 2026-08-31 knowledgeSummary 非權威邊界設計交接

Ticket `knowledge-summary-authority-boundary-20260831` 已由使用者確認 Plan A，狀態為 `design-confirmed-not-implemented`。摘要與結構欄位矛盾時仍接受 EvidencePackage；`decisions`、`findings`、`limitations` 是正式事實，`knowledgeSummary` 僅供閱讀。Context Builder 正式輸出不得受摘要影響。

新 session 必須先讀本 handoff、`CONTEXT.md`、[`ADR-0024`](adr/ADR-0024-knowledge-summary-authority-boundary.md)、ticket、agent-state 與 Memory，向使用者展示 context 摘要並等待確認；確認後才使用 `execute-designed-plan` 開始實作。第一步由測試建立 schema description RED，再做最小 production 修正；本案不接自動續跑 Context Build。
## KNOWLEDGE_UNDERSTANDING→CONTEXT_BUILD 交付契約完成（2026-08-30）

Ticket `knowledge-understanding-context-build-deliverable-20260830` 已完成，狀態為 `implemented-verified-reviewed`。`KNOWLEDGE_UNDERSTANDING` 會交付單一 Forge-owned immutable EvidencePackage，包含 `decisions`、`findings`、`limitations`、`knowledgeSummary` 與 runtime-derived `evidenceIds`；summary trim 後非空且最多 4000 Unicode code points，巢狀 metadata 也會深層複製／凍結。

Session 在進入 `CONTEXT_BUILD` 前完成 validate/save，transition 失敗會 rollback；getter 與 reset／cancel／new snapshot cleanup 已完成。Context Builder 保留同一 package identity。驗證為 session 27/27、evidence 18/18、全套 265/265、project tsc exit 0；Standards／Spec review PASS。`npm run check` exit 1 僅因未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 缺少 `highlight.js` declaration（TS7016）。

本 ticket 沒有接自動續跑或排程 Context Build；這是明確的後續 continuation scope，不能從本 handoff 推論為已完成。未修改 `pi-main`，其他既有流程維持不變。

## 2026-08-31 knowledgeSummary 非權威邊界完成

Ticket `knowledge-summary-authority-boundary-20260831` 已完成實作與驗證。schema description 與 `EvidencePackage` JSDoc 明定 `knowledgeSummary` 僅供人類閱讀、非權威、不得新增主張或控制流程；`decisions`、`findings`、`limitations` 與 runtime-derived `evidenceIds` 維持正式來源。

Context Builder regression 以否定正式 decision 與虛構 `authorityLevel` 的矛盾摘要證明正式 items 不受影響且摘要保留。TDD RED 145/1 後 GREEN 146/0；單檔 Context 測試 4/0；完整 `npm test` 266/266；Standards 與 Spec review PASS。

`npm run check` 唯一既有阻塞為未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21` 的 `highlight.js` TS7016（21 個），與本輪無關；本輪未修改 `pi-main`。自動排程 Context Build 與空 Evidence Package validation 仍 out of scope。下一步不需再實作本 ticket。

## 2026-08-31 Grill 軟上限與人類 checkpoint 交接

最終規則：選 `converge` 後 0 題直接進 Deep；有真正知識盲點最多 1 題，回答後直接進 Deep，不回 checkpoint、不再 Grill。兩個 convergence 入口都跳過 relevance；普通 empty-candidate 仍 `WAIT_USER`。bare cancel 與既有 cancel 共用完整 cleanup。canonical skill 為 `forge-runtime/skills/grilling/SKILL.md`，`.pi` 不再是來源。

### 最終收尾（2026-09-01）

另補上 blank answer no-op、舊 round replay no-op 與 cross-round duplicate fail-closed。驗證為完整 281/281、精準 convergence/cancel/relevance 5/5、session 33/33、cancel 8/8、`quick_validate` 成功、pack dry-run 260 files、isolated tarball install/path resolution 成功、diff check 0。`npm run check` 僅剩未修改 `pi-main` `highlight.js` TS7016 baseline；package 約 213 個 `.log` 的既有債務未擴大處理，semantic true-gap 仍由 prompt/skill 契約而非 runtime NLP classifier 約束。

使用者已確認 [`ADR-0025`](adr/ADR-0025-grill-soft-cap-human-checkpoint.md) 與 direct [`PLAN-A`](PLAN-A.md)。Ticket 為 [`grill-soft-cap-human-checkpoint-20260831`](tickets/grill-soft-cap-human-checkpoint-20260831.md)，狀態 `implementation-complete-verified`；durable state 見 [`agent-state`](../agent-state/grill-soft-cap-human-checkpoint-20260831.md)。

每條 chain 只計成功接受的人類回答，8 輪後先保存答案再以既有 WAIT_USER 發布 `grill_checkpoint`；固定 `continue_one`、`converge`、`cancel`，late/stale/duplicate fail-closed。選 `converge` 後只啟動一次 convergence invocation：無真正知識盲點時模型提交 `READY_FOR_DEEP`，runtime 沿 `continueDeepKnowledge` 進入 `DEEP_KNOWLEDGE_RETRIEVAL`；有真正知識盲點時最多問一題，保存回答後直接進 Deep，不回 checkpoint、不再 Grill、不問第二題，也不偽造 READY。真正知識盲點是 Deep Retrieval 所缺客觀知識／證據，不含可採用預設的 implementation detail。`cancel` 重用非 Deep cancel cleanup，回到 `RECEIVE`；只允許 material decision boundary 的 NEEDS_CONFIRMATION，非阻塞細節 READY_FOR_DEEP。只沿用既有 WAIT_USER，沒有 UI gap，故無 Plan B。

本 ticket 已完成 final review，可交付。測試驗收為無盲點 READY→Deep，以及一個盲點問一題後直接 Deep；並已完成其餘 checkpoint、full suite 與 skill 驗證。未解風險為 check 僅保留 pi-main highlight.js TS7016 baseline、package 約 213 個 `.log` 的既有債務，以及 true knowledge gap 仍由 prompt/skill 契約約束；禁止修改 pi-main。

## Deep Discovery fallback 選項與 full reset 設計交接（2026-09-02）

本 ticket 已完成實作、主要驗證與 review，狀態為 `implementation-complete-verified`。`deep_discovery_fallback` 可見選項為「確認／取消」，共用 UI 另有「自行輸入…」；舊「同意」不列為 UI 選項，但保留 trim 後精確隱藏相容輸入，等同確認。

「取消」及自行輸入 trim 後精確「取消」都清除本輪所有輸入與證據並回初始 `RECEIVE`，重用 `sessionState.reset()`（`forge-runtime/src/runtime/session-state.ts:720-741`）與既有 extension 外層清理；不可沿用 `cancelDeepKnowledge()`。一般 `deep_decision` 取消仍保留原契約。

實際 production 為 `forge-runtime/src/runtime/session-state.ts`、`forge-runtime/extensions/forge-runtime.ts`；tests 為 `forge-runtime/tests/runtime/session-state.test.ts`（33/33）、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`（153/153）、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`（14/14）。完整 `npm test` 282/282，log 為 `.tmp-deep-fallback-full-test-rerun.log`；review 無阻擋 finding，`git diff -- pi-main` 無輸出。取消會清除輸入、證據、markers 與 active workflow 並回 `RECEIVE`；沒有待實作 slice。

`npm run check` 與第二段獨立 tsc 均 exit 2，唯一 blocker 是未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 缺 `highlight.js` 語言模組型別 TS7016。isolated verification 已完成：以 HEAD `fdccbd62403e40ba3400761bc0468668820a8059` 建 detached worktree，僅套用本 ticket 五個 code/test 檔 patch，未 install、未改 `pi-main`，`npm test` exit 0，282/282、0 fail/skip；worktree、junction 與 patch 已安全清理。下次先讀本 handoff 與上述摘要；若要處理 check blocker，必須另獲使用者明確授權修改 `pi-main`。

## 2026-09-02 Spec Gap 探索性開發交接

本張 Plan A 已獲使用者核准，且使用者要求完成文件後立即進入實作。正式 spec 難以取得時，探索性新產品開發仍可繼續；系統建立可追溯 `Spec Gap` 與 `exploratory`／`black_box_verified`／`spec_verified` 三層驗證，限制未證實的相容性主張與高風險真實操作。

必讀：[`docs/PLAN-A.md`](PLAN-A.md)、[`CONTEXT.md`](../CONTEXT.md)、[`ADR-0026`](adr/ADR-0026-spec-gap-exploratory-development.md)、[`ticket`](tickets/spec-gap-exploratory-development-20260902.md)、[`agent-state`](../agent-state/spec-gap-exploratory-development-20260902.md)，以及 ADR-0021、ADR-0023、ADR-0024。

（歷史交接，已由下方最終交接取代）下一步曾是 S1 RED；目前 S1–S4e 已完成。不可修改 `pi-main`，也不可把資料／prompt 契約宣稱成 execution guard。

（歷史設計交接）本輪當時只完成文件；後續 S1–S4e 已完成，現況以本文件下方最終交接為準。Forge 尚無可驗證 capability／execution guard；高風險操作的可靠封鎖仍是後續 gap。

## 2026-09-02 Spec Gap 最終交接

本 ticket 與 Plan A 已完成（S1–S4e）。缺 formal spec 時，完整 non-blocking Spec Gap 可繼續 exploratory 開發；black-box 可在完整 binding 下形成指定環境實測，但不得宣稱正式 spec 相容。

驗證：evidence 28/28；`forge-runtime npm test` 292/292，0 fail／skip／cancelled／todo，約 30.15 秒；`npm run check` 無本 ticket 診斷，僅有未修改上游 `pi-main` 的 21 個 TS7016；CodeGraph review 無阻擋 finding；`git diff --check` 無 whitespace error。

注意：current runtime 沒有 trusted formal-spec importer、不可偽造 capability 或來源綁定，因此 `spec_verified` 即使 reference 格式正確仍固定 fail-closed。若要啟用正式驗證，先建立獨立 importer ticket；generic execution guard 也需另案處理。不要把既有綠燈寫成正式 spec 驗證已可用。

## 2026-09-02 Spec Gap S1–S3 與 S4 remediation 交接

（歷史執行交接）S1–S3 已實作並通過最小測試；後續 S4a–S4e 已完成，現況以「Spec Gap 最終交接」為準。

S4 已加入 Plan A 與 ADR-0026：`formalSpecReference` 只是主張；`spec_verified` 必須對照 runtime 另傳的受信任 formal-spec validation context（`evidenceId`、`target`、`version`、`locator`），缺 context 或指向非正式 evidence 一律 validation error；`scenarios` 必須深度 immutable；malformed 新增欄位必須 fail-closed 回傳 validation error。generic execution guard 仍是未解 gap，不得假稱已實作。

（歷史下一步，已完成）獨立測試、最小 production 修正、完整驗證與 code review 均已完成；不可將 formal spec importer 或 generic execution guard 誤寫成已完成。

## 2026-09-02 二次 review 與 S4c 交接補充

目前 runtime 沒有 trusted formal-spec importer／context provider，因此 live `spec_verified` 故意 fail-closed；`exploratory`／`black_box_verified` 不受影響。正式 source importer 是後續獨立 ticket，不可宣稱正式升級已可用。

S4c 已完成：Spec Gap 的可選 `scenarios` 只要存在，任何 verification level 都必須是字串陣列，否則 validation error 且不得 throw；`black_box_verified` 仍要求非空。test context fixture 型別錯誤已修正，typecheck 已完成。

Plan A 已完成；S4c RED→GREEN、完整驗證與二次獨立 code/document review 均已完成。generic execution guard 仍是後續 gap。
