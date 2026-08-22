---
title: Light Discovery 檔名與 metadata 模組
type: agent-state
scope: start_forge 後的 Light Discovery 設計
updated: 2026-08-22
source: ADR-0014、docs/PLAN-A.md、CONTEXT.md、使用者核准決策
status: complete
---

# Light Discovery 狀態

## 已完成項目

- CodeGraph 已同步，索引為最新狀態。
- 已完成必讀設計文件、Memory 與呼叫路徑探索。
- 使用者已確認以 ADR-0014 作為 v4 第一階段：只做 `wiki/`／`code_base/` metadata-only 搜尋，並保留既有人工核准流程。

## 重要決策

- 輸入只有 workspace/root 與原始 `userMessage`；不接受 seeds、workflow、Grill state 或 route。
- 只搜尋 `wiki/`、`code_base/` 的檔名、相對路徑與穩定 metadata；每來源最多 3 筆且固定排序。
- partial failure 保留部分結果並回傳 warning；是否 `WAIT_USER` 由 workflow 決定。
- Grill full-content/snapshot 由外部相容 adapter 提供；不改 Grill／Deep Knowledge 決策。
- public seam 收 `rootDir` 與 raw `userMessage`；module 內負責正規化及 deterministic metadata 掃描。
- `wiki/` 與 `code_base/` 各最多回傳 3 筆，依固定相對路徑排序，結果包含 `matches`、`warnings`、`sourceAvailability`。
- 不讀取全文、不產生 summary/snapshot；extension caller 傳入 raw message。
- module 外保留 Grill／Deep Knowledge 相容 adapter；既有缺失來源人工核准流程保留。

## 修改檔案

- `forge-runtime/src/discovery/light-discovery.ts`（Light Discovery production 實作）
- `forge-runtime/extensions/forge-runtime.ts`（extension caller 與相容 adapter 整合）
- `agent-state/light-discovery-file-metadata-20260822.md`（本次狀態更新）

## 測試結果

- 初次 focused 驗證 `76/76` 通過，`npm run check` 通過；互動流程另揭露 production adapter relevance regression，故尚不得視為最終重驗完成。
- 根因證據：`buildGrillCompatibleDiscovery` 固定 `matches=[path]`，但 `evaluateCandidateRelevance` 要求 `path+content`，導致 `READY_FOR_DEEP` 錯回 `WAIT_USER`。
- 已在 extension 模組外 adapter 修正根因：依 raw request seeds 真實計算 `path`／`content`、`matchedSeeds`、`score`，只讓具備 `path+content` 的候選進入 `codeBaseCandidates`；Light Discovery 本體仍維持 metadata-only，兩個 caller 已同步更新。
- 已精確清理殘留測試 PID，目前無殘留；最終驗證已完成。
- Review fixes 驗證已完成：補上的 partial-failure 測試與繁中 runtime 文案均已驗證。

## 測試遷移

- 清除 2 個 stale old API callers。
- 刪除 10 個 ADR 淘汰測試、改寫／保留 5 個，並還原 2 個強相關 Deep expectations。

## 驗證結果

- Review fixes milestone：互動 9/9、focused 79/79、`npm run check` exit 0、完整 `npm test` 140/140；0 fail、0 skip、0 todo。
- 證據：`forge-runtime/.tmp/review-fix-verify-*.log`；無本輪殘留測試程序。

## 審查發現事項（2026-08-22）

- Standards：3 個發現事項；Spec：3 個發現事項。
- 已採納：ADR-0014 明確記錄使用者核准的 v4 分階段交付例外；PLAN-A／handoff 改為第一階段已完成並移除未修改檔案的修改宣稱；Memory/record 將舊設計狀態標為歷史並連到目前完成狀態。
- 不修改 `forge-runtime/src/discovery/discovery-sources.ts`：`extractDeepDiscoverySeeds` 僅服務模組外的 Deep adapter，不是 Light Discovery seam 的前處理，因此不納入本 ticket 修正。
- 暫不抽象兩個重複 caller：目前只有兩個 caller，抽象會擴大本輪範圍；等出現第三個 caller 再考慮共用抽象。

## 未解問題

- 初次 Standards 與 Spec review 各有 3 個發現事項；已採納並完成修正。Spec re-review 為 0 發現事項；Standards re-review 僅發現過時數字，已由本次文件收尾修正。
- 未發現新 bug；本 ticket 無已知未解 production 問題。
- 未解風險僅為既有 Node `DEP0190` warning（非阻擋）；v4 後續 phase 不在本 ticket scope。

## 下一步

- 本 ticket 已完成實作、驗證、雙軸審查與文件收尾；可交付／提交，不自行 commit。
