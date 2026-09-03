---
title: CONTEXT_BUILD production continuation
type: ticket
scope: Forge Runtime CONTEXT_BUILD／ADR_BUILD production 接線
updated: 2026-09-03
source: ADR-0028、AGENTS.md、ADR-0027、docs/PLAN-A.md、docs/handoff.md
status: cancelled-at-ADR-awaiting-user-confirmation
---

# Ticket：CONTEXT_BUILD production continuation

## 目標

完成 Evidence Package 交付後的 Context Build production caller、自動續跑、候選保存、ADR Build 交接與 `Documents/` 原子文件提交。

## 已核准契約

Grill 明確確認可建立帶 provenance 的 `human_premise`，沒有外部文件仍可進 Context Build；缺外部事實記 non-blocking Spec Gap。只有無確認、material ambiguity 或 blocking limitation 才 fail-closed。

## 已完成

`context-build` bundled skill、Context／ADR builders、Documents writer、session-state 保存／transition、extension invocation 與 `agent_settled` continuation，以及各自測試均已完成。Context 與 ADR 使用獨立 fresh attempt；ambiguity 會進 `WAIT_USER`，回答後重建 identity。

Context／ADR ambiguity 可由 UI select 或一般文字 input 回答；UI 路徑在 `agent_settled` 排 fresh invocation，文字路徑立即 transform fresh invocation，兩者均保留 `sourceRoundId`／`humanDecisions`，不會卡住。

## Not Building

不修改 `pi-main/`、不新增依賴、不做 UI、Spec／TO_TICKET、trusted importer 或 generic execution guard。

## 證據與驗證

`human_premise` 與獨立 `humanDecisions` 可追溯；外部事實缺口是 non-blocking Spec Gap。只有零可追溯證據、blocking limitation 或 material ambiguity fail-closed。Documents writer 使用 active PI project root 的 `Documents/`、optimistic base hash、managed blocks 與 atomic rollback，成功後進 `TO_SPEC`。

驗證：`npm test` 324/324、base tsc pass、skill quick_validate pass、`git diff --check` pass。production 入口已移除 `process.cwd()` fallback；只有非空 `ctx.cwd` 可啟動，確保 `Documents/` 永遠位於 active PI project root，缺失時 fail-closed。Pi-interactive tsc 仍受未修改 `pi-main` 的 `syntax-highlight.ts` 缺 `highlight.js` 宣告 TS7016 阻擋。

## 最新覆蓋（2026-09-03）

本 ticket 依使用者決定取消後續實作，正式交付邊界停在 `ADR_BUILD`／ADR 交付；`TO_SPEC` 尚未開始，必須等待使用者明確確認後才可規劃或實作。`Documents/` 是使用者專案的生成產物，本輪不更新；Forge repo 的正規文件以 `AGENTS.md` 規範所列根目錄 `CONTEXT.md`、`ADR.md`、`PLAN-A.md`、`handoff.md` 與 `docs/` 內容為準。既有程式碼完成紀錄與驗證數字保留，不表示本輪執行 TO_SPEC。
