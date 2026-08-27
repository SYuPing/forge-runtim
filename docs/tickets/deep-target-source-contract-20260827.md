---
title: Deep target source contract
type: ticket
scope: forge-runtime Deep Retrieval target source contract
updated: 2026-08-27
source: ADR-0017、ADR-0016、CONTEXT.md、docs/PLAN-A.md、docs/handoff.md
status: implementation-complete-validated
---

# deep-target-source-contract-20260827

## 目標

修正 Grill 完成後進入 Deep Retrieval 的 target source 轉換契約，讓模型知道可搜尋的 target manifest，並在缺少 target 檔名時可重試、不誤耗用 Deep attempt。

## 觀察證據

使用者提供的實際輸出先顯示 `forge_grill_complete` 已接受，接著第一次 `forge_deep_search` 回覆「Target source 不明確，請選擇一個明確的 target 檔案」，同一批後續呼叫回覆「過期的 Deep Retrieval 嘗試已忽略」。這是觀察，不宣稱本 ticket 已修復。

## 核准設計

完整契約以 [`ADR-0017`](../adr/ADR-0017-deep-target-source-contract.md) 為準：follow-up 使用既有 `workflow.snapshot.candidates` 列出 target manifest，`target` 分支要求 `targetSource`，缺少時 retryable invalid 且保留 attempt；明確但無唯一匹配仍進 `WAIT_USER`。stale sibling 統一 `terminate: true`。

## 範圍

- 正式程式只改 `forge-runtime/extensions/forge-runtime.ts`。
- 測試只改 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。
- 不修改 `pi-main/`、`session-state.ts`、snapshot 契約或合法 Deep 後續；不自動選 target，不新增 sequential 或依賴。

## 狀態

本 ticket 已完成實作與驗證，狀態為 `implementation-complete-validated`；目前無待決設計。

## 完成

- production schema 已使用 discriminated union：`target` 必填 `targetSource`，`wiki`／`code_base` 不要求。
- handler 在扣除預算前拒絕缺少 `targetSource`，回 retryable invalid 並保留 attempt／budget；明確但無唯一匹配時進 `WAIT_USER`。
- Deep follow-up 帶有 target manifest，包含空清單；四個 stale Deep outcomes 均回傳 `terminate: true`。

## 驗證

五個指定情境測試均通過；完整 `npm test` `217/217`（`forge-runtime/.tmp/post-schema-test.log`）；`npm run check` exit 0（`forge-runtime/.tmp/post-schema-check.log`）；Standards／Spec re-review PASS。僅有 Node `DEP0190` 非阻塞警告。

## 下一步

使用者檢閱並決定提交；目前不捏造 commit。
