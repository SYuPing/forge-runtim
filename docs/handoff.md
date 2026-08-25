---
title: Deep Knowledge 檢索、理解與證據包交接
type: handoff
scope: intent-route-only-llm-20260821、light-discovery-file-metadata-20260822、grill-deep-boundary-risk-20260823、deep-knowledge-retrieval-understanding-20260824
updated: 2026-08-25
source: ADR-0013、ADR-0014、CONTEXT.md、docs/PLAN-A.md、docs/adr/ADR-0015-grill-deep-knowledge-handoff-boundary.md、docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md、scoped validation logs
status: follow-up-fix-in-progress
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
- 驗證：`npm test` 208/208；`npm run check` exit 0；`git diff --check` exit 0（僅 LF／CRLF warning）。Standards 唯一 hard finding 是 README tool 清單過時，已修正；Divergent Change／Repeated Switches 是固定三來源與 Ponytail/YAGNI 下的 judgement call；Spec 無 production 缺口；adversarial 最終無 P0/P1。
- 下一步只剩使用者檢閱並決定是否 commit；目前未 commit、未 staged。

### 首次 Grill→Deep identity handoff 修正交接（2026-08-25）

已確認首次 READY→Deep 建立 active identity 後，必須沿用 decision-retry 的 `pi.sendUserMessage(..., { deliverAs: "followUp" })`，將 `attemptId`、`sourceRoundId`、`phase` 傳入下一模型回合；本 follow-up 尚未實作或測試。

- identity 不放入 tool details；Deep tools 不自行取得 identity；不改 stale guard、不改 `pi-main/`、不加 sequential 設定。
- public seam 是現有 `registeredTools`／harness。先由測試代理新增 failing integration test，再最小修改 `forge-runtime/extensions/forge-runtime.ts`，最後執行 focused 與相關 suite。
- 最脆弱假設：followUp 在目前 tool round 結束後觸發下一模型回合；現有 PI API 已如此定義。沒有 UI 工作，不建立 Plan B。

（歷史快照）先建立紅燈、完成最小 production diff，再執行完整驗證與雙軸 review；上述工作已在下方收尾完成。
