---
title: Grill 到 Deep Knowledge 的階段邊界與知識交接
type: adr
scope: Forge Runtime v4 Grill／Deep Knowledge handoff
updated: 2026-08-24
source: FORGE_RUNTIME_Arch_v4.md、ADR-0004、ADR-0006、ADR-0011、ADR-0014、docs/PLAN-A.md
status: accepted/implemented
---

# ADR-0015：Grill 到 Deep Knowledge 的階段邊界與知識交接

日期：2026-08-23

## 狀態

Accepted；已依使用者裁決的方案 A 實作完成。

## Context

Light Discovery 已能建立候選資料，Grill 也會查證 evidence 並取得人類決策。若 Grill 尚未封口就啟動 Deep，或 Deep 重讀同一份資料，可能造成重複提問、舊 event 重新開 Grill、snapshot 污染與無限循環。ADR-0004 定義 Workflow 主權與人類決策邊界，ADR-0006 定義 Grill 與 Deep 的階段分工，ADR-0014 定義 Light Discovery 的 metadata-only 邊界。ADR-0011 保留 Grill completion 的 `terminate: true` 與 terminal semantics，但其中「Deep 後新歧義」尚未定義的部分由本 ADR 補足。

## Decision

1. 保留 Grill → Deep Knowledge 的階段分工。Grill 負責查證與取得人類決策；Deep 沿用同一份 immutable snapshot 與已確認決策，不重讀相同 `wiki/`／`code_base/` evidence，只補 snapshot 沒有且後續明確需要的新來源。
2. 以既有 `continueDeepKnowledge` 作為唯一交接 seam。`READY_FOR_DEEP` 的正式 completion 與 debug completion 都必須通過同一正式 gate；通過 relevance 後，在任何 await 前關閉 Grill pending／round、還原 tools、使舊 round 失效，再開始 Deep。`message_end` 與 `/continue` 必須受 active-stage guard 保護。
3. relevance failure 是 Discovery clarification，不建立 Grill round。回答後依 `WAIT_USER → USER_CONFIRMED → LIGHT_DISCOVERY`，以原需求加補充重新探索並建立新 snapshot，再進 Grill。
4. Deep 不直接向使用者提問。未來只有新 Evidence ID 帶來新歧義時，Workflow 才能建立新 Grill round；重複 evidence 或 decisionId 不得循環。現 ticket 不新增 speculative Deep result type，state machine 仍不允許 Deep 直接回 Grill。
5. round ID 在同一 extension lifetime 內單調遞增，reset 不重設 `nextRoundId`。WAIT_USER identity 採方案 A：`runtime-issued roundId + kind + decisionId`；unknown round reject、精確重播已回答的舊 round 保持 idempotent，新 round 即使重用相同 ID 仍可接受。fetched evidence 只屬於目前 snapshot；同一 snapshot 多輪可保留，candidate IDs 改變時清除舊 fetched evidence。
6. runtime 只能保證流程契約，不能證明模型沒有漏掉語意問題。若需要處理此假設，另開 verifier ticket；本 ticket 不加入第二個 LLM evaluator。

## Consequences

- Grill 與 Deep 的責任邊界明確，Deep 不會因重讀相同證據而再次提出 Grill 問題。
- 舊 Grill event 在 Deep 階段應被 active-stage guard 擋下，且交接前已同步封口 pending state。
- relevance 問題回到 Discovery，可能增加一次 Light Discovery 與新 snapshot，但不會把來源問題誤當成決策問題。
- snapshot 與 evidence identity 的生命週期更嚴格；新增來源必須帶來新的 Evidence ID。
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
