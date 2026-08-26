---
title: Deep Knowledge Retrieval／Understanding／Evidence Package ticket state
type: agent-state
scope: deep-knowledge-retrieval-understanding-20260824
updated: 2026-08-25
source: 使用者核准設計、ADR-0016、docs/PLAN-A.md、docs/handoff.md
status: implemented-and-verified
---

# Deep Knowledge Retrieval／Understanding ticket state

## 已完成項目

- 已完成 Q1–Q21 設計討論與使用者確認。
- 已建立 ADR-0016，明確擴充 ADR-0015 的 full semantic Deep 與 Deep result type 範圍。
- 已更新 CONTEXT、Plan A、handoff 與 Memory/record，形成可直接接手的實作基線。
- 已建立第一個紅燈測試 `EvidencePackage_WhenInheritedAndSupplementalEvidenceMerge_ShouldPreserveOrigins`；測試命令 exit 1，確認進入實作階段。
- 第一個測試 `EvidencePackage_WhenInheritedAndSupplementalEvidenceMerge_ShouldPreserveOrigins` 已由紅轉綠。

## 重要決策

- Grill 提供決策所需最小證據；Deep 只沿用實際引用的完整 evidence／immutable decisions，不重讀相同 evidence。
- Deep 分為 Retrieval 與 Knowledge Understanding；後者只能讀 Retrieval 鎖定的證據集合。
- Evidence Package 由 inherited／supplemental evidence、decisions、findings、非阻擋 limitations 組成；completed 必須通過 deterministic validator。
- 結果為 `completed`、`needs_decision`、`needs_discovery`；`needs_decision` 經 Workflow → `WAIT_USER`，`needs_discovery` 回 `LIGHT_DISCOVERY`。
- 沿用主 session active model；不做模型派發、fallback、custom loop、第二 verifier 或 `pi-main/` 修改。
- 使用者已核准 `createEvidencePackage({ inherited, supplemental, decisions, findings, limitations })` 與 `validateEvidencePackage(package)` 兩個 public seams：前者自動標記 origin、固定 inherited 後 supplemental 順序且不公開 merge；後者以 `{ ok: true }`／`{ ok: false, errors: string[] }` 回傳驗證結果，不 throw。
- Evidence 欄位為 `evidenceId`、`kind: string`、`source`、`title`、`content`、`metadata: Record<string, unknown>`、`origin: "grill" | "deep_retrieval"`；limitation 為 `{ statement: string, blocking: boolean }`，blocking 不得完成；package 內 ID 唯一，finding 至少引用且只能引用存在 ID。
- retry 保留 `sourceRoundId`、只換 `attemptId`；第一個測試名稱固定為 `EvidencePackage_WhenInheritedAndSupplementalEvidenceMerge_ShouldPreserveOrigins`。詳細契約見 [`ADR-0016`](../docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md)。
- 使用者於 2026-08-25 已核准 Deep Session State 行為：狀態只放在 `ForgeSessionState`，public test seam 沿用或擴充該 state，不新增 UI state interface；方法命名留在最小實作細節。
- identity 為 `attemptId + sourceRoundId + phase`；retry 保留 `sourceRoundId`、current input 與同 snapshot 的 supplemental evidence，只換 `attemptId`；stale call 回傳可辨識結果而非 throw。
- cancel 清除 active attempt 但保留 current input；換新 snapshot 時清除舊 supplemental evidence。snapshot 沿用 immutable object identity，不新增 hash 或持久化 ID。
- Session State 使用 supplemental ID set 與 identity-aware record/get；開始新 round 會使舊 attempt 失效，只有 snapshot object identity 改變時才清除 supplemental evidence。

### 2026-08-25 Workflow 分流核准

