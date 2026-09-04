---
title: 零候選探索性路由
type: architecture-decision-record
scope: Light Discovery 零候選、human premise、探索性開發與 Spec Gap 路由
updated: 2026-09-05
source: 使用者核准、ADR-0021、ADR-0025、ADR-0026、ADR-0028、docs/PLAN-A.md
status: implemented-completed-check-blocked
---

# ADR-0029：零候選探索性路由

## Context

Light Discovery 可能得到 `matches=[]`。零候選代表沒有可供 evidence tool 驗證的 candidate，不應把不存在的 candidate 送入既有 evidence tool，也不應因此封鎖全新產品。這次只處理零候選入口的最小分流。

## Decision

1. `matches=[]` 時直接沿用 `pendingKnowledgeRequest`，不呼叫不存在 candidate 的 evidence tool。
2. 只有明確人類確認才保留已確認的 `human_premise`，進入既有 exploratory Deep 路徑，並建立 non-blocking `Spec Gap`。
3. 拒絕、空白或模糊回答維持 `WAIT_USER`，不得自行推進或建立 premise。
4. 有候選的既有 Light→Grill→Deep 路徑完全不變；Evidence validator 維持 fail-closed，不新增頂層 state、command 或 service。
5. `human_premise` 只證明使用者意圖，不證明 API、協定、安全、法規或相容性；不得升為 `spec_verified`。
6. `forge_deep_complete` schema／params／`createEvidencePackage` 接上既有 `verificationLevel`／`specGap`／`formalSpecReference`；不重做 Evidence engine。
7. `TO_SPEC` 不在本 ADR 範圍內，仍遵守 ADR-0028 的人工確認邊界。

## 2026-09-05 追加決策：共用 consent 與 stale recovery

8. 缺少來源 gate 與空 snapshot gate 共用同一個 workflow-scope exploration consent；同一次 workflow 只問一次。新 workflow、cancel、reset、switch 清除 consent，其他人類決策不沿用。
9. `CONTEXT_BUILD` 的 stale completion 維持 fail-closed；第一次 stale 在下一次 `agent_settled` 以目前有效 identity 自動 replay 一次。再次 stale 不自動循環，僅由 `/forge-runtime continue` 明確恢復目前有效 invocation。
10. 最脆弱假設是 stale terminate 後必定觸發 `agent_settled`；若 RED 證明不成立，採 continue-only recovery，不新增 queue。

本追加決策不改變有候選的 Light→Grill→Deep 路徑，也不新增 ADR-0030；實作與驗收見 [`zero-candidate-context-build-recovery-20260905`](../tickets/zero-candidate-context-build-recovery-20260905.md)。

## 2026-09-05 實作結果

- exploration consent 已在同一 workflow 跨缺少來源 gate 與空 snapshot gate 共用，並於 cancel、new workflow、switch、reset 清除；其他人類決策不沿用。
- stale completion 仍 fail-closed；第一次 stale 在下一個 `agent_settled` 只重播目前 identity 一次，第二次不循環，`/forge-runtime continue` 只人工重播目前 identity。
- 未修改 `session-state`、`pi-main`、queue 或 UI。focused 4/4、`npm test` 333/333、主 tsconfig pass；兩個獨立 review PASS。
- 正式 `npm run check` 唯一阻塞為既有上游 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 的 highlight.js 子路徑缺少型別，共 20 個 TS7016；未知舊 invocation 來源未寫成已證實根因。

## Scope

Production：`forge-runtime/extensions/forge-runtime.ts`。Tests：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。後者以非空 fixture 恢復三個既有 TUI grill-2／retry 契約，不是新增空知識 feature test。核心 seam 為 `resumeGrillWithAnswer` 在空 snapshot 時保留已確認 premise，呼叫既有 `continueDeepKnowledge(..., true)`，並沿用 `pendingKnowledgeRequest`。不修改 `session-state`、`evidence-engine` 或 `context-build-skill`。

## Building

- 零候選的明確確認分支。
- human premise 保留與 exploratory Spec Gap 傳遞。
- 既有 Deep completion 欄位 wiring。
- 零候選明確同意／拒絕、顯式 Spec Gap 傳遞、自動 Spec Gap 預設與孤立 formal reference 拒絕回歸測試；有候選 TUI 舊契約回歸。

## Not Building

- 有候選流程改寫、Evidence validator 放寬或虛構 candidate。
- 額外頂層 state／command／service、UI、TO_SPEC／TO_TICKET。
- trusted formal-spec importer、generic execution guard 或任何 `pi-main/` 修改。

## Consequences

新產品在缺少知識文件時，經明確確認即可進 exploratory 開發；正式相容性與外部事實仍由 Spec Gap 限定。拒絕或不清楚的輸入停在 `WAIT_USER`，既有有候選流程不受影響。

本 ADR 的零候選直進是 `FORGE_RUNTIME_Arch_v4.md` 所明文化的窄例外；一般 `NEEDS_CONFIRMATION` 仍須下一輪 Grill，不得由本 ADR 推廣放寬。

## Verification contract

