---
title: Grill 到 Deep Knowledge 的階段邊界與知識交接
type: adr
scope: Forge Runtime v4 Grill／Deep Knowledge handoff
updated: 2026-08-27
source: FORGE_RUNTIME_Arch_v4.md、ADR-0004、ADR-0006、ADR-0011、ADR-0014、docs/PLAN-A.md
status: accepted/implemented
---

# ADR-0015：Grill 到 Deep Knowledge 的階段邊界與知識交接

## 2026-08-29 Deep Discovery fallback 交叉引用

資料來源不足的第一次自動 Light Discovery→Grill 與第二次起的 human premise WAIT_USER 契約，見 [`ADR-0021`](ADR-0021-deep-discovery-fallback-human-premise.md)。本 ADR 原則仍有效：Deep 不直接向使用者提問；WAIT_USER 由 Workflow 管理並保留人類決策邊界。

日期：2026-08-23

## 狀態

Accepted；已依使用者裁決的方案 A 實作完成。

## Context

Light Discovery 已能建立候選資料，Grill 也會查證 evidence 並取得人類決策。若 Grill 尚未封口就啟動 Deep，或 Deep 重讀同一份資料，可能造成重複提問、舊 event 重新開 Grill、snapshot 污染與無限循環。ADR-0004 定義 Workflow 主權與人類決策邊界，ADR-0006 定義 Grill 與 Deep 的階段分工，ADR-0014 定義 Light Discovery 的 metadata-only 邊界。ADR-0011 保留 Grill completion 的 `terminate: true` 與 terminal semantics，但其中「Deep 後新歧義」尚未定義的部分由本 ADR 補足。

## Decision

1. 保留 Grill → Deep Knowledge 的階段分工。Grill 負責查證與取得人類決策；Deep 沿用同一份 immutable snapshot 與已確認決策，不重讀相同 `wiki/`／`code_base/` evidence，只補 snapshot 沒有且後續明確需要的新來源。
2. 以既有 `continueDeepKnowledge` 作為唯一交接 seam。`READY_FOR_DEEP` 的正式 completion 與 debug completion 都必須通過同一正式 gate；通過 relevance 後，在任何 await 前關閉 Grill pending／round、還原 tools、使舊 round 失效，再開始 Deep。`message_end` 與 `/continue` 必須受 active-stage guard 保護。
3. relevance failure 是 Discovery clarification，不建立 Grill round。回答後依 `WAIT_USER → USER_CONFIRMED → LIGHT_DISCOVERY`，以原需求加補充重新探索並建立新 snapshot，再進 Grill。
4. Deep 不直接向使用者提問。原則上只有新 Evidence ID 帶來新歧義時，Workflow 才能建立新 Grill round；唯一例外是 [`ADR-0021`](ADR-0021-deep-discovery-fallback-human-premise.md) 規定的第一次自動 discovery fallback：即使沒有新外部 Evidence ID，也只能建立一次新的 source／Grill round，且不得繞過第二次 `WAIT_USER`。重複 evidence 或 decisionId 不得循環。現 ticket 不新增 speculative Deep result type，state machine 仍不允許 Deep 直接回 Grill；上述例外由 ADR-0021 限定並取代本條件的無條件適用。
5. round ID 在同一 extension lifetime 內單調遞增，reset 不重設 `nextRoundId`。WAIT_USER identity 採方案 A：`runtime-issued roundId + kind + decisionId`；unknown round reject、精確重播已回答的舊 round 保持 idempotent，新 round 即使重用相同 ID 仍可接受。一般規則下，fetched evidence 只屬於目前 snapshot；同一 snapshot 多輪可保留，candidate identity 改變時清除舊 fetched IDs。唯一例外依 [`ADR-0021`](ADR-0021-deep-discovery-fallback-human-premise.md)：第一次 fallback 切換 snapshot 前，將實際已驗證的 Evidence 內容複製到 workflow-local、以 `evidenceId` 去重的 fallback evidence accumulator；切換後各 snapshot-local IDs 仍照常清除。該 accumulator 只在同一 active workflow 內使用，新 workflow、cancel 或 switch 時清除，且不得回寫或污染一般 Grill snapshot。
6. runtime 只能保證流程契約，不能證明模型沒有漏掉語意問題。若需要處理此假設，另開 verifier ticket；本 ticket 不加入第二個 LLM evaluator。

