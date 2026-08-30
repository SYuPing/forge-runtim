---
title: Deep Discovery fallback human premise
type: ticket
scope: Forge Runtime Deep Retrieval／Knowledge Understanding 資料不足復原
updated: 2026-08-29
source: ADR-0021、使用者核准契約、docs/PLAN-A.md
status: design-approved-ready-for-red
---

# Ticket：deep-discovery-fallback-human-premise-20260829

## Goal

第一次資料不足自動重做 Light Discovery→Grill；第二次起以固定問題等待使用者確認。確認後以累積證據與 `human_premise` 進入 Knowledge Understanding，通過 validator 後完成 `CONTEXT_BUILD`。

## Contract

- Retrieval／Understanding 合併計 `needsDiscoveryCount`；新 workflow、cancel、switch 清零。
- 第一次自動 fallback 並使舊 Deep identity stale；第二次及之後 `WAIT_USER`，`kind=deep_discovery_fallback`。
- 只接受 trim 後整句 `同意` 或 `確認`；固定問題完全等於：`此專案資料來源不足，將以前次grill/ 資料來源所得之證據進行後續開發，請確認`。
- 同意後建立 fresh Understanding identity，只允許 `forge_deep_complete`；累積 evidence 依 ID 去重。
- 無外部來源仍建立 `human_premise` Evidence；由已驗證 evidence 直接成立的事實性 finding 可維持事實陳述，任何 implementation inference 必須以 `推論：` 開頭並引用有效 Evidence ID。只引用 `human_premise` 且沒有 verified evidence 時，validator 必須強制 `推論：`；混合 evidence 時仍須標示實際推論，且不放寬既有引用／ID 檢查。
- 再次不足仍 WAIT_USER，不自動循環；validator 與 fail-closed gate 不放寬。

## Files

Production：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/src/workflow/state-machine.ts`、`forge-runtime/src/ui/ui-state.ts`、`forge-runtime/src/evidence/evidence-engine.ts`。

Tests：`forge-runtime/tests/evidence/evidence-engine.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。

## Test matrix

Evidence 新增 2（目標 13）；extension 新增 6（目標 74 assertions）；PI 新增 1（目標 12）。公開 seam 需覆蓋自動 fallback、第二次 exact WAIT_USER、非明確回答、確認後 evidence 累積與 Understanding→Context Build、cancel／switch reset，以及 stale identity 不重入。

## Execution order

每個 slice 由獨立子代理先寫測試，獨立 runner 確認 RED，再由 production worker 做最小修改，獨立 runner 確認 GREEN；最後分開做 Standards 與 Spec review。第一步先讀 handoff、CONTEXT、ADR-0021、PLAN-A，展示摘要並等待使用者確認。

## Not building

不改 `pi-main/`、不新增 tool schema／Light Discovery tool／UI、不中止 validator、不做第三次自動 retry、不實作 CONTEXT_BUILD 下游。

## Verification

使用直接 tsx runner 驗證三檔，再執行 `npm run check` 與有界 `npm test`。記錄既有 21 個 `pi-main` `highlight.js` baseline 與 extension／full suite 背景 handle caveat，不宣稱 exit 0。
