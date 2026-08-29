---
title: Forge Runtime v4 開發教訓
type: lessons-learned
scope: 已發現的 bug、根因、修復方式與可重用工程教訓
updated: 2026-08-29
source: 本 repo 的 agent-state、ADR、Plan、handoff 與測試證據
status: implemented-targeted-verified-with-caveats
---

# Forge Runtime v4 開發教訓

## 使用方式

本文件只記錄「發現什麼問題、根因是什麼、如何修復、下次怎麼避免」。每筆教訓都應附可核對的檔案或測試證據；沒有證據時只記錄觀察，不把假設寫成結論。開發目標與重大實作請查 [`record.md`](./record.md)。

本輪已發現並修復 production regression；以下內容只記錄可由檔案、測試或 log 核對的 bug 與教訓。

## Bug 與修復索引

1. **TypeBox loader 假綠燈**：source CLI direct import 的 assertion 在舊程式碼即通過，沒有走真實 loader。改用 global compiled `pi` bootstrap probe，並只在 Forge package 使用 `typebox/compile`；證據：`agent-state/typebox-loader-compatibility.md`。
2. **過時 omission 測試**：舊測試期待 `continue` replay，但 ADR-0008 已改為 `retry/cancel/switch`。刪除 stale test，先確認測試是否仍代表現行 contract；證據：`docs/adr/ADR-0007-grill-completion-tool.md`、`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md`。
3. **focused test 參數順序錯誤**：第一次命令執行整個檔案，不能當作 focused RED/GREEN。修正 test-name pattern 與命令順序後才採用 1/1 結果；證據：同上 agent-state。
4. **upstream terminal option 型別錯誤**：加入 test-only Terminal seam 後出現型別錯誤。修正 seam 型別後，剩餘 `packages/ai/test/*` 錯誤確認為既存 baseline，不歸因於 Forge；證據：`agent-state/grill-completion-recovery-interactive-acceptance-20260813.md`。
5. **fixture 違反 evidence invariant**：非空 manifest 配空 evidence 觸發首輪 guard。補上真實 candidate/evidence fixture，不放寬 production guard；證據：同上 agent-state。
6. **測試通過後不退出**：`InteractiveMode.run()` 是永久 production loop。runner 使用 `--test-force-exit`，不以 runtime `abort()` 解決；證據：`docs/PLAN-A.md`。
7. **full suite 並行 timeout**：loader smoke 在並行負載下觸發 30 秒 timeout。將 test runner 改為 `--test-concurrency=1`，保留 timeout 安全界線；證據：`docs/PLAN-A.md`、同上 agent-state。
8. **非 active attempt 未 fail-closed**：兩個 Grill tool 的 gate 不完整。補上 `pendingGrillRun && stage === GRILL` 共用 gate 與 execute guard；證據：同上 agent-state。
9. **panel payload 不可見**：raw payload 的 `content` 與 `display` 不符合契約。三個出口統一使用完整 `panelText` 與 `display: true`；證據：同上 agent-state。
10. **prompt 與 validator drift**：舊 prompt 要 assistant 輸出問題，與 completion-tool-only 契約衝突。改 prompt 並以 runtime validator 強制 question cardinality；證據：同上 agent-state。
11. **空 manifest 不可完成**：evidence invariant 無條件套用空 manifest。只在空 manifest、首輪、`NEEDS_CONFIRMATION` 且無 evidence 時改走唯一 scope question；證據：同上 agent-state。
12. **provider invocation 被顯示 rewrite 破壞**：user `message_end` 把完整 invocation 改回原始 request，使 provider 看不到 completion contract。移除 `pendingUserMessageRewrite`，以 provider-context 測試固定三條路徑；證據：`docs/handoff.md`、`agent-state/grill-invocation-transport-integrity-20260817.md`。
13. **合法 continuation 被誤判為 turn leak**：streaming fixture 會產生合法 tool-result continuation，第二次 provider call 不能單獨證明洩漏。改以 session/provider marker 驗證 READY 與 NEEDS regression；證據：`agent-state/grill-completion-terminal-boundary-20260819.md`。
14. **顯示抑制被誤當成回合終止**：完成後不顯示 prose 不代表代理回合停止。改由 `forge_grill_complete` 回傳 `terminate: true`，移除 `suppressCompletionTurn`；證據：`docs/adr/ADR-0011-grill-completion-terminal-boundary.md`。
15. **display-only context 洩漏風險**：只改 UI 不能同時保留 transcript/persistence 又排除 provider。新增 `deliverAs: "displayOnly"` 與 `excludeFromContext`，並覆蓋 conversion、compaction、branch summarization、session round-trip；證據：`docs/adr/ADR-0012-display-only-custom-message.md`。
16. **public 型別與測試 `any` 過度擴張**：final review 發現 public custom augmentation 與 hard `any`。移除 public augmentation，marker 留在 internal intersection，測試改用具體 `Model<"openai-completions">` 與正確 cost fixture；證據：`docs/handoff.md`。
17. **resume guard 遺失 affirmative normalization**：搬出 resume guard 後，affirmative input 未再做 normalization，造成既有 resume regression。修復為在共用 guard 保留 affirmative normalization；證據：`forge-runtime/extensions/forge-runtime.ts`、`.tmp/intent-route-only-finalgreen-forge-runtime-extension.log`。
18. **router completion 改變 faux provider call sequence**：新 router completion 讓 faux provider 多一個分類 call，舊測試把 router 與 Grill call 混為同一個序列而失敗。測試 seam 改為區分 router 與 Grill provider 呼叫；證據：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`.tmp/intent-route-only-finalgreen-forge-runtime-extension.log`。
19. **搬移輸入資料邏輯造成 contract 退化風險**：搬移 seed、rawText、command wrapper 時若未對照 fixed point，會退化 trim、`/grill-run` canonical wrapper 與 token 規則。修復以 extension handoff private helper 與公開 seed characterization regression 固定行為；證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`.tmp/intent-route-only-scoped-forge-runtime-extension.log`。
20. **loader smoke 混入不相關 LLM prompt**：loader smoke 若夾帶 LLM prompt，runtime 對照約 21.5s；純 loader smoke 約 1.4s。拆開 smoke 與 prompt 驗證，避免把耗時誤判為 loader 問題；證據：`forge-runtime/tests/extensions/pi-extension-loader.test.ts`、`.tmp/intent-route-only-scoped-pi-extension-loader.log`。
21. **路由規則與不可信輸入未明確隔離的 injection 風險**：router 規則固定放在 `systemPrompt`，raw input 以獨立 `user` message 傳入；新增 injection structure regression，並調整 faux provider queue／route call-count，確認分類 call 與 Grill call 不混序。教訓是不要把使用者文字拼入 system prompt，也不要用共享序列位置猜測路由是否成功；證據：`forge-runtime/src/intent/intent-understanding.ts`、`forge-runtime/tests/intent/intent-understanding.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`、`.tmp/intent-route-only-systemprompt-focused-intent.log`、`.tmp/intent-route-only-systemprompt-focused-extension.log`。

