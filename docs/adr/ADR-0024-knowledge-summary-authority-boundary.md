---
title: knowledgeSummary 非權威邊界
type: adr
scope: KNOWLEDGE_UNDERSTANDING→CONTEXT_BUILD
updated: 2026-08-31
source: 使用者確認、ADR-0023、現有 EvidencePackage／Context Builder 契約
status: implemented-verified-reviewed
---

# ADR-0024：knowledgeSummary 非權威邊界

## Context

自然語言摘要可能格式正確卻與結構欄位矛盾；程式可檢查存在與長度，不能可靠判斷所有語意。

## Decision

摘要矛盾時仍接受 EvidencePackage。schema description 與 `EvidencePackage` JSDoc 明定 `knowledgeSummary` 僅供人類閱讀、非權威、不得新增主張或控制流程。`decisions`、`findings`、`limitations` 是正式事實；Context Builder 正式輸入與輸出只能依結構欄位及 runtime-derived evidence IDs。

## Consequences

保留流程穩定性，不因自然語言判斷不可靠而反覆阻擋；以 schema／型別契約與回歸測試防止摘要被誤當正式輸入。摘要是否忠實仍需模型遵守契約與審查，不能宣稱完全自動驗證。

## Not in scope

不做語意 parser、矛盾阻擋／重試、runtime 重寫、第二模型／DTO／依賴、`pi-main` 修改或自動續跑 Context Build。

## Verification

Context Builder regression 以否定正式 decision 與虛構 `authorityLevel` 的矛盾摘要證明正式 items 不受影響，且摘要保留供閱讀。RED 145/1 後 GREEN 146/0；單檔 Context 測試 4/0；完整 `npm test` 266/266；Standards 與 Spec review PASS。

`npm run check` 唯一既有阻塞為未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21` 的 `highlight.js` TS7016（21 個），與本輪無關；本輪未修改 `pi-main`。自動排程 Context Build 與空 Evidence Package validation 仍 out of scope。

狀態：`implemented-verified-reviewed`。
