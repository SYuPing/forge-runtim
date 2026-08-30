---
title: deep-discovery-fallback-human-premise-20260829 agent state
type: agent-state
scope: Deep Discovery fallback 與 human premise Evidence
updated: 2026-08-30
source: docs/adr/ADR-0021-deep-discovery-fallback-human-premise.md、docs/tickets/deep-discovery-fallback-human-premise-20260829.md、docs/PLAN-A.md
status: verification-in-progress
---

# deep-discovery-fallback-human-premise-20260829

## 已完成項目

- 已完成方案 B 與 human premise 邊界設計核准。
- 已建立 ADR、ticket 與本狀態檔；尚未修改 production/test。
- 已載入 `execute-designed-plan` 與 `tdd`；確認公開 seam 為 `validateEvidencePackage`，並新增測試 `EvidencePackage_WhenFindingReferencesOnlyHumanPremiseWithoutInferencePrefix_ShouldReject`。
- 第一個 GREEN milestone 已完成：production validator 已支援 `human_premise` origin，並拒絕僅引用 human premise、且 statement 沒有 `推論：` 前綴的 finding。

## 重要決策

- `needsDiscoveryCount` 合併 Retrieval／Understanding；第一次自動 Light Discovery→Grill，第二次起固定問題 WAIT_USER。
- 只接受整句 `同意`／`確認`；確認後 fresh Understanding identity，只允許 completion tool。
- 累積 evidence 依 evidenceId 去重；零外部來源以 human premise 作為可追溯的人類前提，不冒充外部事實。
- 由已驗證 evidence 直接成立的事實性 finding 可維持事實陳述；implementation inference 必須以 `推論：` 開頭並引用有效 Evidence ID。只引用 `human_premise` 且沒有 verified evidence 時，validator 強制 `推論：`；混合 evidence 仍須標示實際推論，既有引用／ID 檢查不放寬。

## 修改檔案

- 本 milestone 修改：`forge-runtime/tests/evidence/evidence-engine.test.ts`、`forge-runtime/src/evidence/evidence-engine.ts`。
- 既有設計文件：ADR-0021、ticket、本狀態檔，以及 CONTEXT、PLAN-A、handoff、ADR-0015/0016/0018/0020、Memory 兩檔的設計同步。
- production code 已修改：`forge-runtime/src/evidence/evidence-engine.ts` 新增 `human_premise` origin 與對應 validator 邊界。

## 測試結果

- Evidence 單檔 exit 0，12/12 pass，0 fail，無 blocker。

## 未解問題

- 待實作後驗證三項 fragile assumptions：followUp 排程時序、跨 snapshot evidenceId 去重、fallback prompt／identity 不被 provider 當成自由文字路由。
- 下一步：先核對 `human_premise` 建構公開 seam，再進第二個 RED；不要臆測 API。

## 下一步

單一垂直 slice 已完成 TDD RED→GREEN；下一步先核對 `human_premise` 建構公開 seam，再進第二個 RED；不要臆測 API。

## 第二個 Evidence RED milestone（2026-08-30）

- 使用者已核准 `humanPremise?: EvidenceInput[]`、合併順序 `inherited→supplemental→humanPremise`，以及 factory 自動設定 `human_premise` origin。
- 新增 RED 測試 `EvidencePackage_WhenHumanPremiseInputIsIncluded_ShouldAssignHumanPremiseOrigin` 於 `evidence-engine.test.ts`。
- Evidence 單檔 exit 1：13 total／12 pass／1 fail；預期 1 筆 `human_premise`，實際為空陣列。此為預期 RED，無 blocker。
- 下一步：production 最小加入 optional field 與 mapping，再由獨立代理執行 GREEN。

## 第二個 Evidence GREEN milestone（2026-08-30）

