---
title: 零候選探索性路由
type: ticket
scope: Light Discovery 零候選時的確認、human premise 與 Spec Gap 傳遞
updated: 2026-09-05
source: ADR-0029、使用者核准、docs/PLAN-A.md
status: implemented-verified-completed
---

# Ticket：zero-candidate-exploratory-routing-20260903

## Goal

Light Discovery 沒有任何候選時，不送出不存在的 evidence candidate；經明確人類確認後沿用既有 human premise 進 exploratory，並保留 non-blocking Spec Gap，同時不影響已完成的有候選流程。

## Building

- 空 `matches` 的確認分流與既有 `pendingKnowledgeRequest`。
- `resumeGrillWithAnswer` 保留已確認 premise，呼叫既有 `continueDeepKnowledge(..., true)`。
- `forge_deep_complete` 到 `createEvidencePackage` 的既有 `verificationLevel`／`specGap`／`formalSpecReference` 傳遞。
- `Extension_WhenEmptyDiscoveryHasHumanConfirmation_ShouldEnterDeepWithoutSecondGrillRound`。
- `Extension_WhenEmptyDiscoveryAnswerIsNotExplicitApproval_ShouldRemainWaiting`。
- `Extension_WhenDeepCompleteProvidesExploratorySpecGap_ShouldPropagateToEvidencePackage`。
- `Extension_WhenDeepCompleteProvidesOnlyFormalSpecReference_ShouldRejectBeforeContextBuild`。
- `Extension_WhenEmptySnapshotConsentAndDeepCompleteOmitMetadata_ShouldAddExploratorySpecGap`。
- `DeepCompletion_WhenOnlyGrillHumanPremiseExists_ShouldEnterContextBuild`（修改既有測試）。
- 三個原 TUI 測試以非空 fixture 恢復既有 grill-2／retry 契約，不是新增空知識 feature test。

## Not Building

不改有候選 Light→Grill→Deep、不放寬 Evidence validator、不新增頂層 state／command／service、不改 `session-state`／`evidence-engine`／`context-build-skill`、不做 UI、TO_SPEC／TO_TICKET、trusted importer、generic execution guard 或 `pi-main`。

## Success criteria

- 空 `matches` 不呼叫不存在 candidate 的 evidence tool。
- 明確確認可進既有 Deep exploratory 路徑，且不產生第二輪 Grill。
- `Spec Gap` 為 non-blocking 且可在 Evidence Package 中追溯；`human_premise` 不升為 `spec_verified`。
- 拒絕、空白或模糊回答仍為 `WAIT_USER`。
- 既有 baseline 不回歸；Plan A targeted 預期 282 是核准時的歷史計畫，本輪未另宣稱 targeted 已執行；正式 full 為 329/329 並取代該歷史預期。

## Execution order

1. （歷史核准計畫）從 `forge-runtime` 目錄執行 RED 1：`.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 --test-name-pattern="Extension_WhenEmptyDiscoveryHasHumanConfirmation_ShouldEnterDeepWithoutSecondGrillRound" tests/extensions/forge-runtime-extension.test.ts`；必須先失敗。
2. （歷史核准計畫）從 `forge-runtime` 目錄執行 RED 2：`.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 --test-name-pattern="Extension_WhenDeepCompleteProvidesExploratorySpecGap_ShouldPropagateToEvidencePackage" tests/extensions/forge-runtime-extension.test.ts`；必須先失敗。
3. 兩個 RED 均確認後，只修改 `forge-runtime/extensions/forge-runtime.ts` 的最小 seam。
4. 從 `forge-runtime` 目錄執行相關完整批次：`.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/discovery/light-discovery.test.ts tests/evidence/evidence-engine.test.ts tests/runtime/session-state.test.ts tests/extensions/forge-runtime-extension.test.ts tests/extensions/pi-grill-interactive.test.ts tests/grill/grill-result.test.ts tests/knowledge/discovery-evidence.test.ts`；歷史計畫預期 282 passed，本輪未另宣稱已執行。
5. 從 `forge-runtime` 目錄執行 `npm test`；期望 0 failed。
6. 從 `forge-runtime` 目錄執行 `npm run check`；只允許既知未修改 `pi-main` 的 highlight.js TS7016，不得有新增 Forge Runtime error，也不得修改 `pi-main`。
7. 完成後更新本 ticket、state、handoff、CONTEXT、PLAN-A 與 Memory；不得把未執行驗證寫成完成。