22. **Light Discovery adapter relevance regression**：adapter 固定只提供 path signal，但 `evaluateCandidateRelevance` 契約要求 path 與 content，造成符合條件的 `READY_FOR_DEEP` 誤回 `WAIT_USER`。修復為 adapter 已讀取內容後依 raw request seeds 真實計算 path、content、`matchedSeeds`、`score`，再篩入 `codeBaseCandidates`；Light Discovery 本體維持 metadata-only。證據：`forge-runtime/extensions/forge-runtime.ts`、`src/discovery/discovery-sources.ts`、`.tmp/verify-interactive.log`、`.tmp/reverify-interactive.log`。
23. **Light Discovery 測試 API 遷移殘留**：兩個 stale old API callers 與 15 個 skip 使測試不能代表現行 public seam。清除 stale callers，刪除 10 個 ADR 淘汰測試、改寫／保留 5 個，並還原 2 個強相關 Deep expectations；該次歷史 final suite 為 139/139，目前 closeout 驗證為 140/140。證據：`forge-runtime/tests/discovery/light-discovery.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、三個測試遷移檔與 `forge-runtime/.tmp/review-fix-verify-*.log`。

24. **tool-active guard 不等於 replayable state**：把「工具仍 active」當成 `/continue` 可重播條件，曾破壞 `WAIT_USER` 的合法 replay。修復為分開判斷 active lifecycle 與可重播的 pending Grill state，並以 WAIT_USER replay regression 固定契約。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`agent-state/grill-deep-boundary-risk-20260823.md`。
25. **debug completion 必須通過正式 round/evidence/schema gate**：debug payload 若遺失 `roundId` 或 evidence，會繞過正式 completion 邊界或拒絕合法 fixture。修復為共用正式 parser，要求目前 round、合法 completion status 與 evidence；錯誤 round 維持原 active round。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 的 debug wrong-round 與 completion gate 測試。
26. **Deep handoff 的 pending/tools 必須在第一個 await 前釋放**：若等 Deep continuation 完成後才清 pending 或還原工具，stale `message_end` 可能把已進入 Deep 的回合誤判為 Grill。修復為 handoff 開始時同步釋放，並加入 barrier regression。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 的 `Extension_WhenDeepHandoffAwaits_ShouldCloseGrillBoundaryBeforeAwaitAndIgnoreStaleMessageEnd`。
27. **relevance WAIT_USER 不可使用通用 `/confirm`**：通用 confirm 曾自動採用 recommendation，或在沒有 user callback 時造成非法 transition，越過人類澄清決策。修復為 relevance wait 只提示使用者補充來源或縮小需求，保持 WAIT_USER。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 的 relevance confirm guard 測試。
28. **不可用可碰撞字串推測 wait kind**：question id 或 round id 字串可能在不同語意中重用，僅靠字串前綴會把等待類型判錯。修復為使用可信的 runtime-issued `kind`，並以 `roundId + kind + decisionId` 識別 decision；未知或未發行的 decision fail-closed。證據：`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/runtime/session-state.test.ts` 與 extension decision identity 測試。
29. **Deep evidence 必須來自 immutable snapshot/fetched IDs**：Deep 若重新讀 live source，來源在 Grill 後變動時會混入未經 Grill 驗證的內容。修復為只從 Grill snapshot 與已抓取 evidence IDs 選取 Deep evidence；snapshot identity 改變時清除舊 fetched evidence。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 的 snapshot evidence isolation 與 live source mutation regression。

30. **測試 fixture 的 literal 型別也屬 contract 維護**：新增 round/evidence fixture 時，寬化的 `kind` 或 `candidateId` literal 會先造成 TypeScript check 失敗，掩蓋 runtime 驗證結果。修復為以 literal-preserving fixture 建立測試資料；不放寬 production 型別。證據：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、兩份 tsconfig `npm run check` 通過紀錄。

## 可重用教訓

## 2026-08-25 Deep Knowledge 實作教訓

- 讀檔後才檢大小：根因是 discovery／Grill adapter 先建立完整 content；修復為讀檔前 `stat`，超過 256 KiB 直接拒絕。證據：`forge-runtime/src/discovery/discovery-sources.ts`、`forge-runtime/extensions/forge-runtime.ts`、`forge-grill-guard-green.log`。
- Grill 累計 2 MiB 可繞過：根因是只檢單筆 evidence；修復為以 Grill fetched 加 Deep supplemental 的整輪總量原子檢查。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-full-final3.log`。
- stale Retrieval completed／needs_discovery 未先攔 capability：根因是 capability 檢查早於 stale 分流；修復為 stale outcome 優先 quiet reject。證據：`forge-stale-capability-green.log`。
- stale Understanding package validation 順序錯誤：根因是先驗證 package 再判 identity；修復為 stale 優先。證據：`forge-final-review-regressions-final.log`。
- human decision 未注入／duplicate override：根因是 package 只採模型提交；修復為先注入不可覆寫的 human decisions，模型重複 ID 拒絕。證據：`forge-runtime/src/evidence/evidence-engine.ts`、`forge-full-final3.log`。
- dynamic active-tools fail-open：根因是只檢查啟動當下工具；修復為對 active identity 動態檢查，能力消失即拒絕。證據：`forge-stale-capability-green.log`。
- stale needs_decision 未知 evidence 驗證順序：根因是先檢 evidence ID；修復為先判 stale。證據：`forge-final-review-regressions-final.log`。
- Deep decision resume 誤回 Grill：根因是回答分流沿用 Grill recovery；修復為保留原 Deep phase 與 source round，建立新 attempt。證據：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-full-final3.log`。
- confirm guard 太早造成合法 confirm regression：根因是 boundary guard 在確認合法性前執行；修復為先完成 session confirm legality／publish，再套工具邊界。證據：`forge-grill-guard-green.log`。
- TypeScript evidence shape／narrowing：根因是 evidence union 與 metadata／content shape 不一致；修復為收窄型別並讓 validator 與 adapter 共用正確結構。證據：`forge-check-final3.log`。
- 英文 public copy 與測試預期不同步：根因是新工具 label／錯誤訊息未同步繁中；修復為更新使用者可見文字與 README 工具清單。證據：`forge-check-final3.log`、`forge-runtime/README.md`。

## 2026-08-22 最終審查

- 最終 Standards 與 Spec review 均為 0 findings，未發現額外新 bug；既有驗證證據見 `agent-state/intent-route-only-llm-20260821.md` 與 `.tmp/intent-route-only-systemprompt-*.log`。
- Light Discovery 初次 review 各有 3 個 findings；修正後 Spec re-review 為 0 findings，Standards re-review 的 stale counts 已修正。未發現新 bug。

- 先驗證 host 的真實 callback contract，再建立 adapter；名稱相似不代表介面相同。
- 測試必須走實際 distribution path、factory、render path 與 provider transport；fake harness 只能證明局部 wiring。
- focused、full、static、scripted TUI 與人工驗收是不同層級證據，不能互相替代。
- invariant 必須精確限定適用集合；安全規則若寫成總規則，可能把正常流程變成永遠不可完成。
- 同一狀態只保留一個 owner；dedupe 與 fail-closed guard 應放在共用 seam，不要由每個 caller 各自補防護。
- provider contract 要直接檢查 provider 實收內容；state machine、畫面與 transcript 都不能代替 transport assertion。
- 完成終止必須有明確 lifecycle 訊號；prose suppression 只能控制顯示，不能代替 termination。
- display-only 必須同時驗證可見性、持久化、provider conversion、compaction 與 branch summarization；舊 session 缺 marker 時維持舊語意。
- 未證明根因前，只記錄觀察到的失敗與已排除項目；不要把 OOM、host mismatch 或 baseline error 寫成未驗證結論。

## 已 supersede 的契約

- ADR-0007／ADR-0003 的 omission `continue` replay 已由 ADR-0008 的 `retry/cancel/switch` 取代；一般 active workflow 的 `continue` 仍保留，但 recovery 中拒絕。
- 正常 completion 的 assistant terminal JSON 已由 `forge_grill_complete` 取代；`/forge-runtime grill-result` 僅保留 debug injection。
- Plan B 固定 widget tree 尚未完成，不能用 Plan A TUI acceptance 宣稱 UI tree 已完成。

## 2026-08-25 Deep identity handoff 修正教訓

- 首次 Grill READY→Deep 漏傳 runtime-issued `attemptId`、`sourceRoundId`、`phase`，模型自行猜測 identity，導致 Deep tool stale reject。修復為由 extension 在建立 attempt 後送 identity-bearing followUp；證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`.tmp/deep-related-green-20260825.log`（相關 147/147）。
- followUp 在 queue 前會經過 input hook；若沒有 marker，合法的內部 replay 會被當成一般輸入處理，handoff regression 出現 `handoff undefined`。修復為先設定 closure-local `pendingReplayInvocation` marker，再送 `pi.sendUserMessage(..., { deliverAs: "followUp" })`；證據：`forge-runtime/extensions/forge-runtime.ts`、handoff regression 由 114 pass/1 fail 轉為 115/0、`.tmp/deep-full-green-20260825.log`。
- module helper 無法直接存取 extension closure-local marker，且 positional caller 必須全量更新；本次由三個 caller 共用 closure-local setter 傳遞 marker，避免只修單一路徑。證據：`forge-runtime/extensions/forge-runtime.ts`、`.tmp/deep-caller-check-20260825.log`（`npm run check` exit 0）、`.tmp/deep-related-green-20260825.log`。
- PowerShell pipeline／`Tee` 可能使 `$LASTEXITCODE` 判定失真；驗證時必須直接捕捉 process exit，並核對 Node 的正式 summary，避免把隔離環境失敗誤報成通過。證據：isolated3 的 `forge-runtime/.tmp/deep-isolated3-check-20260825.log`、`forge-runtime/.tmp/deep-isolated3-test-20260825.log`（209/197/12，12 項皆在 assertion 前因 `ERR_MODULE_NOT_FOUND typebox`）與 isolated4 的 `forge-runtime/.tmp/deep-isolated4-check-20260825.log`、`forge-runtime/.tmp/deep-isolated4-targeted-20260825.log`。

## 2026-08-26 Deep 階段輸出守門教訓

- **Deep 階段誤輸出實作內容**：觀察到 Deep Retrieval 完成並轉 Understanding 的流程出現 RTL；可驗證根因是 `forge-runtime/extensions/forge-runtime.ts` 的 assistant prose guard 只覆蓋 Grill，Deep active 後只更換 active tools，`message_update`／`message_end` 未同時攔 `text`／`thinking`。修復為新增 `hasActiveDeepAttempt`，串流清空兩類文字、final message 只保留合法 toolCall；證據：同一 production 檔、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`，以及 `PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue` 紅燈 exit 1 後 targeted 9/9、完整 209 passed/0 failed/0 skipped、`npm run check` exit 0。
- **可重用教訓**：active tools 排除 write/edit 不能代替輸出邊界；階段契約必須同時覆蓋串流更新與終局事件，並以保留合法 toolCall 的測試固定。Grill `message_end` 含 toolCall 分支仍依賴 `message_update` 先清文字，現列為未證實後續風險，不把它寫成已確認 bug。

