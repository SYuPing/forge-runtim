---
title: knowledgeSummary 非權威邊界 agent state
type: agent-state
scope: knowledge-summary-authority-boundary-20260831
updated: 2026-08-31
source: ADR-0024、docs/PLAN-A.md、docs/tickets/knowledge-summary-authority-boundary-20260831.md
status: implemented-verified-reviewed
---

# Agent State

## 已完成項目

- 使用者確認摘要矛盾時仍接受 package。
- 確認結構欄位權威、摘要僅供閱讀，且不接自動 Context Build。
- 完成 ADR、Plan、ticket 與交接方向。
- schema description 與 `EvidencePackage` JSDoc 已明定摘要僅供人類閱讀、非權威、不得新增主張或控制流程。
- Context Builder regression 已證明矛盾摘要不影響正式 items，且摘要保留供閱讀。
- 完成 TDD、production 修正、驗證與 Standards／Spec review。

## 重要決策

Context Builder 只能依 `decisions`、`findings`、`limitations` 與 runtime-derived evidence IDs 產生正式輸出。

## 修改檔案

`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/evidence/evidence-engine.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/knowledge/discovery-evidence.test.ts`，以及本 ticket durable Markdown 文件。

## 測試結果

RED 145/1 後 GREEN 146/0；單檔 Context 測試 4/0；完整 `npm test` 266/266；Standards 與 Spec review PASS。

`npm run check` 唯一既有阻塞為未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21` 的 `highlight.js` TS7016（21 個），與本輪無關。

## 未解問題

程式無法完整判斷摘要自然語意是否忠實；未來 caller 誤用摘要仍是最脆弱假設。

## 未解問題

程式無法完整判斷摘要自然語意是否忠實；未來 caller 誤用摘要仍是最脆弱假設。自動排程 Context Build 與空 Evidence Package validation 仍 out of scope。

## 下一步

本 ticket 無待辦實作；若要處理上述 out of scope 項目，需另案設計與確認。