- 使用者已核准 `ForgeSessionState.handleDeepResult(identity, result)` 作為唯一 Workflow public seam。
- `result` 僅有 `completed`、`needs_decision`、`needs_discovery`；technical failure 走 cancel／no-op，不改變原 Deep phase，保留 input 等待 `/continue`。
- `completed` 依 phase 轉移 Retrieval → Understanding、Understanding → `CONTEXT_BUILD`。
- `needs_decision` 建立 `kind: deep_decision` 的新 `WAIT_USER` round，`roundId` 使用目前 `attemptId`，保留 input／evidence 並使該 attempt 後續呼叫 stale；`needs_discovery` 進入 `LIGHT_DISCOVERY` 並結束 attempt；stale 靜默不改 state。
- StateMachine 只增加合法轉移；Orchestrator 只映射 result，不持有 attempt／evidence。
- public test seam 已補定；第一個 Workflow 紅燈測試為 `StateMachine_WhenRetrievalCompletes_ShouldEnterKnowledgeUnderstanding`。

## 修改檔案

- `CONTEXT.md`
- `docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md`
- `docs/PLAN-A.md`
- `docs/handoff.md`
- `Memory/record.md`
- `agent-state/deep-knowledge-retrieval-understanding-20260824.md`

- 本里程碑未修改未追蹤 UI 檔案。
- 本里程碑 production 修改 `forge-runtime/src/evidence/evidence-engine.ts`，並修改 `forge-runtime/src/runtime/session-state.ts` 與必要的 extension caller，建立已核准型別、origin 合併及 stale-call 狀態防護。

## 測試結果