- production：`EvidencePackageInput` 增加 optional `humanPremise`；factory 依 `inherited→supplemental→humanPremise` 合併，並自動設定 `human_premise` origin。
- GREEN：Evidence 單檔 exit 0，13/13 pass；本 ticket 兩個新測試均通過，無 blocker。
- 修改檔案維持：`forge-runtime/src/evidence/evidence-engine.ts`、`forge-runtime/tests/evidence/evidence-engine.test.ts`。
- 下一步：探索 session state 的 `needs_discovery`／fallback 第一個公開行為，再進 RED。

## Session-state 探索停點（2026-08-30）

- 已確認第一 RED 候選：第二次 `needs_discovery` 進入 `WAIT_USER`／`deep_discovery_fallback`；尚未建立測試或修改 production。
- 未決契約：`WaitUserState` 需要 `options`／`recommendation`，但 ADR 尚未指定 literal；`cancel` 需決定只清除新的 fallback count／accumulator，或改變既有保留 deep input／supplemental 的契約。
- 建議待使用者核准：`options` 為 `["確認", "同意"]`、`recommendation` 為 `"確認"`；`cancel` 只清除新的 fallback workflow-local 狀態，維持既有 Deep input／supplemental 保留行為。
- 下一步：使用者核准後建立 session-state 第一 RED。

## Session-state 第一個 RED milestone（2026-08-30）

- 使用者已核准 `WAIT_USER` 的 `options` 為 `["確認", "同意"]`、`recommendation` 為 `"確認"`，以及 cancel 只清除新的 fallback count／累積 evidence，保留既有 Deep input／supplemental。
- 新增測試 `SessionState_WhenNeedsDiscoveryOccursTwice_ShouldEnterDeepDiscoveryFallbackWaitUser`。
- Session-state 單檔 exit 1：16 total／15 pass／1 fail；預期 `WAIT_USER`／`deep_discovery_fallback`，實際為 `LIGHT_DISCOVERY`／`undefined`。此為預期 RED，無 blocker。
- 下一步只實作 `needsDiscoveryCount` 與第二次 `needs_discovery` 進入 `WAIT_USER`；回答恢復與 cleanup 留待後續 RED。

## Session fallback 第一個 GREEN milestone（2026-08-30）

- production 新增 `needsDiscoveryCount`，第二次以上 `needs_discovery` 產生 `WAIT_USER` payload，並加入 `deep_discovery_fallback` UI kind。
- 第一次 GREEN 嘗試因測試過度 assert 未核准 ID 而 15/1；已縮小到核准欄位後完成 GREEN。
- Session-state 單檔 exit 0，16/16 pass，無 blocker。
- 下一步：探索 fallback 回答公開入口，並建立非 exact answer RED。

## Session fallback non-exact answer RED milestone（2026-08-30）

- 新增測試 `SessionState_WhenDeepDiscoveryFallbackAnswerIsNonExact_ShouldRemainWaitUserWithoutDecision`。
- Session-state 單檔 exit 1：17 total／16 pass／1 fail；預期維持 `WAIT_USER` 且不產生 decision，實際進入 `GRILL` 且 decision count 為 1。此為預期 RED，無 blocker。
- 下一步只加 `recordAnswer` 的 exact guard；exact 成功路徑留待下一個 slice。

## Session fallback non-exact answer GREEN milestone（2026-08-30）

- `recordAnswer` 對 `deep_discovery_fallback` 僅接受 trim 後整句 `同意` 或 `確認`；其他回答維持 `WAIT_USER`，且不寫入 decision。
- Session-state 單檔 exit 0，17/17 pass，無 blocker。
- 下一步：建立 exact confirmation RED，驗證 `USER_CONFIRMED` → `KNOWLEDGE_UNDERSTANDING`。

## Session fallback exact confirmation RED milestone（2026-08-30）

- 新增測試 `SessionState_WhenDeepDiscoveryFallbackReceivesExactConfirmation_ShouldBeginKnowledgeUnderstanding`。
- 移除未核准的 decision string trim 斷言，只驗證 decision count。
- Session-state 單檔 exit 1：18 total／17 pass／1 fail；第一失敗為 `Invalid transition GRILL -> KNOWLEDGE_UNDERSTANDING`。此為預期 RED，無 blocker。
- 下一步只修改 fallback next stage 與 state-machine transition。

