---
title: ADR-0018：Deep retryable recovery contract
type: adr
scope: Forge Runtime v4 Deep Retrieval／Knowledge Understanding recovery
updated: 2026-08-28
source: FORGE_RUNTIME_Arch_v4.md、ADR-0016、ADR-0017、CONTEXT.md、docs/PLAN-A.md、docs/tickets/deep-recovery-contract-20260828.md
status: design-approved-implementation-pending
---

# ADR-0018：Deep retryable recovery contract

日期：2026-08-28

## 狀態

Design approved；本 ticket 只完成策略文件，尚未修改 production code、tests 或 `pi-main/`。

## Context

ADR-0016 定義 Deep Retrieval／Knowledge Understanding、attempt identity、Evidence Package 與 `CONTEXT_BUILD` gate。ADR-0017 定義 target manifest 與 `targetSource` 驗證，但未定義空 manifest 在 `source=target` 時的復原行為，也未完整定義 duplicate `decisionId` invalid 後的同 attempt 重送契約。實際輸出曾出現 `manifest=[]` 後反覆要求 target、無法進入 `CONTEXT_BUILD`；同一流程亦觀察到 `q-spi-role` 重複而被拒絕。

## Decision

1. `manifest=[]` 且 `source=target` 時，`forge_deep_search` 回傳 retryable invalid。保留同一 `attemptId`、`sourceRoundId` 與 `phase`，不建立或進入 `WAIT_USER`；回應明確要求模型自行改用 `wiki` 或 `code_base`。runtime 不自動選 source／target、不自動 fallback。
2. `duplicate decisionId` 維持拒絕，不靜默去重或覆寫既有 decision。保留同一 `KNOWLEDGE_UNDERSTANDING` attempt，要求模型以相同 identity 重送修正後、每個 decisionId 唯一的 payload。
3. retryable invalid、duplicate rejection 與 stale rejection 都不得推進 stage、清除有效 attempt、寫入 Evidence Package 或進入 `CONTEXT_BUILD`。既有 stale guard 保留。
4. 不接受 basename 模糊匹配；target allowlist、identity 三元組、snapshot 不變。既有 `session-state.ts` seam 先不改；只有 RED 證明 extension seam 不足時，才停止並回報 blocker。
5. production 預設只改 `forge-runtime/extensions/forge-runtime.ts`；測試只改 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。不新增 API、schema、UI、scheduler、snapshot 欄位、依賴或 Plan B。

## Rationale

空 manifest 是可由模型改變 source 的輸入復原情境，不是需要人類挑檔的歧義；保留 identity 可讓同一 attempt 直接重試並避免錯誤建立 `WAIT_USER`。duplicate decision 是資料完整性錯誤，拒絕並要求修正能保留 Evidence Package 的唯一性與人類決策不可覆寫原則。所有 invalid 路徑不改 state，才能保證只有驗證成功的 package 進入 `CONTEXT_BUILD`。

## Rejected alternatives

- 不把空 manifest 轉成 `WAIT_USER`，因為沒有可供人選的 target，會重現 target loop。
- 不自動選 `wiki`、`code_base` 或某個 target，避免 runtime 越過 source／target 決策邊界。
- 不靜默去重 duplicate decisionId，避免吞掉模型輸出錯誤或覆寫首筆決策。
- 不接受 basename 模糊匹配、不擴充 snapshot、不加入 scheduler/custom loop/fallback，因為它們改變既有 allowlist、identity 或架構邊界。
- 不預先修改 `session-state.ts`；只有 RED 證明 extension seam 不足時才回報 blocker。

## Consequences

- 空 target manifest 可在同一 Deep attempt 以 `wiki`／`code_base` 繼續，不再被迫進入無候選的 `WAIT_USER`。
- duplicate decision 仍會要求模型修正，但不會污染 state 或誤進 `CONTEXT_BUILD`。
- 模型可能需要一次以上同 identity 重送；這是可觀測且可重試的成本。
- 真實 PI 情境仍需人工驗收；同批工具的 scheduler 行為不由本 ADR 改變。

## Verification

Plan A 定義五個新測試與具體斷言。extension file 基線為 `124/124`，新增後目標為 `129/129`；排除 `pi-grill-interactive.test.ts` 的本地 suite 基線為 `209/209`，新增後目標為 `214/214`。標準 `npm test` 基線為 `209 pass/1 fail`，唯一既存失敗是缺少 `pi-main/packages/ai/src/providers/data/qwen-token-plan-individual.json`；`npm run check` 基線因 10 個 `InteractiveModeOptions` terminal 型別錯誤與 pi-main 既存缺依賴失敗。本 ticket 要求不新增新失敗並保留 baseline，不宣稱 full/check 全綠；真實 PI 原情境列人工驗收。

## Supersession

本 ADR 只取代 ADR-0016 與 ADR-0017 未定義的 recovery 行為：空 target manifest 的 retryable invalid、duplicate decisionId 的同 attempt 修正重送，以及 invalid 不推進 state 的保證。它不取代兩份 ADR 的 identity、target allowlist、duplicate rejection、stale guard、snapshot 或人類決策原則。
