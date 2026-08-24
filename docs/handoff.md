---
title: Intent route-only LLM ticket handoff
type: handoff
scope: intent-route-only-llm-20260821、light-discovery-file-metadata-20260822、grill-deep-boundary-risk-20260823
updated: 2026-08-24
source: ADR-0013、ADR-0014、CONTEXT.md、docs/PLAN-A.md、scoped validation logs
status: completed
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
