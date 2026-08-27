---
title: Deep stale-result loop 修正狀態
type: agent-state
scope: deep-stale-result-loop-20260826
updated: 2026-08-27
source: CONTEXT.md、ADR-0015、docs/PLAN-A.md、docs/handoff.md、FORGE_RUNTIME_Arch_v4.md
status: automated-verified-awaiting-real-session
---

# deep-stale-result-loop-20260826

## 已完成項目

- 已讀取既有 handoff、CONTEXT、PLAN-A、ADR-0015／0016、架構準則與 Memory 文件。
- 已完成本 ticket 的最小 production／test 修正與 automated verification；使用者限定的 stale-result loop 已處理。
- 初始 Deep stage panel 改為 `displayOnly`；pending identity 延至 matching `message_start` 才 consume；pending 期間阻擋 Deep tool_call。
- 工具預載與 delivery 授權分離，避免合法 identity 到達時 `Tool forge_deep_search not found`。

## 重要決策

- stage panel 使用 `displayOnly`，不以 `steer` 參與 agent-loop 排程。
- pending identity 保留到 matching user message 進入 `message_start` 才 consume；pending 期間阻擋 Deep tools。
- 保留 stale quiet reject 與既有 Deep／Workflow 不變量；不改 `pi-main/`。

## 重要決策（2026-08-27）

- 不修改 Grill completion、WAIT_USER、cancel/retry/switch、relevance、state transition、snapshot、合法 Deep 後續或 `pi-main/`。

## 修改檔案

- `CONTEXT.md`
- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`
- `docs/adr/ADR-0015-grill-deep-knowledge-handoff-boundary.md`
- `docs/PLAN-A.md`
- `docs/handoff.md`
- `agent-state/deep-stale-result-loop-20260826.md`
- `docs/tickets/deep-stale-result-loop-20260826.md`
- `Memory/record.md`
- `Memory/lesson_learn.md`

## 測試結果

- 未修版真實 AgentSession／InteractiveMode／faux provider regression：RED 1 fail。
- 修正版正式 regression：GREEN 1 pass，後續合法 Deep search accepted。
- extension targeted 117/117；PI integration 10/10；完整 `npm test` 212/212；`npm run check` exit 0。
- TUI 使用 `waitForScrollBuffer` 驗證 displayOnly stage。logs：`forge-runtime/artifacts/test-logs/deep-final-formal-red-20260827.log`、`deep-final-formal-green-20260827.log`、`deep-target-extension-suite-20260827.log`、`deep-target-pi-integration-rerun-20260827.log`、`deep-final-full-npm-test-20260827.log`、`deep-final-npm-check-20260827.log`。
- 真實 PI v0.83.0 從 repo root 以 `.\pi-main\pi-test.bat --approve` 啟動成功，啟動畫面列出 `forge-runtime.ts`；僅為 smoke check，未捕捉原始 stale 情境輸入／結果。

## 未解問題

- 使用者尚未在真實 PI session 重跑原始情境。
- blocked tool result `terminate=false` 可能延遲 followUp；其他 Deep `/continue` panel 預設 sendMessage 仍可能形成 steer，均為殘餘風險，不宣稱已修。

## 下一步

1. 使用者在真實 PI session 重跑原始 stale-result 情境。
2. 若真實 session 仍失敗，另開 ticket；本 ticket 不擴大修正範圍。