## 2026-08-26 Deep identity handoff activation 教訓

- **Deep tools 啟用時序過早**：根因是 `continueDeepKnowledge` 建立新 attempt 後立即啟用 Deep Retrieval tools，但 identity-bearing followUp 尚未進入 `input`；修復為將 activation 延後至 exact `pendingReplayInvocation` input gate，先清 marker 再啟用工具。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、targeted 117/117、完整 `npm test` 211/211、`npm run check` exit 0。
- **可重用教訓**：內部 followUp 的 lifecycle marker 必須同時作為能力啟用 gate；工具可用性不得早於 identity 正式抵達。新增 2 個 timing regression 固定此順序。本輪未發現新 bug；Grill `message_end` 含 toolCall sibling risk 仍只是未證實的另案風險。

## 2026-08-26 Final review medium finding

- **半完成 handoff**：final review 發現 `requireDeepToolBoundary` 若只確認 tool boundary，可能在 `sendUserMessage` 無法送出 identity-bearing followUp 時誤報 handoff 完成。修復為兩個條件必須同時成立；證據：本 ticket 相關文件、targeted 117/117、`npm test` exit 0、`npm run check` exit 0。
- **可重用教訓**：跨 lifecycle 的完成條件要涵蓋能力邊界與實際 transport；任一必要步驟失敗都不得回報完成。本輪未發現新 bug。