## Session fallback exact confirmation GREEN milestone（2026-08-30）

- `recordAnswer` 收到 exact `同意`／`確認` 後，fallback 狀態進入 `USER_CONFIRMED`；state-machine 只新增 `USER_CONFIRMED → KNOWLEDGE_UNDERSTANDING` transition。
- Session-state 單檔 exit 0，18/18 pass；三個 fallback 新情境均通過，無 blocker。
- 下一步：探索 workflow-local evidence accumulator 與 cleanup。

## Workflow-local accumulator 設計停點（2026-08-30）

- 已決定 accumulator 為 workflow-local，跨越第一次 fallback 的 snapshot，並依 `evidenceId` 去重。
- storage owner 尚未實作；建議由 extension private `Map` 持有，不新增 session public API。
- ID 衝突採 fail-closed：同一 `evidenceId` 且內容相同時去重；同一 ID 但內容不同時拒絕，避免靜默覆寫。
- first-seen ordering 依 `Map` insertion order 保留，確保累積 evidence 順序穩定且可追溯。
- lifecycle 清理規則：第一次 fallback snapshot switch 保留 accumulator；explicit cancel、session switch、new workflow、reset 時清除。
- 下一步：等待使用者核准後，建立 extension accumulator RED；不得先新增 session public API。

## Extension accumulator 與 PI lifecycle milestone（2026-08-30）

- PI 實際 lifecycle 已確認：`sendUserMessage` extension API 回傳 `void`，且 enqueue 前會進行 async dispatch，因此不能 `await`；tool-result 文字在同一 run 內無法可靠刷新 tools snapshot。
- Grill→Deep 使用 `tool result` 搭配 `terminate: true`；保存 workflow 與 Deep identity，由 `agent_settled` 排入可取消的 `setTimeout(0)`。timer 會重新驗證 workflow、identity 與 active tool，通過後以普通 prompt 送出 invocation；`clearPendingState` 會取消 timer，命令路徑仍使用 `followUp`。
- 第一次 `needs_discovery` restart 仍使用 matching `tool_result` transform；只有 `completion.state.stage === LIGHT_DISCOVERY` 才 queue，`WAIT_USER` 不 queue。
- PI 測試 queue 已反映一次舊 run 的純 assistant 收尾，下一個 callback 才是 deep-2；暫時診斷已移除。
- 精確驗證：agent-settled extension unit 1/1 PASS；automatic restart lifecycle 1/1 PASS；PI fallback clean 1/1 PASS。
- 修改檔案：`extensions/forge-runtime.ts`、extension test、PI interactive test；未修改 `pi-main`。
- 尚待完整檔案檢查、`check`／`npm test` 與 review／文件同步。

## 完整驗證進行中（2026-08-30）

- 目前狀態：精確 lifecycle 驗證已通過，整體仍待 full files/check/npm test/review/docs。
- 下一步：完成完整檔案檢查、靜態檢查、測試、review 與文件同步；保留既有 baseline errors，不修改 `pi-main`。

## Workflow-local accumulator 契約核准（2026-08-30）

- 使用者已核准 accumulator 由 extension private `Map` 持有，不新增 session public API。
- 同一 `evidenceId` 且內容相同時去重；同一 ID 但內容不同時 fail-closed 拒絕。
- 依首次出現順序保留 evidence；第一次 fallback 的 snapshot switch 保留 accumulator。
- explicit cancel、session switch、new workflow、reset 時清除 accumulator。
- 下一步：核對 extension 最早缺口，從單一 RED 開始。

## Extension auto-restart RED milestone（2026-08-30）