- 第一個 Evidence Package 單檔測試 exit 0，1/1 passed；`EvidencePackage_WhenInheritedAndSupplementalEvidenceMerge_ShouldPreserveOrigins` 已驗證 inherited→supplemental 的 origin 合併。
- 重複 Evidence ID 測試已由紅轉綠：紅燈原因為缺少 export；綠燈命令 exit 0，evidence-engine 2/2 passed。
- Finding 引用未知 Evidence ID 測試已由紅轉綠：紅燈時 2 pass/1 fail；加入 production validator 的 finding 引用存在性檢查後，綠燈命令 exit 0，evidence-engine 3/3 passed。
- Blocking limitation 測試已由紅轉綠：紅燈時 3 pass/1 fail；加入 blocking limitation 規則後，綠燈命令 exit 0，evidence-engine 4/4 passed。
- Origin 對應測試修正後，紅燈結果為 3 pass/1 fail；失敗原因是 actual 使用 `inherited`／`supplemental`，但 expected 應為 public origin `grill`／`deep_retrieval`。Production 修正為 `inherited` → `grill`、`supplemental` → `deep_retrieval` 後，綠燈命令 exit 0，evidence-engine 4/4 passed。
- Evidence Engine 的 PLAN-A 四個測試均已完成並通過：origin 合併、duplicate Evidence ID、unknown finding reference、blocking limitation。
- Stale-call 紅燈初始結果為 11 pass/1 fail，失敗原因是缺少 `currentDeepAttempt`；第一次綠燈仍為 11/1，確認 attempt 初始化 patch 誤落在 `recordAnswer`。將初始化移回 `beginDeepKnowledge` 後，命令 exit 0，12/12 通過。
- Stale call 現在回傳 `kind: "stale"` 且不修改 stage；這是本里程碑已驗證的行為。
- `SessionState_WhenContinueRetriesDeep_ShouldIssueNewAttemptId` 首次即綠：測試命令 exit 0，13/13 通過。前一 stale-call slice 已驗證必要的 identity 輪替，因此 retry 會更新 `attemptId`，並保留 `sourceRoundId` 與 current input；本次 production 無新增變更。
- `SessionState_WhenCancelDeepKnowledge_ShouldClearAttemptAndPreserveState` 紅燈結果為 13 pass/1 fail，失敗原因是缺少 `cancelDeepKnowledge` 方法。Production 新增 cancel 行為，只清除 active attempt、保留 current input 與既有 state；綠燈命令 exit 0，14/14 通過。
- snapshot／supplemental 測試紅燈結果為 14 pass/1 fail，失敗原因是缺少對應 Session State 方法；production 新增 supplemental ID set、identity-aware record/get，並在開始新 round 時使舊 attempt 失效，僅於 snapshot object identity 改變時清除 supplemental evidence。綠燈命令 exit 0，15/15 通過。
- Session State 的 PLAN-A 四個測試均已完成並通過：stale call、retry 新 attempt ID、cancel 保留 current input、snapshot 變更清除 supplemental evidence。
- Workflow Retrieval-completed 紅燈初始結果為 3 pass/1 fail，失敗原因是缺少 `handleDeepResult`。
- Workflow Retrieval-completed 綠燈已完成：production 只新增 `completed` seam，重用既有 `completeDeepKnowledge`；驗證命令 exit 0，workflow 4/4 通過。
- Workflow Understanding-completed 紅燈已完成：4 pass/1 fail，失敗原因是 Understanding 完成後尚未轉移至 `CONTEXT_BUILD`。
- Workflow Understanding-completed 綠燈已完成：`handleDeepResult` 依目前 phase 將 Understanding 完成導向 `CONTEXT_BUILD`，並清除 active attempt；驗證命令 exit 0，workflow 5/5 通過。
- Workflow `needs_decision` 紅燈已完成：5 pass/1 fail，實際仍停留在 Understanding，預期為新的 `WAIT_USER` round。
- Workflow `needs_decision` 綠燈已完成：production 新增 `deep_decision` round kind、Deep → `WAIT_USER` 合法轉移，round 綁定 `attemptId` 並保存 payload，建立後清除 active attempt；驗證命令 exit 0，workflow 6/6 通過。
- Workflow `needs_discovery` 紅燈已完成：6 pass/1 fail，actual 仍停留在 `UNDERSTANDING`，預期進入 `LIGHT_DISCOVERY`。
- Workflow `needs_discovery` 綠燈已完成：production 新增 `needs_discovery` result type、Retrieval／Understanding 兩個 Deep phase 到 `LIGHT_DISCOVERY` 的合法轉移，並清除 active attempt、保留 current input 與既有 state；驗證命令 exit 0，workflow 7/7 通過。
- Workflow technical failure 測試首次即綠：驗證命令 exit 0，8/8 通過。既有 Session cancel／stale 行為已涵蓋 technical failure 的「保留原 Deep phase、保留 state、等待 `/continue`」契約，因此 production 無新增變更。
- Workflow 的 PLAN-A 五個測試均已完成並通過：Retrieval completed、Understanding completed、`needs_decision`、`needs_discovery`、technical failure。
- Integration milestone 1 紅燈：新增 `Integration_WhenDeepSearchUsesAllowedSources_ShouldReturnAtMostThreeEvidence`；測試命令 exit 1，失敗原因是 `forge_deep_search` 尚未註冊。
- Integration milestone 1 綠燈：production 在 `forge-runtime/extensions/forge-runtime.ts` 註冊最小 `forge_deep_search`，限制 `wiki`／`code_base`／`target` schema，wiki／code_base 搜尋最多 3 筆，加入 identity stale guard 與 runtime 產生的 supplemental ID；同時移除 Deep Retrieval 自動完成，保留工具窗口，並把直接 Grill 完成路徑切到 Deep Retrieval active tools。單測命令 exit 0，1/1 passed。
- 本 slice 的 target 搜尋目前回傳空陣列，後續由 target ambiguity 測試驅動；`WAIT_USER` confirmation 的 active-tool 切換仍待 lifecycle slice 驗證。
- 已知 baseline：`forge-runtime` 目前 `npm test` 為 157；本 ticket 規劃新增 21 個測試，預期 178，但不得視為實際結果。

## 未解問題