## Consequences

- Grill 與 Deep 的責任邊界明確，Deep 不會因重讀相同證據而再次提出 Grill 問題。
- 舊 Grill event 在 Deep 階段應被 active-stage guard 擋下，且交接前已同步封口 pending state。
- relevance 問題回到 Discovery，可能增加一次 Light Discovery 與新 snapshot，但不會把來源問題誤當成決策問題。
- snapshot 與 evidence identity 的生命週期更嚴格；通常新增來源必須帶來新的 Evidence ID，僅 ADR-0021 的第一次自動 discovery fallback 可在沒有新外部 Evidence ID 時建立一次新 source／Grill round。
- 本 ADR 只核准交接契約，未核准完整 semantic Deep、Pattern Card、持久化 session 或第二個 evaluator。

## Rejected alternatives

- 不讓 Deep 重讀同一份 Grill evidence；這只增加成本，沒有新的證據價值。
- 不讓 Deep 直接向使用者提問；人類決策入口仍由 Workflow 與 Grill 控制。
- 不把 relevance failure 直接建成 Grill round；來源相關性問題應先回 Light Discovery clarification。
- 不新增 Deep → Grill completion result type；目前沒有實際 Deep ambiguity producer，新增型別會提前建立 speculative contract。
- 不加入第二個 LLM evaluator；runtime contract 與模型語意完整性是不同問題，應另開 verifier ticket。

## Evidence

- `FORGE_RUNTIME_Arch_v4.md`：Workflow 主權與人類決策邊界。
- `docs/adr/ADR-0004-knowledge-source-boundaries.md`：Workflow 與決策邊界基線。
- `docs/adr/ADR-0006-grill-readonly-candidate-verification.md`：Grill 與 Deep 的階段分工。
- `docs/adr/ADR-0011-grill-completion-terminal-boundary.md`：`terminate: true` 與 Grill terminal semantics。
- `docs/adr/ADR-0014-light-discovery-file-metadata-module.md`：Light Discovery metadata-only 邊界。
- `CONTEXT.md`、`docs/PLAN-A.md`、`docs/handoff.md`：2026-08-23 核准策略與 2026-08-24 完成狀態。
- 使用者於 2026-08-24 裁決採用方案 A：以 `roundId + kind + decisionId` 識別決策；理由是保留舊 round replay 保護，同時允許新 round 安全重用相同 decision ID，不讓新問題被永久視為舊問題。
- 最終驗證：`npm run check` 兩個 tsconfig 通過；`npm test` 157/157、0 fail、0 skip；Standards／Spec review 的 P0、P1、P2 均為 0。

## Dated amendment：Deep identity handoff activation（2026-08-26）

### 狀態（修正前歷史狀態）

已完成實作與驗證；狀態為 `implemented-and-verified`。

### 問題與根因

`forge_grill_complete` 建立新 Deep attempt 後立即啟用 Deep tools，但 identity-bearing `followUp` 必須等目前 assistant turn 結束才進入 `input`。這段空窗讓模型先用舊 identity 呼叫 Deep search，呼叫在搜尋前被 stale guard 安靜拒絕；followUp identity 到達後，重複執行才會成功。問題是工具啟用時機與 identity 送達時機錯開，不是搜尋資料本身過期。

### 核准決策

- 移除／延後當下的 `activateDeepRetrievalTools()`。
- 在既有 `pi.on("input", ...)` exact pending replay invocation 條件內，先清除 `pendingReplayInvocation`，再啟用 Deep Retrieval tools，之後沿用 `{ action: "continue" }`。
- 保留 `attemptId + sourceRoundId + phase` identity、stale quiet reject、既有 followUp transport、主 session 與 verifier；不得修改 `pi-main/`。
- test harness 已驗證 followUp bridge 會在下一次模型推論前重入 input handler；exact marker 可作一次性 gate。