## 2026-08-27 Deep stale-result loop

- **根因**：Deep identity followUp 在 input preflight 被提前消費；streaming stage panel 仍可成為 steer 並先於 followUp drain，舊 identity completion 因而反覆 stale reject。證據：真實 AgentSession／InteractiveMode／faux provider regression 與 `forge-runtime/artifacts/test-logs/deep-final-formal-red-20260827.log`。
- **修法教訓**：delivery 與 capability 要分離；工具可預載但 pending identity 必須保留到 matching `message_start`，pending 期間以 tool-call gate fail-closed。stage panel 使用 `displayOnly`，避免參與 agent-loop 排程。證據：`forge-runtime/extensions/forge-runtime.ts`、`deep-final-formal-green-20260827.log`、targeted 117/117、PI integration 10/10。
- **測試 fixture 教訓**：Grill 必須先 fetch evidence；成功 Deep search 契約是 `details.status=accepted`，不是 `candidateId`；TUI stage 應查 scrollback，避免 30 行 viewport 捲出造成假陰性。證據：`deep-target-extension-suite-20260827.log`、`deep-target-pi-integration-rerun-20260827.log`。
- **未解風險**：blocked tool result `terminate=false` 可能延遲 followUp；其他 Deep `/continue` panel 預設 sendMessage 仍可能形成 steer。這些是殘餘風險，本輪未擴修；本輪未發現新 bug。
- **可重用驗收教訓**：真實 PI 啟動成功不等於原始情境驗收完成。人工驗收必須保留原始輸入、關鍵輸出，以及指定錯誤字串是否出現的證據；本次只有 PI v0.83.0 啟動畫面列出 `forge-runtime.ts` 的 smoke check，沒有捕捉 stale 情境輸入／結果，因此仍標記為待人工驗收。證據：`docs/handoff.md`、`docs/tickets/deep-stale-result-loop-20260826.md`、本次啟動 smoke check 記錄。