- 主 session active model 的既有工具輪次是否可安全切換 Retrieval／Understanding 工具，需由實作與驗證確認。
- target source 的明確檔案辨識需維持 fail-closed；不能猜測路徑。
- 模型語意完整性仍未驗證，第二 verifier 另案。

### 2026-08-25 Integration 契約核准

- `forge_deep_search` 接收 attempt identity、query 與單一 `source: wiki | code_base | target`，每次最多 3 筆；target 必須唯一匹配 snapshot 中的明確 target source，缺失／多義回 `needs_decision`。supplemental ID 由 runtime 產生，既有 inherited／supplemental evidence 重用，不重讀、不重複。
- `forge_deep_retrieval_complete` 接收 attempt identity 與 `completed`／`needs_decision`／`needs_discovery` outcome；completed 鎖定全部實際 inherited＋accepted supplemental evidence，模型不可任選並轉 Understanding；其他 outcome 走 `handleDeepResult`。
- `forge_deep_complete` 接收 attempt identity 與同一 outcome；completed 只收 decisions/findings/limitations，由 runtime 注入 locked evidence 並驗證 Evidence Package，成功轉 `CONTEXT_BUILD`，invalid 不轉移；其他 outcome 走 `handleDeepResult`。
- Retrieval 只開 search＋retrieval-complete，Understanding 只開 deep-complete；完成、decision/discovery 或 cancel 後恢復原 active tools；無法安全限制時拒絕啟動 Deep。技術失敗走 cancel／no-op，保留 input/evidence；stale 安靜忽略。
- Integration 測試採 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 現有輕量 `registeredTools` harness，不啟動完整 TUI；這是核准的最小測試接縫。

## 已驗證問題（先前未修復；現已修復）

- 已確認先前測試與 production 將輸入分類 `inherited`／`supplemental` 誤當成 public `origin`；文件真相是 `inherited` 對應 `grill`、`supplemental` 對應 `deep_retrieval`。證據：`CONTEXT.md:72-73`、`docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md:38-40`、`docs/PLAN-A.md:1277-1279`。這是已驗證根因，尚未代表已修復。
- 已完成修復：測試 expected 與 production origin mapping 均改為 `inherited` → `grill`、`supplemental` → `deep_retrieval`；修復後 evidence-engine 4/4 通過，命令 exit 0。
- 已完成修復：attempt 初始化 patch 曾誤落在 `recordAnswer`，造成 stale-call slice 缺少 `currentDeepAttempt`；已移回 `beginDeepKnowledge`。證據：`forge-runtime/src/runtime/session-state.ts`、必要 extension caller 與 stale-call 測試；修復後 exit 0、12/12 通過。

## 下一步

## 2026-08-25 最終實作與驗證收尾

### 已完成項目

- Deep Retrieval／Understanding 與 Evidence Package 完成；五個工具已註冊：兩個 Grill、三個 Deep。
- identity、retry／cancel／continue、stale quiet reject、active-tools fail-closed、人類決策不可覆寫與 Evidence Package deterministic validation 均完成。
- 固定安全上限完成：query 1500 Unicode code points、每 source／Grill round 8 次搜尋且 retry／cancel 不重設、單筆 256 KiB、整輪 2 MiB、各類 50 筆、每段 statement 4,000 code points；讀檔前 stat，超限不改 state。

### 重要決策

- retry 保留 sourceRound、回原 Deep phase；cancel／continue 保留 input／evidence，不回 Grill。
- 人類決策格式精確為 `問題：…；決定：…`，同 decisionId 首筆不可覆寫；package 先注入 human decisions，模型 duplicate ID 拒絕。
- 每次來源搜尋最多 3 個候選仍是呈現／候選上限，不取代 Evidence Package 每類 50 筆安全上限。

### 修改檔案

