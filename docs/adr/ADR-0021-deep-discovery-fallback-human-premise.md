---
title: Deep Discovery fallback with human premise
type: architecture-decision-record
scope: Forge Runtime Deep Retrieval／Knowledge Understanding 資料不足復原與 human premise Evidence
updated: 2026-09-02
source: 使用者核准的 Q1-Q5 契約、FORGE_RUNTIME_Arch_v4.md、ADR-0015、ADR-0016、ADR-0018、ADR-0020
status: implementation-complete-verified
---

# ADR-0021：Deep Discovery fallback 與 human premise

## 狀態

設計已核准，尚未實作或驗證；ticket：`deep-discovery-fallback-human-premise-20260829`。

## 背景

Deep Retrieval 或 Knowledge Understanding 可能判定資料來源不足。第一次不足應自動重用既有 Light Discovery→Grill；若再次不足，不能無限循環，也不能因沒有外部資料而錯殺全新專案。流程需要在保留證據可追溯性的前提下，讓使用者明確授權以需求與已取得資料作為後續推論基礎。

## 決策

本 ADR 明確限定並取代 ADR-0015「只有新 Evidence ID 才能建立新 Grill round」及 ADR-0016「`needs_discovery` 回到 `LIGHT_DISCOVERY`」的無條件敘述：第一次 fallback 可在沒有新外部 Evidence ID 時建立一次新的 source／Grill round；第一次之後改走本 ADR 的 `WAIT_USER`，不得自動循環。

### Narrow supersession

本 ADR 只在下列兩個窄範圍內取代一般規則；其他情況仍遵守 ADR-0015 與 ADR-0016：

1. **跨 snapshot 的 evidence 保留**：ADR-0015 的一般規則仍有效，fetched IDs 只屬當前 snapshot，candidate identity 改變即清除 snapshot-local fetched IDs。唯一例外是第一次 fallback 切 snapshot 前，將實際已驗證的 Evidence 內容複製進 workflow-local、以 `evidenceId` 去重的 fallback evidence accumulator；之後 snapshot-local IDs 照常清除。accumulator 只在同一 active workflow 使用，新 workflow、cancel 或 switch 清除，不得污染一般 Grill snapshot，也不是沿用舊 snapshot 的 fetched IDs。
2. **Deep 回 Grill 的固定 fallback 決策**：ADR-0016 的一般規則仍有效，任何尚未解決的新取捨、需求或矛盾都必須 `WAIT_USER` → Grill。唯一例外是第二次資料不足的固定問題已由 Workflow 提出，且使用者以整句同意／確認完成該人類決策；此時已沒有未解取捨，可由 `USER_CONFIRMED` 進入 `KNOWLEDGE_UNDERSTANDING`。若 Understanding 後又出現新的取捨或矛盾，仍回一般 `WAIT_USER` → Grill；若只是再次 `needs_discovery`，則再進同一 fallback `WAIT_USER`，不自動循環。

1. 每個 active workflow 對 Retrieval 與 Understanding 合併計算 `needsDiscoveryCount`；新 workflow、cancel、switch 清零。
2. 第一次 `needs_discovery` 自動重用 Light Discovery→Grill，不需要 `/continue`；原 Deep identity 立即 stale/block。
3. 第二次及之後不再自動啟動第三輪，從仍在 Deep phase 正式進入 `WAIT_USER`，`kind=deep_discovery_fallback`，問題固定為：`此專案資料來源不足，將以前次grill/ 資料來源所得之證據進行後續開發，請確認`。
4. 新 kind 只接受 trim 後整句 `同意` 或 `確認`。其他回答、空白與重複回答維持 `WAIT_USER`，不重複推進；不修改舊 WAIT_USER parser。
5. 明確同意後建立 fresh Deep identity，phase=`KNOWLEDGE_UNDERSTANDING`；active tool 只允許 `forge_deep_complete`，不重跑 Retrieval。`USER_CONFIRMED → KNOWLEDGE_UNDERSTANDING` 是正式 state transition；Understanding 完成且 validator 通過才進 `CONTEXT_BUILD`。
6. 同一 workflow 累積兩輪所有真實 Grill／Deep evidence，依 `evidenceId` 去重，跨 snapshot 保留；新 workflow、cancel、switch 清除。
7. 即使沒有外部來源，也建立一筆 `human_premise` Evidence：內容含原始 workflow goal、固定問題與明確回答，`source=forge://human-premise`，metadata 含 `needsDiscoveryCount` 與 `sourceRoundIds`，並讓決策引用它。它不是外部事實。
8. `EvidenceOrigin` 增加 `human_premise`，validator 不放寬。由已驗證 evidence 直接成立的事實性 finding 可維持事實陳述；任何 implementation inference 都必須以 `推論：` 開頭並引用至少一個有效 Evidence ID。若 finding 只引用 `human_premise`、沒有 verified evidence，validator 必須要求 `推論：`；混合 evidence 時仍由 prompt／契約要求模型標示實際推論，不得把推論偽裝成事實。既有引用與 ID 檢查不放寬，否則拒絕。
9. 後續再次 `needs_discovery` 仍停留 `WAIT_USER`，不自動循環。

## 範圍