## 2026-08-27 Deep target source contract 觀察

- **觀察**：使用者提供的實際輸出顯示 Grill 完成後第一次 `forge_deep_search` 回覆「Target source 不明確」，同批後續呼叫回覆「過期的 Deep Retrieval 嘗試已忽略」。目前尚無本 ticket 的自動測試證據，故不把修復前輸入缺少檔名寫成已驗證根因。證據：`docs/tickets/deep-target-source-contract-20260827.md`、`forge-runtime/extensions/forge-runtime.ts:548-560, 614-657, 1923-1931`、`forge-runtime/src/runtime/session-state.ts:376-405`、`pi-main/packages/agent/src/agent-loop.ts:489-584`。
- **教訓**：跨 source 的輸入契約應同時由 discriminated union 與 handler guard 固定；需要人類選擇時保留 `WAIT_USER` 邊界，不自動猜 target。正式契約見 [`ADR-0017`](../docs/adr/ADR-0017-deep-target-source-contract.md)。
- **狀態**：本輪未有自動測試、修復或新 GREEN 證據；不得宣稱已修復。

## 2026-08-28 Deep completion stale termination

- **根因**：已觀察到 completion stale return 缺少 `terminate: true`，造成過期結果被忽略後 agent loop 仍可能繼續；證據為 `forge-runtime/.tmp/diagnosis-20260828/exact-stale-log.txt` 與 production `forge-runtime/extensions/forge-runtime.ts` 的 completion stale branches（實作前須重新核對行號）。
- **修復方向**：只補 `forge_deep_retrieval_complete`／`forge_deep_complete` 共六個 stale return 的 termination，並以測試固定 status、terminate、state／工具不變，以及 fresh attempt 可再次 decision；不改 state machine 或 `CONTEXT_BUILD`。
- **狀態（規劃紀錄已由下方修復紀錄取代）**：本輪已完成實作與驗證；最新證據與 review-pending 狀態見下方修復教訓。

## 2026-08-28 Deep completion stale termination 修復教訓

