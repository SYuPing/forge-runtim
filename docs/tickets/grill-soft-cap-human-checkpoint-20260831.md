---
title: Grill 軟上限與人類 checkpoint
type: ticket
scope: forge-runtime Grill chain
updated: 2026-09-01
source: ADR-0025、使用者提供 session HTML
status: implementation-complete-verified
---

# Ticket：Grill 軟上限與人類 checkpoint

## Scope

以成功接受的人類 `grill_confirmation` 回答計算每條 chain 的 8 輪自動額度；達上限後沿用 WAIT_USER 的 `grill_checkpoint`，提供 `continue_one`、`converge`、`cancel` 三個選項，並對 stale／duplicate fail-closed。選擇 `converge` 後只啟動一次 convergence invocation：無真正知識盲點 0 題直接進 `DEEP_KNOWLEDGE_RETRIEVAL`；若有真正知識盲點，最多問 1 題，保存回答後直接進 Deep，不回 checkpoint、不再 Grill、不問第二題，也不偽造 READY。明確 convergence 兩入口跳過 relevance，但普通 empty-candidate 仍 `WAIT_USER`。真正知識盲點是完成 Deep Retrieval 所缺的客觀知識或證據，不含可採用預設的 implementation detail。`cancel` 重用非 Deep cancel cleanup：清除 pending／timer／fallback、恢復原 tools、設 `activeWorkflow=undefined`、執行 `sessionState.reset()`，最後 UI 回到 `RECEIVE` 且 `waitUser=undefined`；同步收緊 Grill skill 的 material decision boundary。

Plan A 精確 production／skill scope：

- `forge-runtime/skills/grilling/SKILL.md`
- `forge-runtime/src/ui/ui-state.ts`
- `forge-runtime/src/runtime/session-state.ts`
- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/tests/runtime/session-state.test.ts`
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `forge-runtime/tests/grill/grill-skill.test.ts`

另會更新本 ticket 的 ADR、Plan、handoff、CONTEXT、agent-state 與 Memory；這些是 repo-required status tracking，不是 runtime scope。

## Acceptance

Session-state 新增 4 測試，baseline 27、預期 31；extension 新增 4，baseline 146、預期 150；skill 新增 2，baseline 6、預期 8；full baseline 266，預期 276 passed / 0 failed。測試名稱固定於 `docs/PLAN-A.md`。

固定測試名稱：`GrillRoundBudget_WhenAcceptedAnswersAreBelowEight_ShouldAllowNextRound`、`GrillRoundBudget_WhenAcceptedAnswersReachEight_ShouldRequireCheckpoint`、`GrillRoundBudget_WhenCompletionIsRejectedOrRetried_ShouldNotConsumeBudget`、`GrillCheckpoint_WhenAnswerIsStaleOrDuplicated_ShouldRemainWaiting`、`GrillCheckpoint_WhenLimitIsReached_ShouldNotQueueFollowUp`、`GrillCheckpoint_WhenContinueOneIsSelected_ShouldQueueExactlyOneNormalRound`、`GrillCheckpoint_WhenConvergeIsSelected_ShouldQueueExactlyOneConvergenceRound`、`GrillCheckpoint_WhenConvergeWithoutKnowledgeGap_ShouldEnterDeep`、`GrillCheckpoint_WhenConvergeWithOneKnowledgeGap_ShouldAskOnceThenEnterDeep`、`GrillCheckpoint_WhenCancelIsSelected_ShouldResetToReceiveAndRestoreTools`、`GrillSkill_WhenInvocationBuilt_ShouldLimitConfirmationToMaterialDecisionBoundaries`、`GrillSkill_WhenInvocationBuilt_ShouldRouteNonBlockingDetailsToReadyForDeep`。

## Not building

不新增 workflow state、獨立 UI/View、Plan B、`pi-main` 修改、env/config、依賴、第二份 skill prompt、第二次 convergence invocation、第二題或 runtime 偽造 READY；既有 `continueDeepKnowledge` 的正式 Deep handoff 屬本次明確核准行為。

## Evidence

使用者提供的 session HTML 顯示 50 rounds 全為 `NEEDS_CONFIRMATION`、48 個 unique questions；`forge-runtime/extensions/forge-runtime.ts:391-437` 顯示回答後自動再開 round，`forge-runtime/src/runtime/session-state.ts:744-764` 顯示 round ID 無上限。根因已由 runtime 與 source 證據驗證，並已完成修正；完整結果見下方 Completion。

## Completion（2026-09-01）

已完成 Plan A。第 8 個有效回答後進 `grill_checkpoint`；`continue_one` 恰一正常 round；`converge` 無盲點 READY→Deep，有盲點最多一題後直接 `DEEP_KNOWLEDGE_RETRIEVAL`；`cancel` 回 `RECEIVE` 並恢復工具。實作包含 `grill_checkpoint` UI state、回答計數／重設／`beginGrill` transition、`pendingConvergenceRoundId`／convergence prompt／final-answer guard，以及 grilling skill frontmatter／文案。

驗證：完整 281/281；精準 convergence/cancel/relevance 5/5；session 33/33；cancel 8/8；`quick_validate` 成功；pack dry-run 260 files；isolated tarball install/path resolution 成功；`git diff --check` exit 0。`npm run check` 僅剩未修改 `pi-main` 的 `highlight.js` TS7016 baseline。package 仍含約 213 個 `.log`；true knowledge gap 由 prompt/skill 契約約束，未加入 runtime NLP classifier。canonical skill 是 `forge-runtime/skills/grilling/SKILL.md`，`.pi` 不再是來源。
