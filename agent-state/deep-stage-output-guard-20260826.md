---
title: Deep 階段輸出守門
type: agent-state
scope: deep-stage-output-guard-20260826
updated: 2026-08-26
source: CONTEXT.md、FORGE_RUNTIME_Arch_v4.md、ADR-0016、docs/PLAN-A.md、docs/handoff.md
status: implemented-and-verified
---

# deep-stage-output-guard-20260826

## 已完成項目

- 完成 Deep Retrieval／Knowledge Understanding 輸出守門的最小設計文件更新。
- 明確兩個 Deep 階段只準備證據，不開始實作。
- 已完成 production guard、測試修正與 review 收尾。

## 重要決策

- Guard 只在 active Deep attempt 且 stage 為 `DEEP_KNOWLEDGE_RETRIEVAL` 或 `KNOWLEDGE_UNDERSTANDING` 時成立。
- `message_update` 與 `message_end` 移除 assistant `text`／`thinking`，保留合法 `toolCall`。
- 不沿用 Grill recovery，不影響 `WAIT_USER`、Deep cancel 後或後續階段；不新增 Plan B、不修改 `pi-main/`。
- 根因是 Grill-only prose guard 未在 Deep active 的 `message_update`／`message_end` 攔 `text`／`thinking`；以 `hasActiveDeepAttempt` 補上共同守門。

## 修改文件

- `CONTEXT.md`
- `docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md`
- `docs/PLAN-A.md`
- `docs/handoff.md`
- `agent-state/deep-stage-output-guard-20260826.md`
- `Memory/record.md`
- `Memory/lesson_learn.md`
- Production：`forge-runtime/extensions/forge-runtime.ts`
- Tests：`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`

## 測試結果

- 紅燈：`PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue` 搭配 `FORBIDDEN_IMPLEMENTATION_MARKER`，exit 1。
- targeted：9/9。
- 完整：`npm test` 209 passed/0 failed/0 skipped；`npm run check` exit 0。
- review：production diff 零 functional findings，scope on target。

## 未解問題

- Grill `message_end` 含 toolCall 分支仍依賴 `message_update` 先清文字，屬未證實後續風險，不在本 ticket 擴修。
- Context／ADR／Spec／Ticket／Planning 尚未串成 runtime flow：這是本 ticket 範圍外的後續風險，不影響 `deep-stage-output-guard` 已完成；未來若啟用該串接，另開 ticket 建立各階段輸出契約。

## 下一步

1. 由使用者在真實 PI session 重跑原始 Deep Retrieval → Understanding 情境。
2. 若要處理 Grill sibling risk 或串接文件與 runtime flow，另開 ticket 並先走設計核准。