- **根因**：六個 completion stale return 只回報 `status=stale`，缺少 `terminate: true`，過期結果被忽略後 agent loop 仍可能繼續。證據：`forge-runtime/extensions/forge-runtime.ts:941-1006,1120-1198`、`forge-runtime/.tmp/diagnosis-20260828/exact-stale-log.txt`。
- **修復**：六個 stale branch 補上 `terminate: true`；以 Retrieval／Understanding fresh-attempt public regression 固定 termination、state／工具不變與 fresh attempt 可再次 decision。證據：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts:5619` 起及三個 ticket 驗證 logs。
- **可重用教訓**：同步防禦分支若沒有公開 deterministic seam，不應新增私有 mock／test hook；以 public contract regression 加 production inventory 覆蓋。mixed tool batch 的 `every(terminate)` 行為仍是未處理風險。
- **測試契約**：兩個 public regression 使用規格名稱並完整覆蓋 fresh-attempt lifecycle；既有三個 stale tests 補上 `terminate` assertion。PI smoke 回 `smoke ok`、exit 0；證據：`forge-runtime/.tmp/final-focused-test.log`、`forge-runtime/.tmp/pi-smoke.log`。

## 2026-08-27 Deep target source contract 修復教訓

- **缺少 `targetSource` 誤進 `WAIT_USER`**：觀察到缺少檔名時被當成一般歧義；已驗證根因是 handler 未將 target source 契約視為可重試的輸入錯誤；修復為缺欄位回傳 retryable invalid 並保留 attempt。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/.tmp/targeted-regression-20260827.log`。
- **follow-up 沒有 manifest**：觀察到 Deep follow-up 只帶 identity；已驗證根因是 transport payload 未附 workflow snapshot candidates 建出的 target manifest；修復為在 identity JSON 前提供 manifest，讓 marker 後到字尾仍是純 JSON，並保留明確 target contract。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/.tmp/schema-phase-targeted-20260827.log`。
- **stale sibling 未 terminate**：觀察到同批過期呼叫只被忽略；已驗證根因是 stale 分支缺少終止訊號；修復為 stale sibling 回傳 `terminate: true`，避免持續循環。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/.tmp/targeted-regression-20260827.log`。
- **manifest 位置造成 parser 回歸**：觀察到首次把 manifest 接在 identity JSON 後使既有 parser 測試失敗；已驗證根因是 parser 仍假設固定 identity JSON shape；修復為同步 parser 與測試契約，並由 post-schema 驗證確認。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/.tmp/post-schema-test.log`、`forge-runtime/.tmp/post-schema-check.log`。
- **schema 與舊測試契約漂移**：觀察到 `targetSource` 一度仍為 optional，且舊測試以缺欄位表示歧義、只讀 top-level `properties`；已驗證根因是 schema、測試 fixture 與新巢狀 shape 未同時更新，Spec review 捕捉到 optional 缺口；修復為將 `targetSource` 設為 required、更新測試至新 shape，並以完整 217/217 與雙軸 re-review PASS 固定契約。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/.tmp/post-schema-test.log`、`forge-runtime/.tmp/post-schema-check.log`。

## 2026-08-28 Review correction

## 2026-08-28 Deep retryable recovery contract 設計教訓

- **target loop 觀察**：`manifest=[]` 時仍要求 `source=target` 的精確 target，造成反覆 `WAIT_USER`；source trace 與 deterministic replay 支持此 target loop 觀察。策略已固定為同 identity retryable invalid，要求模型改用明確 `wiki`／`code_base`。證據：使用者實際輸出、`forge-runtime/extensions/forge-runtime.ts` 的 target manifest／handler 路徑、`docs/adr/ADR-0017-deep-target-source-contract.md`。
- **duplicate decision 觀察**：`q-spi-role` 出現 duplicate decisionId 並被拒絕；目前只能標為觀察，尚未由完整 tool payload 確認是模型重送或 runtime merge 重複。策略保留拒絕，同 identity 修正重送唯一 IDs。證據：使用者實際輸出、`forge-runtime/src/evidence/evidence-engine.ts` duplicate guard、`docs/adr/ADR-0016-deep-knowledge-retrieval-understanding-evidence-package.md`。
- **可重用教訓**：輸入 invalid 與人類需要選擇的 ambiguity 必須分開；沒有候選清單時不應製造 `WAIT_USER` 選擇題。修復完成前先以 RED 測試證明 extension seam 是否足夠，避免預先擴大到 state layer。策略與測試契約見 [`ADR-0018`](../docs/adr/ADR-0018-deep-retryable-recovery-contract.md) 與 [`docs/PLAN-A.md`](../docs/PLAN-A.md)。

## 2026-08-28 Deep retryable recovery contract 修復教訓

