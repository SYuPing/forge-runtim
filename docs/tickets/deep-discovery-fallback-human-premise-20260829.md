---
title: Deep Discovery fallback human premise
type: ticket
scope: Forge Runtime Deep Retrieval／Knowledge Understanding 資料不足復原
updated: 2026-09-02
source: ADR-0021、使用者核准契約、docs/PLAN-A.md
status: implementation-complete-verified
---

# Ticket：deep-discovery-fallback-human-premise-20260829

## Goal

第一次資料不足自動重做 Light Discovery→Grill；第二次起以固定問題等待使用者確認。確認後以累積證據與 `human_premise` 進入 Knowledge Understanding，通過 validator 後完成 `CONTEXT_BUILD`。

## Contract（2026-08-29 歷史基線）

以下條目保留當時已核准的原始契約與證據；其可見選項、接受輸入及取消 lifecycle 已由 2026-09-02 核准修正取代，現行規範以後述 amendment 為準。

- Retrieval／Understanding 合併計 `needsDiscoveryCount`；新 workflow、cancel、switch 清零。
- 第一次自動 fallback 並使舊 Deep identity stale；第二次及之後 `WAIT_USER`，`kind=deep_discovery_fallback`。
- 只接受 trim 後整句 `同意` 或 `確認`；固定問題完全等於：`此專案資料來源不足，將以前次grill/ 資料來源所得之證據進行後續開發，請確認`。
- 同意後建立 fresh Understanding identity，只允許 `forge_deep_complete`；累積 evidence 依 ID 去重。
- 無外部來源仍建立 `human_premise` Evidence；由已驗證 evidence 直接成立的事實性 finding 可維持事實陳述，任何 implementation inference 必須以 `推論：` 開頭並引用有效 Evidence ID。只引用 `human_premise` 且沒有 verified evidence 時，validator 必須強制 `推論：`；混合 evidence 時仍須標示實際推論，且不放寬既有引用／ID 檢查。
- 再次不足仍 WAIT_USER，不自動循環；validator 與 fail-closed gate 不放寬。

### 2026-09-02 核准修正

- `deep_discovery_fallback` 的可見選項改為「確認／取消」，共用 UI 另有「自行輸入…」；舊「同意」不列為選項，但可保留為 trim 後精確的隱藏相容輸入，等同「確認」。
- 選擇「取消」，或自行輸入 trim 後精確「取消」，清除本輪所有輸入與證據並回初始 `RECEIVE`；重用 `sessionState.reset()` 與 extension 外層清理，不使用 `cancelDeepKnowledge()`。一般 `deep_decision` 取消保留原契約。
- 不重新定義自由輸入；其他值維持等待／fail-closed。

## Files

本次修正預期最小 production：`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/extensions/forge-runtime.ts`；其餘檔案僅沿用既有契約，除非 RED 證明必要，不擴大範圍。

本次修正預期測試最小範圍：`forge-runtime/tests/runtime/session-state.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`；PI interactive 僅在實際 selector ingress 必要時補測，不預設擴大。

## Test matrix（2026-08-29 歷史基線）

Evidence 新增 2（目標 13）；extension 新增 6（目標 74 assertions）；PI 新增 1（目標 12）。公開 seam 需覆蓋自動 fallback、第二次 exact WAIT_USER、非明確回答、確認後 evidence 累積與 Understanding→Context Build、cancel／switch reset，以及 stale identity 不重入。此三檔矩陣與其數量屬歷史驗證基線，不是本輪預定實作範圍。

### 2026-09-02 現行驗證範圍

本輪預定驗證以最新 [`docs/PLAN-A.md`](../PLAN-A.md) 為準：至少涵蓋 `session-state.test.ts` 與 `forge-runtime-extension.test.ts` 的 option contract、selector／自行輸入精確「取消」full reset、確認路徑不回歸，以及 stale／duplicate 不重複 reset；PI interactive 僅在實際 selector ingress 證明必要時補測。

## Execution order

每個 slice 由獨立子代理先寫測試，獨立 runner 確認 RED，再由 production worker 做最小修改，獨立 runner 確認 GREEN；最後分開做 Standards 與 Spec review。第一步先讀 handoff、CONTEXT、ADR-0021、PLAN-A，展示摘要並等待使用者確認。

## Not building

不改 `pi-main/`、不新增 tool schema／Light Discovery tool／UI、不中止 validator、不做第三次自動 retry、不實作 CONTEXT_BUILD 下游。

## Verification（2026-08-29 歷史基線）

使用直接 tsx runner 驗證三檔，再執行 `npm run check` 與有界 `npm test`。記錄既有 21 個 `pi-main` `highlight.js` baseline 與 extension／full suite 背景 handle caveat，不宣稱 exit 0。以上僅保存歷史計畫；本輪命令與驗收條件以最新 [`docs/PLAN-A.md`](../PLAN-A.md) 為準。

## 2026-09-02 完成 criteria 與實際結果

- 完成 `deep_discovery_fallback` 可見選項「確認／取消」及共用「自行輸入…」；舊「同意」不顯示，僅保留隱藏相容輸入。
- 完成 selector 與 typed input 精確「取消」的 full reset：清除本輪輸入與證據、fallback markers／active workflow，回 `RECEIVE`。
- 確認路徑、一般 `deep_decision` cancel、stale／duplicate 不回歸，且不重複 reset。
- 實際 production：`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/extensions/forge-runtime.ts`。
- 實際 tests：`forge-runtime/tests/runtime/session-state.test.ts`（33/33）、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`（153/153）、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`（14/14）。完整 `npm test` 282/282；review 無阻擋 finding。
- `npm run check` 與第二段獨立 tsc 均 exit 2，僅受未修改 `pi-main` 的 `syntax-highlight.ts` 缺 `highlight.js` 型別 TS7016 阻擋；沒有待實作 slice。isolated verification 已完成：以 HEAD `fdccbd62403e40ba3400761bc0468668820a8059` 建 detached worktree，僅套用本 ticket 五個 code/test 檔 patch，未 install、未改 `pi-main`，`npm test` exit 0，282/282、0 fail/skip；worktree、junction 與 patch 已安全清理。
