---
title: Forge intent 到 Context Build 垂直流程圖交付狀態
type: task-state
scope: forge-intent-context-flow-20260830
updated: 2026-08-30
source: forge-intent-context-flow.html、Memory/record.md、Memory/lesson_learn.md
status: completed-with-caveats
---

# Forge intent→Context Build 垂直流程圖

## 已完成項目

- 完成獨立 HTML 流程圖 `forge-intent-context-flow.html`。
- 主流程自上而下九列，每列一個 state；併發與等待另開旁路，交接文字精簡且白話。
- 建立維護 Skill `C:\Users\User\.codex\skills\forge-intent-context-flow\`，未來可用 `$forge-intent-context-flow` 持續校正同一份 HTML。

## 重要決策

- 唯一 HTML 交付是 `forge-intent-context-flow.html`。
- 舊 `forge-runtime-flow.html` 已復原且無 diff，不作為本輪交付。
- 分開呈現 workflow state、completion status、入口等待與併發支線。

## 修改檔案

- `forge-intent-context-flow.html`
- `Memory/record.md`
- `Memory/lesson_learn.md`
- `agent-state/forge-runtime-flow-20260830.md`
- `agent-state/forge-intent-context-flow-20260830.md`
- `C:\Users\User\.codex\skills\forge-intent-context-flow\SKILL.md`（repo 外的個人 Skill）

## 測試結果

- Browser 1280×900：PASS。
- Browser 390×844：PASS；手機支線寬 289–296px。
- console errors：0。
- Skill `quick_validate` UTF-8：PASS。
- Skill 獨立 review：P0/P1/P2 均 0。

## 未解問題

- 空 Evidence Package 仍可能通過 validator 並抵達 `CONTEXT_BUILD`。
- Context builder 與 `human_premise` 尚未完整接入正式 runtime completion 路徑。

## 下一步

- 另案依 ADR-0021 與 Evidence 充足性邊界設計、授權並實作 runtime 修復。
- 完成真實 PI 原始情境人工驗收。
- 未來維護時使用 `$forge-intent-context-flow`，每次依目前 CodeGraph／可執行 handler 重新產生流程證據。

## 通用 Skill 擴充

- Forge 專用 Skill 仍保留作為相容維護入口；其 `agents/openai.yaml` 已設定 `policy.allow_implicit_invocation: false`，避免攔截通用流程圖需求。
- 跨專案通用維護已移至 [`C:\Users\User\.codex\skills\code-flowchart-html\SKILL.md`]，狀態與驗證見 [`agent-state/code-flowchart-html-20260830.md`](./code-flowchart-html-20260830.md)。

## 本輪同步狀態

### 已完成項目

- 依 current runtime 更新 `forge-intent-context-flow.html` 的九列流程與旁路語意。
- 同步 `CONTEXT.md`、`docs/PLAN-A.md`、`docs/handoff.md`、`Memory/record.md`、`Memory/lesson_learn.md`。

### 重要決策

- 九列 baseline 不變；無 runtime／架構決策變更，不拆 Plan B、不建立新 ADR。
- `forge-runtime-flow.html` before/after SHA-256 均為 `822ABDA78BB3C6DB7429C0D2365F56E15C97247B25E72279CBB3D7406C6249E0`，本輪不修改。

### 修改檔案

- `forge-intent-context-flow.html`（視覺交付，由主代理更新）
- `CONTEXT.md`、`docs/PLAN-A.md`、`docs/handoff.md`
- `docs/adr/ADR-0001-forge-runtime-v4-foundation.md`
- `Memory/record.md`、`Memory/lesson_learn.md`
- `agent-state/forge-intent-context-flow-20260830.md`

### 測試結果

- 靜態 parser、純 HTML/CSS、semantic classes、九 state 通過；獨立內容 review P0=0、P1=0。
- 無可用 browser instance；1280×900、390×844、console、overflow、截斷未實測。

### 未解問題

- CONTEXT_BUILD production wiring 尚未接上。
- Evidence Package 全空目前不被 validator 拒絕。
- mixed batch 已在目前 HTML 明確記錄 call-ID、all-settled barrier 與單次 follow-up。

### 下一步

- 另案設計、授權並實作 Context Build 與 Evidence 充足性修復；完成真實 PI 原始情境人工驗收。

## 本輪 Markdown 同步更正

### 已完成項目

- 已依目前 HTML 更新 `Memory/record.md` 與 `Memory/lesson_learn.md`。
- 已確認 WAIT_USER、Deep mixed batch／needs_decision 與 CONTEXT_BUILD 的現行描述一致。
- 已確認本輪修改範圍只有 Markdown。

### 重要決策

- WAIT_USER 的 `publishState` 只更新 `ctx.ui.setStatus()`，不送 `pi.sendMessage`。
- Deep mixed batch 以 call-ID 聚合，等待 all settled 後只送一次 follow-up；Deep `needs_decision` 回原 phase 前需 settled replay，stale identity 停止推進。
- `CONTEXT_BUILD` 維持 partial 狀態，production builder 尚未接入；空 Evidence Package 風險維持明確標示。

### 修改檔案

- `Memory/record.md`
- `Memory/lesson_learn.md`
- `agent-state/forge-intent-context-flow-20260830.md`

### 測試結果

- 未執行 runtime、HTML 或瀏覽器測試；本輪只做 Markdown 維護。
- 內容核對證據：`forge-intent-context-flow.html:28-32`。
- 未修改 `forge-intent-context-flow.html`、`forge-runtime/` 或 `pi-main/`。

### 未解問題

- 空 Evidence Package 目前仍可能通過 validator 並抵達 `CONTEXT_BUILD`，見 `forge-intent-context-flow.html:31`。
- `CONTEXT_BUILD` production builder 尚未接入，見 `forge-intent-context-flow.html:32`。

### 下一步

- 另案設計、授權並實作 Evidence 充足性與 Context Build production wiring。
- 再次維護流程圖時，先核對目前 HTML 與可執行 handler，再同步本狀態檔及兩份 Memory。
