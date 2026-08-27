---
title: Forge Runtime v4 開發教訓
type: lessons-learned
scope: 已發現的 bug、根因、修復方式與可重用工程教訓
updated: 2026-08-27
source: 本 repo 的 agent-state、ADR、Plan、handoff 與測試證據
status: automated-verified-awaiting-real-session
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