### 拒絕方案與邊界

- 不把 identity 放入 completion tool result；這會擴大契約，且無法阻止同回合已排出的呼叫。
- 不新增 custom loop、sequential 設定、新狀態機、UI 或 Plan B。
- Grill `message_end` 含 toolCall 的文字清除 sibling risk 不混入本 ticket。

### 預計範圍

- Production：`forge-runtime/extensions/forge-runtime.ts`。
- Tests：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。
- 回歸測試：`Extension_WhenGrillCompletionQueuesDeepIdentity_ShouldEnableDeepToolsOnlyAfterFollowUpStarts`、`Extension_WhenDeepHandoffIsPending_ShouldKeepDeepToolsUnavailableAndIgnoreStaleEvent`。

### 追蹤

本 amendment 只核准 runtime 工具啟用時序修正。2026-08-26 已完成：新增 2 個 timing regression，targeted 117/117、完整 `npm test` 211/211、`npm run check` exit 0。本輪未發現新 bug。Grill `message_end` 含 toolCall 的文字清除 sibling risk 不在本 amendment 範圍，且尚未由本輪驗證證實。

### Final review medium finding 修正

`requireDeepToolBoundary` 必須同時具備 tool boundary 與 `sendUserMessage`，才可視為 handoff 完成；若 identity-bearing followUp 無法送出，不得只完成工具邊界，避免半完成狀態。修正後 targeted 117/117、`npm test` exit 0、`npm run check` exit 0；本輪未發現新 bug。

## Dated amendment：Deep stale-result loop 修正前設計（2026-08-26）

### 狀態

Design approved；ticket `deep-stale-result-loop-20260826` 當時狀態為 `plan-approved-ready-for-red`，尚未實作或驗證。此段為修正前歷史快照，最新狀態見下方 2026-08-27 amendment。

### 決策

- Deep stage panel 改用 `deliverAs: "displayOnly"`，不以 `steer` 參與 agent-loop 排程。
- pending identity 保留到 matching user message 實際進入 `message_start` 才 consume；input preflight 不得提前消費或啟用 Deep。
- pending identity 存在期間由 tool-call gate 阻擋 Deep tools；identity 到達後才恢復合法 Deep tool flow。
- 保留既有 stale quiet reject 與所有 Deep／Workflow 不變量；不修改 `pi-main/`。

### 範圍與邊界

只修正「過期的 Deep Retrieval 完成結果已忽略」的 recurring loop。不得改 Grill completion、WAIT_USER、cancel/retry/switch、relevance、state transition、snapshot、合法 Deep 後續或 Grill `message_end` sibling risk。先測試紅燈，再改 production。

## Dated amendment：Deep stale-result loop 修正完成（2026-08-27）

### 狀態

Implemented-and-automated-verified-awaiting-real-session。只修正本 amendment 指定的 stale-result loop；使用者仍需在真實 PI session 重跑原始情境。

### 結果與驗證

- 初始 Deep stage panel 改為 `displayOnly`；input preflight 只預載本回合 Deep tools，不清 pending identity；matching user `message_start` 才清 pending；pending 期間 Deep tool_call block。
- 工具預載與 delivery 授權分離，避免 identity 到達時 `Tool forge_deep_search not found`。
- 真實 AgentSession／InteractiveMode／faux provider regression 證明未修版 RED 1 fail、修正版 GREEN 1 pass，後續合法 Deep search accepted；TUI 使用 scrollback 驗證 displayOnly stage。
- extension targeted 117/117、PI integration 10/10、完整 `npm test` 212/212、`npm run check` exit 0；logs 位於 `forge-runtime/artifacts/test-logs/`。

### 邊界

未修改 `pi-main/`，無暫時 debug probe，review 僅針對指定 scope。blocked tool result `terminate=false` 與其他 Deep `/continue` panel 可能形成 steer 是殘餘風險，未宣稱已修；Grill `message_end` sibling risk 仍不在本 amendment。