- **空 manifest 誤走 ambiguity**：根因是空 target snapshot manifest 在共用 target ambiguity branch 被當成需要人類選擇；修復為在該 branch 前回 retryable invalid，要求模型改用 `wiki`／`code_base`，不呼叫 `handleDeepResult`。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/.tmp/deep-recovery-red-1.log`、`forge-runtime/.tmp/deep-recovery-focused-green.log`。
- **Duplicate decision invalid 缺 retryable 欄位**：根因是包含 `決策 ID 重複` 的 validator rejection 未標示可用同 identity 修正；最終修復只對該錯誤增加 `retryable:true`，其他 validation failure 維持原契約。證據：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/.tmp/deep-recovery-red-2.log`、`forge-runtime/.tmp/deep-recovery-review-focused.log`。
- **測試型別 `evidencePackage` 為 unknown**：根因是測試 assertion 直接存取未收窄的 unknown；修復為 assertion 局部 cast，`tsc` exit 0。證據：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/.tmp/deep-recovery-test-type-green.log`。
- **可重用教訓**：沒有候選的輸入錯誤應保留同一 attempt 讓模型修正；只有人類需要選擇時才建立 `WAIT_USER`。測試型別修正應局部收窄，不放寬 production contract。標準 suite/check 的既存失敗維持原樣，不可誤報為全綠；證據：`forge-runtime/.tmp/deep-recovery-npm-test.log`、`forge-runtime/.tmp/deep-recovery-check-rerun.log`。

### 初次 review：retryable 分類過寬

- **Bug**：把 `retryable:true` 放在通用 Evidence Package validation failure branch，會把非 duplicate 的驗證錯誤也錯分為可在同 identity 修正。
- **根因與修復**：回應分類沒有辨識 validator error 類型；修正為只有 errors 包含 `決策 ID 重複` 時標示 retryable，其他 validation failure 維持原回應。RED：`forge-runtime/.tmp/deep-recovery-review-red.log`；GREEN 129/129：`forge-runtime/.tmp/deep-recovery-review-focused.log`。
- **可重用教訓**：retryability 是錯誤分類契約，不是 validation failure 的通用屬性；應以可核對的錯誤類型窄化，並用負向測試固定非目標錯誤不帶 retryable。既有 TS18046 局部 cast 教訓保留，不以本段重複。

### 最終雙軸 re-review

- 初次 review 發現的 durable state、setup 重複、budget coverage、retryable 過寬、stale state 與 Plan A baseline 標示均已修正；相關 bug、根因與教訓保留在本文件既有段落。
- 最終 re-review 未發現新 bug：Standards P0/P1/P2=0；Spec P0/P1/P2=0。Final test refactor focused 129/129，證據：`forge-runtime/.tmp/deep-recovery-final-refactor-focused.log`。本結論不取代真實 PI 原情境人工驗收。

- **測試契約**：兩個 public regression 使用規格名稱並完整覆蓋 fresh-attempt lifecycle；既有三個 stale tests 補上 `terminate` assertion。最終 focused/full/check 與 PI smoke 證據分別為 `forge-runtime/.tmp/final-focused-test.log`、`forge-runtime/.tmp/final-full-test.log`、`forge-runtime/.tmp/final-check.log`、`forge-runtime/.tmp/pi-smoke.log`。

## 2026-08-29 Deep mixed-tool batch termination barrier 診斷教訓

- **已驗證 bug 現象**：同一 assistant message 的 Deep search 與 completion 混批時，search 的 `terminate=false` 與 completion 的 `terminate=true` 由 PI `every(terminate)` 聚合，無法以 completion 的終止訊號停止整批；後續可能出現舊 identity、平行 evidence race 或 follow-up 重複。證據：`pi-main/packages/agent/src/agent-loop.ts:344-356`、`:487-551`、`:572-582`，以及使用者提供的實際輸出。
- **可重用教訓**：completion stale guard 不能取代 transport batch barrier；必須在 Forge extension 以 call ID 記錄 mixed batch、search settle 與 follow-up queued 狀態。只改單一工具的 `terminate`、只改 prompt 或改 PI scheduler 都不能同時保證資料排序與架構邊界。完整核准策略見 [`ADR-0019`](../docs/adr/ADR-0019-deep-mixed-tool-batch-termination-barrier.md)。
- **尚未驗證風險**：PI awaited `message_end` before tools 與穩定 tool-call IDs 是 fragile assumption，需由 AgentSession/faux-provider integration test 監測；semantic decision/discovery gate 不在本 ticket，不將 prompt 語意分類寫成已驗證 runtime 根因。

## 2026-08-29 Deep mixed-tool batch termination barrier 收尾教訓

- **自動 stage panel 誤觸發 agent loop**：根因是 Forge 將不需人類決策的 stage panel 以 `deliverAs: "displayOnly"` 送出，但目前 PI contract 不支援該值，未知 delivery 會落入 steer 且 steer 優先。修復為刪除自動 stage panel 的 `sendMessage`，保留 `setStatus`；需要人類決策的 `WAIT_USER` 面板仍保留。證據：`forge-runtime/extensions/forge-runtime.ts` 自動 stage panel 路徑、`pi-main/packages/coding-agent/src/core/agent-session.ts:1481-1502`、AgentSession targeted 1/1 的本輪最新 log。
- **測試 workaround 越過 fail-closed**：曾嘗試放寬 `pendingReplayInvocation` gate 讓 integration test 通過，後續安全核驗確認會允許尚未完成正式 handoff 的 Deep tool call；該修改已撤回。證據：`forge-runtime/extensions/forge-runtime.ts:1388` gate、`C:\Users\User\AppData\Local\Temp\forge-runtime-agent-session-callid-red-20260829.log`、本輪 code review 結論。
- **string content 不是可靠的 replay／route 識別**：RED 重現顯示以訊息內容判斷會混淆 initial 與 barrier follow-up，故該假設與修正已撤回；現行 barrier 以 call ID、identity 與正式 `kind` 判斷。證據：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts` mixed-batch regression、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts` AgentSession regression、extension isolated 67/67 log。
- **可重用教訓**：自動 UI 更新若不需要人類決策，不應透過會進入 agent loop 的訊息通道；若 PI core contract 不支援 display-only，應移除多餘傳送或另開 core ticket，不能以 extension gate workaround 取代。check／回歸仍有既有 TUI terminal／highlight.js caveats，不能把局部綠燈宣稱為全域通過。

## 2026-08-29 流程優先於測試與顯示

- **可重用教訓**：測試通過與畫面出現都不能凌駕正式流程契約。不得修改 `pi-main`、放寬 fail-closed 或既有流程條件來製造綠燈；純顯示步驟若不參與狀態、傳輸或人類決策，應移除會進入 agent loop 的傳送，避免改變排程、順序或結果。
- **可核對證據**：正式行為見 `forge-runtime/extensions/forge-runtime.ts`；extension 回歸見 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`，AgentSession 回歸見 `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`；PI 既有訊息排序見 `pi-main/packages/coding-agent/src/core/agent-session.ts:1481-1502`。本次保留正式 fail-closed，移除自動 Deep stage panel 傳送，並保留需要人類決策的面板。