- 已更新既有 extension 測試，移除 manual continue，改驗證 `needs_discovery` 後自動排程 follow-up。
- 整檔先執行時 exit 0，69/69 pass；既有完整 suite 隨後掛起約 150 秒，未能觀察 target 結果。
- 以精確 name-pattern 執行 target 時 exit 1，0 pass／1 fail；預期 followUp 次數為 1，實際為 0。此為預期 RED，非 blocker。
- lifecycle 安全核對：修正測試後，`pre-message_end` followUp=0 已通過；matching `message_end` 後預期 1、實際 0，精確 target exit 1。此為預期 deferred RED，無 blocker。
- production 下一步：加入一次性 pending identity，於 matching `message_end` consume 後才送出 follow-up；不得在 active tool turn 內直接 send。

## Extension auto-restart GREEN 與 hunt（2026-08-30）

- runtime probe 證實 pending set 與所有 guard 均為 true，但 `eventMatch` 為 false；根因是 `message_end` 實際攜帶 `toolCall`，matcher 卻尋找 `toolResult`。
- 已修正 matcher 以符合實際 `message_end` payload，並移除一次性 runtime probe。
- sibling sweep 顯示唯一的 `toolResult` 使用點是合法的 Deep batch safe path，未發現其他需同步修改的 caller。
- target 驗證 exit 0，1/1 通過；pre-event followUp=0，post-event 單一 followUp 通過。
- 下一步：進入第二次 `needs_discovery` 的 `WAIT_USER` extension RED。

## Extension 第二 fallback RED milestone（2026-08-30）

- 第二次 `needs_discovery` 的 extension target exit 1：0/1 通過；預期 exit code 為 1，實際為 0。`status`／`followUp` 路徑已停止，但 `select` 為 `undefined`，表示 `WAIT_USER` UI 沒有開啟。
- 根因：Deep Retrieval／Understanding result 目前只呼叫 `publishState`，沒有呼叫 `publishWaitUser`；狀態雖然更新，UI 的 select 卻不會出現。
- sibling sweep：Grill／relevance 路徑安全；`deep_decision` 同形問題也會由 shared fix 一併涵蓋。
- 下一步：讓兩個 Deep sibling stage 的 `WAIT_USER` 路徑改走 `publishWaitUser`。

## Extension 第二 fallback GREEN 與 hunt（2026-08-30）

- 已完成 shared production fix：Deep `WAIT_USER` 路徑改為呼叫 `publishWaitUser`，不再只呼叫 `publishState`。
- 初次同症狀檢查發現 target context 缺少 `ui.select`；probe 證實 `uiPresent`／`waitUserPresent` 為 true，但 `selectIsFunction` 為 false。
- 已補上 `buildContext` 的 `ui.select` deferred stub，並移除全部 runtime probes。
- target 驗證 exit 0，1/1 通過；`select` 與 no-followUp 均符合預期。
- 下一步：建立 extension non-exact answer route RED。

## Extension fallback exact answer route GREEN milestone（2026-08-30）

- 原 RED target 在測試約第 6150 行 exit 1；預期 fallback 精確確認後進入 `KNOWLEDGE_UNDERSTANDING`，實際未進入。
- production 以最小路徑支援 `deep_decision` 與 `deep_discovery_fallback`：non-exact answer 不產生 invocation；exact `同意`／`確認` 呼叫 `beginDeepKnowledge(..., "KNOWLEDGE_UNDERSTANDING")`，只啟用 Understanding completion tool，並沿用既有 replay 流程。
- 第一次 GREEN 檢查仍出現相同症狀；hunt 確認是測試 wiring／觀察時機問題：`ui.select` 被放在 `message_end` 後，且檢查的是已 resolve 的 follow-up，而不是本次新增輸出。
- 修正測試 harness 改在第二次 Retrieval context 提供 `ui.select`，並以本次新增輸出作為觀察基準；production 未再更動。
- 第二次 target 驗證 exit 0，1/1 pass；exact fallback confirmation 已進入 Knowledge Understanding，且只提供 completion tool。
- 下一步：建立 private evidence accumulator + human premise integration 的第一個 RED。

## Accumulator carry GREEN milestone（2026-08-30）