## Files

- Production：`forge-runtime/extensions/forge-runtime.ts`；衍生視圖同步：`forge-intent-context-flow.html`（非 runtime 行為來源）。
- Tests：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`；後者以非空 fixture 恢復三個既有 TUI grill-2／retry 契約，不是新增空知識 feature test。
- Baseline log：`.tmp/baseline-zero-candidate-20260903.log`。

## Current state

歷史設計狀態為 `design-confirmed-not-implemented`；實作與驗證結果見下方收尾紀錄。

## Completion（2026-09-04）

本輪現行執行紀錄：五個新增 extension tests 為明確同意進 Deep、拒絕仍等待、顯式 Spec Gap 傳遞、自動補 exploratory／Spec Gap、孤立 `formalSpecReference` 拒絕；實際 RED 為自動補 exploratory／Spec Gap 與孤立 `formalSpecReference` guard。最終以正式 full 329/329 為準，supersede 歷史 targeted 282 預期。

- 已完成空 `matches` 明確 opt-in、拒絕／模糊 WAIT_USER、既有 human premise 直進 Deep，以及 Deep metadata wiring。
- 空快照、無外部 evidence、有人類前提且 metadata 全省略時自動補 exploratory 與 deterministic non-blocking Spec Gap；不完整 metadata 組合在 extension boundary fail-closed。
- 有候選流程維持 light／grill-2；未修改 `pi-main`、Evidence validator、state machine、TO_SPEC。
- （歷史證據，已由 final10/check9 取代）UI 固定選項為「同意／不同意」；runtime 沿用 `isApproval`，trim 後接受「好、可以、同意、照做、yes、ok、okay、y」（英文先 lowercase），含「確認」的其他字串不屬於此 opt-in；拒絕／模糊維持 `WAIT_USER`。正式 `npm test` 以 `.tmp/full-test-final8-0904.log` 為準：329 passed、0 failed、0 skipped、34635.325 ms；`npm run check` 以 `.tmp/check-final7-0904.log` 為準：exit 2，21 筆 TS7016 全在未修改上游 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21`，本輪三個 Forge 檔 0 error。
- `forge-intent-context-flow.html` 已同步 ADR-0029；release validation `.tmp/intent-flow-release-validation-20260904.log` 通過 CDP、靜態與視覺檢查，mobile／desktop overflow 均為 0。`forge-runtime-flow.html` 未修改。
- `FORGE_RUNTIME_Arch_v4.md` 已明文化本案窄例外；一般 `NEEDS_CONFIRMATION` 仍須下一輪 Grill，有候選流程不變。

## Risks

`human_premise` 只能表達使用者意圖；外部 API、協定、安全與相容性仍由 Spec Gap 限定。`npm run check` 的既有 `pi-main` highlight.js TS7016 不屬本 ticket，且不得修改上游。

## 2026-09-05 封版補充（目前 evidence）

- 最高架構已明文化窄例外：只有空 `matches`、固定探索 opt-in marker 與既有 `isApproval` 明確肯定可由 `WAIT_USER` 直進既有 Deep；一般 `NEEDS_CONFIRMATION` 仍須下一輪 Grill，有候選流程不變。
- `npm test`：`.tmp/full-test-final10-0905.log`，329 passed／0 failed／0 skipped，duration_ms 30778.2386。
- `npm run check`：`.tmp/check-final9-0905.log`，exit 2；21 個 TS7016 僅在未修改上游 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21`，Forge 三檔 0 error。TO_SPEC 無 executor；未 commit／push。
