---
title: Grill 軟上限與人類 checkpoint
type: adr
scope: Grill active chain 的自動續問與 WAIT_USER 交接
updated: 2026-09-01
source: 使用者核准、實際 session HTML、forge-runtime source
status: accepted-implemented-verified
---

# ADR-0025：Grill 軟上限與人類 checkpoint

## Context

實際 session 曾連續 50 個 Grill rounds 全部 `NEEDS_CONFIRMATION`，其中 48 個問題不同；`resumeGrillWithAnswer()` 會在回答後再啟動下一 round，round ID 只有遞增而沒有 chain 收斂條件。證據：使用者提供的 session HTML、`forge-runtime/extensions/forge-runtime.ts:391-437`、`forge-runtime/src/runtime/session-state.ts:744-764`。

## Decision

- 每條 active chain 以成功接受的人類 `grill_confirmation` 回答計數，內部常數為 `MAX_AUTOMATIC_GRILL_ROUNDS = 8`。retry、schema/evidence/round mismatch、stale/duplicate event 與 checkpoint 選擇不計數；新 chain、READY、cancel/reset 清零。
- 第 8 個有效回答先持久化，之後 `resumeGrillWithAnswer()` 不再啟動 round 或自動 follow-up，改在既有 `WAIT_USER` 發布 `kind: "grill_checkpoint"`；這不是新 workflow state。
- checkpoint 固定 option IDs：`continue_one`、`converge`、`cancel`。前者只放行一個 normal round，完成後再次 checkpoint，不重設額度；後者只放行一個明確收斂 round，無 material ambiguity 必須 READY_FOR_DEEP，有則最多一個阻塞問題，不能由 runtime 偽造 READY；cancel 精確重用既有非 Deep cancel，清理 pending/timer/fallback、恢復 tools、清除 workflow/session，回到 RECEIVE。
- late/stale/duplicate checkpoint 或 round answer 一律 fail-closed，不釋放新 round。
- `NEEDS_CONFIRMATION` 只保留會改變 scope、public API、state transition、security、fail-closed 或 human decision 的問題；非阻塞 implementation detail 直接 READY_FOR_DEEP。文字真相在 package 內的 `forge-runtime/skills/grilling/SKILL.md`，`grill-skill.test.ts` 驗證 build 後 prompt。

## Consequences

軟上限阻止無限自動續問，但不替使用者決定是否收斂，也不丟棄第 8 題回答。沿用既有 WAIT_USER 呈現，因此沒有獨立 View/UI gap，不建立 Plan B。不得修改 `pi-main/`、新增 state、依賴、env/config，或用 `terminate: true` 假裝 chain 完成；converge 的正式 Deep handoff 依 2026-09-01 amendment 執行。

## Verification baseline

現況 targeted 為 session-state 27/27、extension 146/146、skill 6/6；full `npm test` 266/266。`npm run check` 既有失敗為未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 缺 `highlight.js` declaration（TS7016）；不得藉本案修正。

## Dated amendment：converge 知識盲點上限（2026-09-01）

使用者明確決定：`converge` 只啟動一次 convergence invocation。無真正知識盲點時，模型必須提交 `READY_FOR_DEEP`，runtime 沿既有 `continueDeepKnowledge` 進入 `DEEP_KNOWLEDGE_RETRIEVAL`；runtime 不得代交或偽造 READY。真正知識盲點定義為完成 Deep Retrieval 所缺的客觀知識或證據，不含可採用預設的 implementation detail。

若存在真正知識盲點，最多問人類一題；回答保存後直接沿 `continueDeepKnowledge` 進入 Deep，不回 `grill_checkpoint`、不再 Grill 或問第二題，也不偽造 READY。這是 checkpoint 後的明確例外，不改變 material decision 仍須由人類裁決的原則。兩條 converge 驗收分別固定無盲點 READY→Deep，以及一個盲點問一題後直接 Deep。

## Implementation and verification（2026-09-01）

已完成：第 8 個有效人類回答後進 checkpoint；`continue_one` 恰一正常 round；`converge` 無盲點由模型提交 `READY_FOR_DEEP` 後直接進 `DEEP_KNOWLEDGE_RETRIEVAL`，有真正知識盲點最多問一題，回答保存後直接進 Deep；`cancel` 回 `RECEIVE` 並恢復工具。

實作檔案為 `forge-runtime/src/ui/ui-state.ts`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/extensions/forge-runtime.ts` 與 `forge-runtime/skills/grilling/SKILL.md`。驗證為完整 281/281、精準 convergence/cancel/relevance 5/5、session 33/33、cancel 8/8、`quick_validate` 成功、pack dry-run 260 files、isolated tarball install/path resolution 成功、`git diff --check` exit 0；`npm run check` 僅剩未修改 `pi-main` 的 `highlight.js` TS7016 baseline。已知 package 債務為仍包含約 213 個 `.log`；true knowledge gap 目前由 prompt/skill 契約約束，未加入 runtime NLP classifier。