- Production：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/src/evidence/evidence-engine.ts`、`forge-runtime/src/discovery/discovery-sources.ts` 及相關 package／schema／測試檔案。
- 文件：`forge-runtime/README.md`、`CONTEXT.md`、`docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md`、`docs/PLAN-A.md`、`docs/handoff.md`、`Memory/record.md`、`Memory/lesson_learn.md`、本狀態檔。

### 測試結果

- 初次 Deep 實作 `npm test`：208/208；identity handoff follow-up 完成後完整 suite：209/209。
- `npm run check`：exit 0。
- `git diff --check`：exit 0，僅 LF／CRLF warning。
- 完整 logs：`C:\Users\User\AppData\Local\Temp\forge-full-final3.log`、`C:\Users\User\AppData\Local\Temp\forge-check-final3.log`、`C:\Users\User\AppData\Local\Temp\forge-runtime-diffcheck-final2-20260825.log`；focused logs：`forge-stale-capability-green.log`、`forge-final-review-regressions-final.log`、`forge-grill-guard-green.log`。
- Final review：Standards 唯一 hard finding 是 README tool 清單過時，已修正；Divergent Change／Repeated Switches 是固定三來源與 Ponytail/YAGNI 下的 judgement call；Spec 無 production 缺口；adversarial 無 P0/P1。

### 未解問題

- 無本 ticket 的文件或 production blocker。尚未 commit、未 staged；需使用者檢閱並決定是否 commit。

### 下一步

- 使用者檢閱交付內容，決定是否 commit；在此之前不再新增實作。

（歷史快照）當時下一步是建立 Understanding complete 的 valid `EvidencePackage` 紅燈測試並完成最小 production slice；該工作已在本檔最終收尾中完成。

## 2026-08-25 Integration milestone 1

- 已完成項目：`forge_deep_search` 的 allowed-sources 最小 slice 已由紅轉綠；工具可接受 identity、query 與單一來源，wiki／code_base 最多回傳 3 筆，並記錄 runtime 產生的 supplemental ID。
- 修改檔案：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、本狀態檔。
- 測試結果：`Integration_WhenDeepSearchUsesAllowedSources_ShouldReturnAtMostThreeEvidence` 紅燈 exit 1（未註冊工具）；production 實作後單測綠燈 exit 0，1/1 passed。
- 未解問題：target 在此 slice 尚回空陣列；target ambiguity 與 `WAIT_USER` confirmation 的 active-tool lifecycle 尚未驗證。
- 下一步：建立 `Integration_WhenRetrievalCompletes_ShouldLockEvidenceSet` 紅燈測試，驗證 Retrieval 完成時鎖定 evidence set。

## 本里程碑實作

- Production `src/evidence/evidence-engine.ts` 已完成 create 合併與 origin 標記，以及 validator 的 duplicate Evidence ID、unknown finding reference、blocking limitation 規則。
- Workflow Retrieval-completed 已完成；production 只新增 completed seam 並重用 `completeDeepKnowledge`。
- Workflow Understanding-completed 已完成；production `handleDeepResult` 依 phase 導向 `CONTEXT_BUILD`，並清除 active attempt。
- Workflow `needs_decision` 已完成；production 建立綁定 `attemptId` 的 `deep_decision` `WAIT_USER` round，保存 payload、清除 active attempt，並加入 Deep → `WAIT_USER` 合法轉移。
- Workflow `needs_discovery` 已完成；production 新增 result type、兩個 Deep phase → `LIGHT_DISCOVERY` 合法轉移，清除 active attempt 並保留 state。

## 2026-08-25 Integration milestone 2

- 第一個 search slice 曾出現假綠燈：測試只檢查回傳值是 array 且長度不超過 3，stale call 回傳空陣列也會通過。根因是公開 schema 使用 lowercase phase，但 Session identity 使用 `DEEP_KNOWLEDGE_RETRIEVAL`。補上 `status: accepted`、結果數量必須大於 0，以及公開 TypeBox literal 的 phase 斷言後，RED 命令 exit 1；修正 schema/type 後 GREEN 命令 exit 0。
- Retrieval lock slice 測試 `Integration_WhenRetrievalCompleteLocksEvidence_ShouldDisableSearch` 初始 RED 命令 exit 1，原因是 retrieval-complete 工具尚未註冊。
- Production 在 Session State 保存完整的 supplemental `EvidenceInput`，完成 Retrieval 時鎖定 inherited＋supplemental evidence；保留舊 supplemental ID API，並在 snapshot／reset 時清理。Extension 註冊 `forge_deep_retrieval_complete`；模型不傳 `evidenceIds`，由 runtime 組合 fetched snapshot 與已接受的 supplemental evidence。成功後轉入 Understanding，active tools 只保留 `forge_deep_complete`。
- Retrieval lock GREEN 命令 exit 0，1/0 exit status，驗證 `Integration_WhenRetrievalCompleteLocksEvidence_ShouldDisableSearch` 通過。
- 修改檔案：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、本狀態檔。
- 尚未解決：`forge_deep_complete` 尚未註冊；target、decision、discovery、stale 與完整 active-tool lifecycle 仍待驗證。
- 下一步依 PLAN-A 建立 Understanding complete 的 valid `EvidencePackage` 紅燈測試。

## 2026-08-25 Integration milestone 3

- `Integration_WhenUnderstandingUsesLockedEvidence_ShouldProducePackage` 紅燈命令 exit 1，原因是 `forge_deep_complete` 尚未註冊。
- Production 在 `forge-runtime/extensions/forge-runtime.ts` 註冊公開 schema；`completed` outcome 只接受 decisions／findings／limitations，不接受模型自行傳入 evidence。Runtime 取 locked inherited／supplemental evidence 建立 `createEvidencePackage`，再執行 `validateEvidencePackage`；invalid 不轉移 state，valid 才呼叫 `handleDeepResult`、回傳 package 並恢復 active tools。
- GREEN 命令 exit 0（1/0），驗證 `Integration_WhenUnderstandingUsesLockedEvidence_ShouldProducePackage` 通過。
- 修改檔案：`forge-runtime/extensions/forge-runtime.ts`、對應 extension 測試檔、本狀態檔。
- 尚未解決：剩餘 integration #2 reuse、#5 target ambiguity、#6 new requirement、#7 stale、#8 context build；Deep outcome 的 `needs_decision`／`needs_discovery` 尚未公開串接。
- 下一步依 PLAN-A 補 `Integration_WhenDeepSearchReusesGrillEvidence_ShouldAvoidDuplicateRead`。

## 2026-08-25 Integration milestone 4

- `Integration_WhenDeepSearchReusesGrillEvidence_ShouldAvoidDuplicateRead` 首次 RED exit 1，失敗原因是 `reusedEvidenceIds` 未定義。
- 首次 production 修正後仍 RED，回傳空陣列；已診斷根因：`findCodeBaseCandidates` 要求 path 與 content 同時命中，但 Grill snapshot 已持有完整 content，單用 content query 無法命中。
- Root fix：先在已 fetched snapshot 依 kind＋query 比對；命中時直接回傳原 candidate ID、`evidence=[]`，不掃檔、不記 supplemental；其後仍保留 canonical source 比對，避免其他重複讀取。
- GREEN exit 0（1/0）；Retrieval lock 只包含原有 Grill evidence ID。
- 修改檔案：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、本狀態檔。
- 尚未解決：target ambiguity（integration #5）。
- 下一步：建立 target ambiguity 紅燈測試，確認無法唯一辨識 target 時回傳 `needs_decision`。

## 2026-08-25 Integration milestone 5

- Target ambiguity RED 命令 exit 1（1/0），原因是 target 搜尋在無法唯一辨識時仍回傳 `accepted`。
- Production 修正 `buildGrillCompatibleDiscovery`：只依 snapshot 內的 `code_base` `relativePath` 建立明確的 `target` candidate；只有 root target 可讀時才建立 candidate，不掃描任意檔案。Evidence ID 已支援 target。
- `forge_deep_search` 的 `targetSource` 必須與 target candidate 的 relative path 唯一且精確匹配；缺失、不符或多義時，透過 `handleDeepResult` 回傳 `needs_decision` 並進入 `WAIT_USER`，options 僅列出可選的 target relative paths，`evidenceIds` 僅包含已 fetched 的 Grill evidence，並恢復 active tools。
- GREEN 命令 exit 0（1/0）；target ambiguity 行為已驗證。修改檔案：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、本狀態檔。
- 下一步：Integration #6，驗證新的需求會正確導向 `WAIT_USER`。

## 2026-08-25 Integration milestone 6

- RED 命令 exit 1：新的 `forge_deep_complete` 需求測試起初只接受 `completed` outcome；後續發現既有 #4 schema 斷言與已核准的 `completed`／`needs_decision`／`needs_discovery` outcome union 衝突，因此測試改為從公開 `anyOf` 找到 `completed` branch，並持續確認該 branch 不含 `evidence`。
- Production 的 `forge_deep_complete` outcome 已改為 `Type.Union`，包含 `completed`、`needs_decision`、`needs_discovery`。`needs_decision` 會呼叫 `handleDeepResult`、回傳 decision payload、進入 `WAIT_USER` 並恢復原 active tools；舊 attempt identity 仍受 stale guard 保護。
- GREEN 命令 exit 0（1/0）；#6 新需求測試與 #4 回歸測試均通過。
- CodeGraph sync 曾錯誤回報舊 schema；後續以 `apply_patch` 精確更新目前 block，並由測試確認實際檔案正確。這是索引觀察缺口，不是 production 根因。
- 下一步：Integration #7，驗證 stale attempt。

## 2026-08-25 Integration milestone 7

- `Integration_WhenDeepAttemptIsStale_ShouldRejectCompletion` 首次即 GREEN，命令 exit 0（1/0）。第一次 Retrieval complete 會鎖定 evidence 並進入 Understanding；重送舊 Retrieval identity 時回傳 stale，不 publish、不改 active tools；後續 `forge_deep_complete` 仍使用原本 locked evidence 成功。
- 此行為由既有 Session State／extension stale guard 已涵蓋，本 milestone 無 production 修改。
- 下一步：Integration #8，驗證 valid package 能正確進入 `CONTEXT_BUILD`。

## 2026-08-25 Integration milestone 8

- `Integration_WhenPackageIsValid_ShouldTransferToContextBuild` 首次 GREEN，命令 exit 0（1/0）。Valid `forge_deep_complete` package 已正確進入 `CONTEXT_BUILD`，並恢復原 active tools `[read,write]`。
- 此行為沿用既有 `deep_complete` valid path；本 milestone 無新增 production 修改。
- PLAN-A 所列 8 個 integration 案例已逐一通過。
- 尚待處理：補齊 `retrieval_complete` 公開的 `needs_decision`／`needs_discovery` contract、related/full tests、check、final review，以及最終文件與 Memory 更新。
- 下一步：補齊上述 contract 後，執行 related/full 驗證與 review。

## 2026-08-25 Integration milestone 9

- `forge_deep_retrieval_complete` 公開 outcome union 已補齊 `completed`、`needs_decision`、`needs_discovery`；三種結果都透過 `handleDeepResult` 路由，依結果轉換狀態、恢復或切換 active tools，並發布對應結果。
- 既有 6 個 extension 測試已依新流程遷移：保留 terminate、message_update、stale message_end、snapshot immutability、structured route、continue no-op 等原本意圖；指定相關測試 6/6 通過，extension 整檔 91/91 通過。
- Related tests 全部通過：Evidence 4、Session 15、Workflow 8、Extension 91。
- 修改檔案：`forge-runtime/extensions/forge-runtime.ts`、相關 extension 測試檔、本狀態檔。
- 下一步：執行 full suite 與 `npm run check`。

## 2026-08-25 首次 Grill→Deep identity handoff 修正完成里程碑

### 已完成項目

- 首次 Grill READY→Deep 建立 active identity 後，已透過既有 decision-retry 的 `pi.sendUserMessage(..., { deliverAs: "followUp" })` 傳送含 `attemptId`、`sourceRoundId`、`phase` 的 identity-bearing invocation。
- `forge-runtime/extensions/forge-runtime.ts` 的三個 caller 以 closure-local setter 傳遞 `pendingReplayInvocation`；`continueDeepKnowledge` 建立 attempt 後先設定 marker，再送出 followUp。
- identity 不放入 tool details；Deep tools 不自取 identity；未修改 stale guard、tool schema、`pi-main/`，未加入 sequential 設定。

### 重要決策

- public seam 維持現有 `registeredTools`／harness；先以 failing integration test 鎖定 handoff identity，再做 extension 最小修正。
- followUp 在目前 tool round 結束後觸發下一模型回合，沿用現有 PI API 定義；不新增 UI 或 Plan B。

### 修改檔案

- Production：`forge-runtime/extensions/forge-runtime.ts`。
- Tests：兩個既有測試檔。
- 文件與狀態：`CONTEXT.md`、`docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md`、`docs/PLAN-A.md`、`docs/handoff.md`、`Memory/record.md`、`Memory/lesson_learn.md`、本狀態檔。

### 測試結果

- finalized regression test：RED 114 pass/1 fail（`handoff undefined`），修正後 GREEN 115/0。
- 聚焦測試 4/4；相關 suite 147/147，證據：`.tmp/deep-related-green-20260825.log`。
- 完整 suite 209/209，證據：`.tmp/deep-full-green-20260825.log`。
- `npm run check` exit 0，證據：`.tmp/deep-caller-check-20260825.log`。
- final quick review：0 functional findings。

### 未解問題

- 尚未由使用者在真實 PI session 重跑原始情境；此項不是 blocker。

### 下一步

- 交付使用者在真實 PI session 重跑原始情境；在此之前不再擴大本 ticket 範圍。

## 2026-08-25 最後驗證與工作樹狀態里程碑

### 已完成項目

- 工作期間 HEAD 由外部移至並同步 `origin/main` 的 `324501a0412bbfdead9642aeb845bb26192b57cc`；該 commit 不是本代理建立。目前本 ticket 剩九檔 tracked 修改未提交。
- 隔離 detached worktree 只套用九檔 diff 後，`npm run check` exit 0，四個關鍵測試均 4/4 exit 0；logs：`forge-runtime/.tmp/deep-isolated4-check-20260825.log`、`forge-runtime/.tmp/deep-isolated4-targeted-20260825.log`。
- 主工作樹 full 仍為 209/209。

### 重要決策

- 不把 isolated3 視為通過：正式結果為 209/197/12，12 項皆在 assertion 前因 `ERR_MODULE_NOT_FOUND typebox`，屬隔離 package-resolution setup 失敗；只保留為環境 caveat。證據：`forge-runtime/.tmp/deep-isolated3-check-20260825.log`、`forge-runtime/.tmp/deep-isolated3-test-20260825.log`。

### 修改檔案

- 本里程碑只更新七份既有 Markdown；不修改 code/test。

### 測試結果

- 隔離 detached worktree：`npm run check` exit 0、四個關鍵測試 4/4 exit 0，證據見 isolated4 logs。
- 主工作樹：full 209/209。
- isolated3：209/197/12，12 項均於 assertion 前因 `ERR_MODULE_NOT_FOUND typebox` 失敗，不列為 pass；logs 同上。

### 未解問題

- 尚未由使用者在真實 PI session 重跑原始情境；這是唯一未解事項，不是 blocker。

### 下一步

- 由使用者在真實 PI session 重跑原始情境；維持目前九檔 tracked 修改未提交狀態。