- accumulator carry 的初始 RED 兩次失敗均為測試設置問題：一次錯把同路徑內容修改視為 ID 假設，另一次使用未命中 seed 的 extra 檔名；已修正 fixture。
- 正確 fixture 使用不同相對路徑但完整檔名相同；target RED exit 1，失敗約在第 6256 行，預期 1、實際 0，符合預期。
- production 由 extension private `Map` 只記錄成功的 Grill fetch；fallback 沒有 locked evidence 時以該 Map 建立 evidence package，正常 locked 流程維持不變。
- target GREEN 驗證 exit 0，1/1 通過。
- 下一步：建立 human premise 單一 RED。

## Human premise integration GREEN milestone（2026-08-30）

- 有效 RED 前曾出現測試 syntax error，不列為 RED；修正後的有效 RED exit 1，失敗約在第 6360 行，預期值 1、實際值 0。
- production extension 以私有狀態記錄已接受的 `needs_discovery` `sourceRoundId`；exact confirmation 時建立 human premise，`source` 固定，`content` 包含 goal／question／answer，metadata 包含 count／rounds。
- 同時記錄 human decision ID，並在 evidence package 的 decision 複製加入 premise ID；找不到 `activeWorkflow` 時採 fail-closed。
- 第一次 GREEN 失敗是測試自行提交 model decision，卻檢查了錯誤的 decision；第二次相同症狀的精查發現 `originalGoal` 錯誤取自第一則 Deep follow-up。兩次根因都是 test harness／observation，不是 production。
- 修正測試為空 outcome decisions、接受任一 decision 引用、並明確設定 `originalGoal`；最終 target exit 0，1/1 pass。
- 下一步：對照 ticket，處理剩餘 conflict／cleanup／PI regression。

## Typed input handler GREEN milestone（2026-08-30）

- RED 驗證 exit 1；實際流程停在 Forge GRILL。
- 第一位 production worker 僅確認下游未改入口，未解決 typed input 路由缺口。
- 第二位 production worker 將 input handler 的 kind 條件加入 `deep_discovery_fallback`。
- 首次 GREEN run 的狀態與工具切換已正確，但測試錯誤期待 `sendUserMessage`；實際 input ingress 走 `transform`。
- 修正測試以保存 `sendInput` 回傳文字，並改驗證沒有新增 user message；最終 target exit 0，1/1 通過。
- 下一步：Deep supplemental accumulator。

## Deep supplemental accumulator GREEN milestone（2026-08-30）

- RED target exit 1；失敗約在第 6439 行，預期 supplemental evidence 數量為 1，實際為 0，符合預期 RED。
- production 新增 extension private `fetchedDeepEvidence` Map：只在 `recordDeepSupplementalEvidence` 成功後以 first-seen 順序保存；相同 evidence 重用時不重複記錄。
- fallback 且沒有 locked evidence 時，將累積的 Deep supplemental evidence 傳入 evidence package；正常 locked 流程維持原有行為不變。
- GREEN target exit 0，1/1 通過，無 blocker。
- 下一步：處理 reset／cleanup，確認 accumulator、human premise 與 workflow lifecycle 的清理邊界。

## Session reset GREEN milestone（2026-08-30）

- RED target exit 1；實際仍為 `WAIT_USER`，預期 reset 後回到 `LIGHT_DISCOVERY`，失敗約在第 541 行，符合預期 RED。
- production reset 只將 workflow-local `needsDiscoveryCount` 歸零；既有 evidence／human premise ID counters 保留，避免改變既有 ID 契約。
- GREEN target exit 0，1/1 通過，無 blocker。
- 下一步：處理 extension closure cleanup，確認 session switch／cancel／new workflow／reset 的 private accumulator 清理一致。

## Extension cleanup／cancel GREEN milestone（2026-08-30）

