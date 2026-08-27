---
title: Deep followUp identity 啟用時序修正
type: agent-state
scope: deep-followup-identity-activation-20260826
updated: 2026-08-26
source: CONTEXT.md、ADR-0015、docs/PLAN-A.md、docs/handoff.md、ticket
status: implemented-and-verified
---

# deep-followup-identity-activation-20260826

## 已完成項目

- 已讀取既有 CONTEXT、ADR-0015、PLAN-A、handoff 與既有 agent-state 格式。
- 已完成 Deep Retrieval activation 時序修正與本 ticket 文件同步。
- activation 已從 `continueDeepKnowledge` 延後至 exact `pendingReplayInvocation` input gate；gate 先清 marker，再啟用 Deep Retrieval tools。

## 重要決策

- 根因是 Deep tools 啟用早於 identity-bearing followUp 進入 `input`。
- 在 exact `pendingReplayInvocation` gate 內先清 marker，再啟用 Deep Retrieval tools，沿用 `{ action: "continue" }`。
- 保留 identity 三元組、stale quiet reject、followUp transport、主 session、verifier；不改 `pi-main/`。
- 不做 completion result identity、custom loop、sequential 設定、新狀態機、UI、Plan B；Grill sibling risk 不納入。
- final review medium finding 已修正：`requireDeepToolBoundary` 必須同時具備 tool boundary 與 `sendUserMessage`，避免 identity-bearing followUp 無法送出時形成半完成 handoff。

## 修改檔案

- `CONTEXT.md`
- `docs/adr/ADR-0015-grill-deep-knowledge-handoff-boundary.md`
- `docs/PLAN-A.md`
- `docs/handoff.md`
- `docs/tickets/deep-followup-identity-activation-20260826.md`
- `agent-state/deep-followup-identity-activation-20260826.md`
- `Memory/record.md`
- `Memory/lesson_learn.md`

## 測試結果

- 新增 2 個 timing regression；targeted 117/117。
- 完整 `npm test` 211/211；`npm run check` exit 0。
- 本輪未發現新 bug。
- final review 修正後：targeted 117/117、`npm test` exit 0、`npm run check` exit 0。

## 未解問題

- Grill `message_end` 含 toolCall sibling risk 仍留待另案。
- 使用者尚未在真實 PI session 重跑原始情境；此為既有非 blocker。

## 下一步

1. 本 ticket 已收尾；後續僅由使用者決定是否在真實 PI session 重跑原始情境。
2. Grill sibling risk 另開 ticket 前不擴修。