## 2026-08-29 WAIT_USER displayOnly 投遞設計教訓

- **觀察／根因**：WAIT_USER `publishState()` 仍將 `forge-stage` custom message 交給 `pi.sendMessage` 並指定 `displayOnly`；PI current 與官方 0.84.3 delivery union 只有 `steer`、`followUp`、`nextTurn`，未知值在 streaming 會落入 `steer`，可能使純顯示訊息進入 agent loop。證據：`forge-runtime/extensions/forge-runtime.ts:2115-2131`、`pi-main/packages/coding-agent/src/core/agent-session.ts:1496-1503`、`pi-main/packages/coding-agent/src/core/extensions/types.ts:1620-1623`。
- **教訓**：移除錯誤 delivery 欄位而保留 `sendMessage` 仍不安全；正確設計是移除 WAIT_USER `forge-stage` custom message 投遞，保留 state／status／人類輸入／followUp。相關 interactive 與 extension 測試為 `forge-runtime/tests/extensions/pi-grill-interactive.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。
- **狀態**：本輪只完成設計文件，未修復、未執行測試、未完成真實 PI TUI 驗證；不可宣稱 bug 已解決。

## 2026-08-29 WAIT_USER UI-only state publication 修復教訓

- **streaming `sendMessage` 未指定 trigger 會 steer**：根因是 PI streaming delivery 對未知或不適用的投遞選項會落入 steer；omission recovery 同時送出兩個 UI 訊息，使 provider call count 由預期 `2` 變成實際 `4`。修復為 WAIT_USER `displayOnly` 不再呼叫 `sendMessage`，omission 純顯示訊息使用 `triggerTurn: false`。證據：`forge-runtime/extensions/forge-runtime.ts:1351,1356,2131`、strict regression RED `C:\Users\User\AppData\Local\Temp\run_wait_user_red_test_20260829.log`、GREEN `C:\Users\User\AppData\Local\Temp\verify_wait_user_extension_contracts_20260829.log`。
- **InteractiveMode 測試選項 API 漂移**：根因是測試傳入現行 `InteractiveModeOptions` 不存在的 `terminal`／`uiMode` 形狀，導致輸入送至未啟動的 VirtualTerminal 而被丟棄。修復為使用現行 API、test-only attach、`init()` 後再 `run()`，並等待首個 render。證據：`forge-runtime/tests/extensions/pi-grill-interactive.test.ts:26,155,302,411,511,669,764`；static red 原有 10 個 terminal option errors，修正後 touched errors 為 0；PI interactive 3/3 logs：`C:\Users\User\AppData\Local\Temp\green_first_virtual_terminal_harness_retry_20260829.log`、`C:\Users\User\AppData\Local\Temp\green_second_virtual_terminal_harness_20260829.log`、`C:\Users\User\AppData\Local\Temp\green_third_virtual_terminal_harness_20260829.log`。
- **retry test fixture roundId 錯誤**：根因是 retry fixture 使用 `grill-retry-1`，但正式 retry 沿用目前的 `grill-1` round，故等待不到 `retry-attempt-completed`。修復為 fixture 改用 `grill-1`，保留正式 retry identity。證據：`forge-runtime/tests/extensions/pi-grill-interactive.test.ts:790`、retry RED／GREEN logs `C:\Users\User\AppData\Local\Temp\red_third_recovery_round_20260829.log`、`C:\Users\User\AppData\Local\Temp\green_third_virtual_terminal_harness_20260829.log`。
- **sandbox Node `os.userInfo` ENOMEM**：觀察到 sandbox 內 Node v24.14 執行部分檢查時回報 `os.userInfo`／`ENOMEM`，同一 baseline 在 sandbox 外成功；這是環境觀察，沒有證據把它寫成 Windows 資源耗盡根因。證據：隔離 check log `C:\Users\User\AppData\Local\Temp\forge-final-check-isolated-20260829.log` 及 sandbox 外 baseline log（見 `docs/handoff.md`）。
- **smoke oracle 不足**：普通 active stage 在 WAIT_USER 前出現是合法流程，不能把任意 `forge-stage` 字串視為 WAIT_USER publication regression；驗收必須同時固定時間點與 delivery 對應。cancel 結果為 inconclusive，不作為根因或 GREEN 證據。證據：`forge-runtime/tests/extensions/forge-runtime-extension.test.ts:704,4646`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts:764-810`、`C:\Users\User\AppData\Local\Temp\verify_wait_user_extension_contracts_20260829.log`。
