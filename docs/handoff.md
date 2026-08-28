---
title: Deep Knowledge 檢索、理解與證據包交接
type: handoff
scope: intent-route-only-llm-20260821、light-discovery-file-metadata-20260822、grill-deep-boundary-risk-20260823、deep-knowledge-retrieval-understanding-20260824、deep-stale-result-loop-20260826、deep-target-source-contract-20260827、deep-completion-stale-termination-20260828
updated: 2026-08-28
source: ADR-0013、ADR-0014、CONTEXT.md、docs/PLAN-A.md、docs/adr/ADR-0015-grill-deep-knowledge-handoff-boundary.md、docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md、docs/adr/ADR-0017-deep-target-source-contract.md、scoped validation logs
status: implemented-verified-reviewed
---

# Intent route-only LLM 交接

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
