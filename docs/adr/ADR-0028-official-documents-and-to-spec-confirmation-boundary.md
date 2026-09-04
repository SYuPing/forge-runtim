---
title: 正式設計文件與 TO_SPEC 人工確認邊界
type: architecture-decision-record
scope: Forge Runtime 正式文件、CONTEXT_BUILD／ADR_BUILD 完成邊界與 TO_SPEC 後續流程
updated: 2026-09-03
source: 使用者核准、AGENTS.md、ADR-0027、docs/PLAN-A.md、docs/handoff.md
status: accepted-boundary
---

# ADR-0028：正式設計文件與 TO_SPEC 人工確認邊界

## Context

本 repo 的 canonical 設計文件由 `AGENTS.md` 規定，包含 root `CONTEXT.md`、`docs/adr/`、`docs/PLAN-A.md` 與 `docs/handoff.md`。`Documents/` 是未來 PI 使用者專案的生成產物，不是本 repo 的正式真相來源。本輪使用者已取消目前任務，並要求流程只交付到 ADR 邊界；後續 `TO_SPEC` 必須等明確人工確認。

## Decision

1. 本 repo 的正式文件只以 root `CONTEXT.md`、`docs/adr/`、`docs/PLAN-A.md`、`docs/handoff.md` 為準；`Documents/` 不列為本輪必讀、canonical 或交接依據。
2. 既有 CONTEXT_BUILD、ADR_BUILD 與 Documents writer 實作狀態如實保留，但本輪只同步正式文件，不修改或重寫 `Documents/` 生成產物。
3. `TO_SPEC` 目前僅表示狀態節點存在／可轉入；TO_SPEC tool／handler 與後續規格化工作尚未開始，且未獲使用者授權。不得寫成已執行 TO_SPEC、已完成 TO_SPEC 或已自動完成後續流程。
4. 在使用者明確確認前，流程停在 ADR 邊界；下一步只能交接並等待確認，不得自行開始 TO_SPEC、TO_TICKET 或其他後續實作。
5. ADR-0027 的 `human_premise`、外部事實缺口作為 non-blocking Spec Gap、僅在零可追溯證據／blocking limitation／material ambiguity 時 fail-closed，以及 Documents writer 的安全與原子性決策仍然有效；本 ADR 只部分取代其 canonical／後續流程解讀。

## Consequences

正式設計決策與未來生成產物不會混淆；使用者可在閱讀 canonical 文件後明確決定是否進入 TO_SPEC。既有已完成的 code 驗證紀錄保留，但不會被誤讀成 TO_SPEC 已完成。

## Not in scope

不修改程式碼、測試、`pi-main/`、`Documents/` 或 `AGENTS.md`；不實作 TO_SPEC／TO_TICKET，不新增 importer、execution guard 或其他後續流程。

## Current runtime／flow verification note（2026-09-03）

衍生流程圖已核對 current runtime 的 11 個 state、7 種 WAIT_USER payload kind、Context／ADR production caller 與 Documents bundle；成功 ADR 後僅到 `TO_SPEC` 狀態節點，沒有 TO_SPEC tool／handler。流程圖與本 ADR 一致，未把狀態節點誤標為 executor；Evidence 空包與 `buildContextItems` caller gap 仍列為未解風險。證據：`forge-intent-context-flow.html:25-35,38-40`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/extensions/forge-runtime.ts`。
