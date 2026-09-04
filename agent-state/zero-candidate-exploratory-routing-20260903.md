---
title: zero-candidate-exploratory-routing-20260903 agent state
type: agent-state
scope: Light Discovery 零候選探索性路由
updated: 2026-09-05
source: docs/adr/ADR-0029-zero-candidate-exploratory-routing.md、docs/tickets/zero-candidate-exploratory-routing-20260903.md、docs/PLAN-A.md
status: implemented-verified-completed
---

# zero-candidate-exploratory-routing-20260903

## 已完成項目

- 使用者已核准零候選探索性路由設計。
- 已完成 ADR、ticket、Plan A、CONTEXT、handoff 與 Memory 的設計同步。
- 已完成 production／test 實作與回歸驗證。

## 重要決策

- `matches=[]` 不呼叫不存在 candidate 的 evidence tool。
- 只有明確人類確認才沿用既有 `human_premise` 進 exploratory，並建立 non-blocking `Spec Gap`。
- 最高架構已明文化此窄例外；一般 `NEEDS_CONFIRMATION` 仍須下一輪 Grill，有候選流程不變。
- 拒絕、空白或模糊回答維持 `WAIT_USER`；有候選流程完全不變。
- 不放寬 Evidence validator、不新增頂層 state／command／service；`TO_SPEC` 另案並保留 ADR-0028 人工確認。
- 空快照 opt-in 直接重用既有 Deep；三項 metadata 全省略時自動補 exploratory 與 deterministic non-blocking Spec Gap；不完整組合 fail-closed。

## 修改檔案

文件修改：本檔及 `CONTEXT.md`、ADR、ticket、Plan A、handoff、兩份 Memory；衍生視圖同步：`forge-intent-context-flow.html`（非 runtime 行為來源）；production：`forge-runtime/extensions/forge-runtime.ts`；tests：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。

## 測試結果

新增五個 extension tests：`Extension_WhenDeepCompleteProvidesOnlyFormalSpecReference_ShouldRejectBeforeContextBuild`、`Extension_WhenDeepCompleteProvidesExploratorySpecGap_ShouldPropagateToEvidencePackage`、`Extension_WhenEmptySnapshotConsentAndDeepCompleteOmitMetadata_ShouldAddExploratorySpecGap`、`Extension_WhenEmptyDiscoveryHasHumanConfirmation_ShouldEnterDeepWithoutSecondGrillRound`、`Extension_WhenEmptyDiscoveryAnswerIsNotExplicitApproval_ShouldRemainWaiting`。`DeepCompletion_WhenOnlyGrillHumanPremiseExists_ShouldEnterContextBuild` 為修改既有測試；三個 TUI 測試恢復既有契約。
`npm test` 329 passed、0 failed、0 skipped、duration_ms 30778.2386，僅有既有 DEP0190 warning；TDD RED／GREEN 證據維持不變。`npm run check` exit 2，21 筆 TS7016 全在未修改上游，三個 Forge 檔 0 error（`.tmp/full-test-final10-0905.log`、`.tmp/check-final9-0905.log`）。HTML release validation 亦通過 `.tmp/intent-flow-release-validation-20260904.log`。

## 未解問題

- 整體 check 仍受未修改 `pi-main` 的 21 筆 TS7016 影響；不在本 ticket 修復。
- TO_SPEC executor 尚未實作，依範圍保留。
- 歷史 targeted 282 為未執行預估，已由正式 329 全量測試取代；未 commit／push。

## 下一步

本 ticket 已完成；後續若進入 TO_SPEC，須另取得使用者明確確認並建立新 ticket。