Production 五檔：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/src/workflow/state-machine.ts`、`forge-runtime/src/ui/ui-state.ts`、`forge-runtime/src/evidence/evidence-engine.ts`。

Tests 三檔：`forge-runtime/tests/evidence/evidence-engine.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`。

## 不建置

不修改 `pi-main/`；不新增公用 Deep tool schema、新 Light Discovery tool、新 UI／Plan B、validator 放寬、第三次自動 retry、CONTEXT_BUILD 下游實作或舊 WAIT_USER 全面 parser 重構。

## 後果與風險

創新專案可在使用者明確同意後繼續；只引用 human premise 且沒有 verified evidence 的 finding 必須標為推論並引用 human premise。由已驗證 evidence 直接成立的事實性 finding 可維持事實陳述；混合 evidence 時仍須標示實際推論。若 `deliverAs: followUp` 在 active tool turn 會重入、evidenceId 無法跨 snapshot 穩定去重，或 fallback identity／prompt 被 provider 當成自由文字路由，必須停下並修正設計，不得放寬 gate。

## 驗收

Evidence baseline 11 加 2；extension baseline 68 加 6；PI baseline 11 加 1。所有 slice 依 TDD 先 RED、再最小 production、獨立 GREEN，最後分離 Standards／Spec review。驗證保留既有 21 個 `pi-main` `highlight.js` baseline 與背景 handle caveat，不宣稱完整 suite exit 0。

## 關聯

本 ADR 補充 ADR-0015 的 Deep 不直接向使用者提問邊界，並細化 ADR-0016 的 evidence origin／validator 與 state transition；同時對稱記錄上述 supersession，明確取代兩份舊 ADR 的無條件敘述。遵守 ADR-0018 的 retry／stale 原則與 ADR-0020 的 WAIT_USER UI-only publication。

## 實作與驗證狀態（2026-08-30）

本 ADR 已完成實作與驗證。Evidence Package 支援並驗證 `human_premise`；Retrieval／Understanding 共用 `needsDiscoveryCount`；第一次 `needs_discovery` 經正式 `tool_result` transform 自動重跑 Light Discovery→Grill，第二次進精確問題的 `WAIT_USER`，只接受 trim 後完整 `同意`／`確認`。確認後建立新的 Knowledge Understanding identity，只允許 `forge_deep_complete`。

Grill／Deep evidence 跨第一次 snapshot switch 累積並依 ID 去重，在 cancel、switch、new workflow、reset 清除。human premise 記錄 goal、question、answer、`needsDiscoveryCount`、兩輪 `sourceRoundIds`，decision 引用該 premise。READY_FOR_DEEP 使用 terminate 與 pending settled invocation，在 `agent_settled` 的下一個 task 送普通 user message，再重驗 identity／stage／tools；pending handoff 關閉 Deep tool gate；WAIT_USER publication await；`message_end` callback 帶 ctx；fallback 無 locked evidence 的 `needs_decision` 將兩個 accumulator keys 視為合法 evidence。

Evidence 13/13、Session State 22/22、Extension 142/142、PI interactive 12/12、`npm test` 248/248；Standards／Spec 獨立審查均 PASS。`npm run check` exit 1 的唯一失敗為未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21` 缺少 `highlight.js` declaration（TS7016）；Forge Runtime 自身零錯誤，不修改 `pi-main`。

## 2026-09-02 dated amendment：取消與可見選項

本次核准修正只針對 `deep_discovery_fallback`：可見選項固定為「確認」與「取消」，共用 UI 另追加「自行輸入…」；「同意」不再列為 UI 選項。為最小相容變更，既有 trim 後精確「同意」可保留為隱藏輸入，語意等同「確認」，不得在提示或 selector 顯示。

選擇「取消」，或經「自行輸入…」輸入 trim 後精確「取消」，必須清除本輪所有輸入與證據並回到初始 `RECEIVE`。實作必須重用 `sessionState.reset()`（`forge-runtime/src/runtime/session-state.ts:720-741`）及既有 extension 外層清理；不得沿用 fallback 專用 `cancelDeepKnowledge()`，因其保留輸入／證據的契約不符合本案。一般 `deep_decision` 的取消仍維持保留輸入的既有契約。

本 amendment 不重新定義其他自由輸入內容；trim 後不是上述精確值時維持既有 fail-closed／等待行為。此變更影響正式 Workflow state，採單一 Plan A，不建立 Plan B。

## 2026-09-02 amendment 實作與驗證

本 amendment 已完成實作。`session-state.ts` 將 fallback options 固定為「確認／取消」；`forge-runtime.ts` 在 shared resume ingress 對 trim 後精確「取消」執行 fallback-specific full cleanup、`sessionState.reset()` 與 active workflow 清除，回到 `RECEIVE`。共用「自行輸入…」遵循相同精確 cancel 路徑；trim 後精確「同意」僅作隱藏相容輸入。一般 `deep_decision` 取消仍使用原有 `cancelDeepKnowledge()`。

驗證證據：`forge-runtime/tests/runtime/session-state.test.ts` 33/33、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 153/153、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts` 14/14、完整 `npm test` 282/282；review 無阻擋 finding。`npm run check` 與第二段獨立 tsc 均 exit 2，唯一原因是未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts` 的 `highlight.js` TS7016；不得修改上游。isolated verification 已完成：以 HEAD `fdccbd62403e40ba3400761bc0468668820a8059` 建 detached worktree，僅套用本 ticket 五個 code/test 檔 patch，未 install、未改 `pi-main`，`npm test` exit 0，282/282、0 fail/skip；worktree、junction 與 patch 已安全清理。