- extension 新增專用 `clearFallbackWorkflowState`，並在 cancel、success switch、new workflow 時呼叫；第一次自動 restart 與一般 `clearPendingState` 不清除此狀態，以保留跨第一次 fallback snapshot 的累積資料。
- 最初 extension cancel 測試多次因錯誤理解 `RECEIVE` 語意及 identity 設定，未形成有效 RED；該測試已刪除，未把測試設置問題當成 production 契約。
- 正確的 public seam 改由 session-state cancel 測試驗證；RED 實際為 `WAIT_USER`，預期為 `LIGHT_DISCOVERY`（約第 555 行）。
- `cancelDeepKnowledge` 現在將 `needsDiscoveryCount` 歸零，同時保留既有 Deep evidence 與 counters；GREEN target exit 0，1/1 通過，無 blocker。
- 下一步：驗證 session switch 與 new workflow 的端到端清理。

## Extension session switch／new workflow cleanup GREEN milestone（2026-08-30）

- shared cleanup helper 已由 cancel slice 實作，因此本回歸沒有另行反轉 production，也沒有建立獨立 RED。
- session switch／new workflow cleanup target 初次兩次失敗均為測試設置／期待問題：一次把 replacement session 接到舊 input，另一次把 premise ID 錯誤期待為 fallback candidate；修正後 target exit 0，1/1 通過。
- 回歸證明 old marker／goal／round／evidence 不會外洩；new evidence package 僅包含新 evidence，human premise count 為 2。
- 下一步：驗證 evidence ID dedupe 與 conflict fail-closed。

## Evidence ID conflict GREEN milestone（2026-08-30）

- Session RED 首次失敗的原因是測試使用同內容時覆寫了第一筆 metadata（約第 614 行），不是 production 行為缺陷；已修正測試資料配置。
- production 對同一 `evidenceId` 採 fail-closed：內容相同時去重，內容不同時拋出穩定錯誤，不靜默覆寫，新的 ID 則依首次出現順序插入。
- Extension 公開工具的 evidence ID 由內容／來源雜湊產生，無法偽造 collision；private local helper 以兩個 `Map` mirror 相同契約，未新增 public API。
- GREEN target exit 0，1/1 通過；後續 full tests 需確認既有流程沒有 regression。
- 下一步：驗證第三次 `needs_discovery` 行為與 PI 回歸測試。

## 完整驗證狀態更新（2026-08-30）

- 狀態：精確 lifecycle 驗證已通過，整體仍進行完整驗證。
- 下一步：完成 full files、check、`npm test`、review 與文件同步；保留既有 baseline errors，不修改 `pi-main`。

## Ticket 完成驗證（2026-08-30）

- Ticket 已完成。Evidence Package 支援並驗證 `human_premise`；Retrieval／Understanding 共用 `needsDiscoveryCount`；第一次 `needs_discovery` 經正式 `tool_result` transform 自動重跑 Light Discovery→Grill，第二次進精確問題的 `WAIT_USER`，只接受 trim 後完整 `同意`／`確認`。
- 確認後建立新的 Knowledge Understanding identity，只允許 `forge_deep_complete`。Grill／Deep evidence 跨第一次 snapshot switch 累積並依 ID 去重，在 cancel、switch、new workflow、reset 清除。human premise 含 goal、question、answer、`needsDiscoveryCount`、兩輪 `sourceRoundIds`，decision 引用它。
- READY_FOR_DEEP 使用 terminate 與 pending settled invocation，在 `agent_settled` 的下一個 task 送普通 user message，再重驗 identity／stage／tools；pending handoff 關閉 Deep tool gate；WAIT_USER publication await；`message_end` callback 帶 ctx；fallback 無 locked evidence 的 `needs_decision` 將兩個 accumulator keys 視為合法 evidence。
- 最終驗證：Evidence 13/13；Session State 22/22；Extension 142/142；PI interactive 12/12；`npm test` 248/248；Standards／Spec 獨立審查均 PASS。`npm run check` exit 1，但 Forge Runtime 自身零錯誤，唯一失敗為未修改 `pi-main/packages/coding-agent/src/utils/syntax-highlight.ts:1-21` 缺少 `highlight.js` declaration（TS7016）。無 blocker。
- 下一步：無待做 production 項目，只剩上游 check baseline。