以下命令均從 `forge-runtime` 目錄執行。以下兩個 RED 與 targeted 282 是核准時的歷史執行計畫；最終由正式 full 329/329 supersede，不代表本輪另有 targeted 282 實際結果：

1. RED 1：`.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 --test-name-pattern="Extension_WhenEmptyDiscoveryHasHumanConfirmation_ShouldEnterDeepWithoutSecondGrillRound" tests/extensions/forge-runtime-extension.test.ts`；期望該測試先失敗。
2. RED 2：`.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 --test-name-pattern="Extension_WhenDeepCompleteProvidesExploratorySpecGap_ShouldPropagateToEvidencePackage" tests/extensions/forge-runtime-extension.test.ts`；期望該測試先失敗。
3. 相關完整批次：`.\node_modules\.bin\tsx.cmd --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/discovery/light-discovery.test.ts tests/evidence/evidence-engine.test.ts tests/runtime/session-state.test.ts tests/extensions/forge-runtime-extension.test.ts tests/extensions/pi-grill-interactive.test.ts tests/grill/grill-result.test.ts tests/knowledge/discovery-evidence.test.ts`；歷史計畫預期 282 passed，本輪未另宣稱已執行。
4. 全套：`npm test`；期望 0 failed。
5. 靜態：`npm run check`；只允許既知未修改 `pi-main` 的 highlight.js TS7016，不得有新增 Forge Runtime error，也不得修改 `pi-main`。

## Links

連結 [`ADR-0021`](ADR-0021-deep-discovery-fallback-human-premise.md)、[`ADR-0025`](ADR-0025-grill-soft-cap-human-checkpoint.md)、[`ADR-0026`](ADR-0026-spec-gap-exploratory-development.md)、[`ADR-0028`](ADR-0028-official-documents-and-to-spec-confirmation-boundary.md)。

## Final synchronization（2026-09-04，歷史證據）

- 狀態：`implemented-verified-completed`。正式 `npm test` 以 `.tmp/full-test-final8-0904.log` 為準：329 passed、0 failed、0 skipped、34635.325 ms，僅有既有 DEP0190 warning；`npm run check` 以 `.tmp/check-final7-0904.log` 為準：exit 2，21 個 TS7016 全在未修改上游 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21`，本輪三個 Forge 檔 0 error。此段證據已由 2026-09-05 final9/check8 取代，保留作歷史紀錄。
- `forge-intent-context-flow.html` 已同步本 ADR 的空 manifest opt-in、明確同意直進 Deep、拒絕／模糊 `WAIT_USER`、有候選 Grill-2、exploratory Spec Gap 與 TO_SPEC 未實作；它是衍生視圖，不是 runtime 行為來源。release validation `.tmp/intent-flow-release-validation-20260904.log` 顯示兩尺寸 overflow 皆為 0；未修改 `forge-runtime-flow.html`。

## Final synchronization（2026-09-05）

- 狀態：`implemented-verified-completed`。正式 `npm test` 以 `.tmp/full-test-final10-0905.log` 為準：329 passed、0 failed、0 skipped、duration_ms 30778.2386；`npm run check` 以 `.tmp/check-final9-0905.log` 為準：exit 2，21 個 TS7016 僅在未修改上游 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21`，Forge 三檔 0 error。
- 修改範圍：production、兩個 tests 與 `forge-intent-context-flow.html`；一般 `NEEDS_CONFIRMATION` 仍須下一輪 Grill，只有空 `matches` 固定 opt-in 的明確肯定可直進既有 Deep。TO_SPEC 無 executor，未 commit／push。

## Implementation result（2026-09-04）

### 現行執行紀錄（取代歷史計畫）

- 五個新增 extension tests：明確同意進 Deep、拒絕仍等待、顯式 Spec Gap 傳遞、自動補 exploratory／Spec Gap、孤立 `formalSpecReference` 拒絕。
- 實際 RED：自動補 exploratory／Spec Gap；孤立 `formalSpecReference` guard。原先核准計畫中的兩個 RED 僅保留為歷史紀錄。
- 最終驗證以正式 full 329/329 為準；未將 targeted 282 寫成已執行。

- `matches=[]` 的人類確認使用固定 marker 與固定文案；UI 固定選項為「同意／不同意」，runtime 沿用 `isApproval`（trim 後接受「好、可以、同意、照做、yes、ok、okay、y」；英文先 lowercase），只有這些明確肯定才記錄 premise 並直接重用既有 Deep handoff；包含「確認」的其他字串不屬於此 opt-in。
- 空快照、無外部 evidence 且三項 metadata 全省略時，extension 自動補 exploratory 與 deterministic non-blocking Spec Gap；不完整 metadata 組合 fail-closed，不改 Evidence validator。
- 完整驗證以 `.tmp/full-test-final10-0905.log` 為準：`npm test` 329 passed、0 failed、0 skipped、30778.2386 ms；`npm run check` 以 `.tmp/check-final9-0905.log` 為準：exit 2，21 筆 TS7016 全在未修改上游 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21`，本輪三個 Forge 檔 0 error。未實作 TO_SPEC，未修改 `pi-main`。
