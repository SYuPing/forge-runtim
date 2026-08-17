# Plan A：Grill Completion Recovery 與真實互動驗收

日期：2026-08-13

狀態：原 Plan #1 至 #17 已 Completed（2026-08-14）；2026-08-15 prompt-contract 增補已完成。增補當時 focused 5/5、`npm test` 116/116、`npm run check` exit 0、Standards／Spec review 各 0 findings。這些結果不代表 Plan B current 驗證；不重開 #1 至 #17。

Prerequisite

- ADR-0008 已 Accepted，並 supersede ADR-0007 的 completion omission `continue` replay 規範。
- 既有 loader compatibility 工作已完成；`npm test` 99/99 與 `npm run check` 只是本計畫開始前的 baseline。
- 先由獨立測試子代理建立紅燈；主代理確認紅燈後，才可交給獨立實作角色修改 production code。

---

## Building

- 為每個 Grill attempt 記錄首次 completion omission 與 recovery marker；同一 attempt 最多進 recovery 一次。
- omission 後立即進 `GRILL + RECOVERY_REQUIRED`，顯示 retry／cancel／switch 並 settled；`message_end` 不 steer、不自動 replay、不自動 Deep。
- 新增明確 `/forge-runtime retry`，只由使用者觸發同 round／snapshot 的新 attempt；`continue` 不再處理 omission recovery。
- 讓 `NEEDS_CONFIRMATION` 立即顯示問題並進 `WAIT_USER`，回答後自動下一 Grill round；`READY_FOR_DEEP` 立即自動 Deep。
- 所有可見 panel 固定回傳 `content: panelText`、`display: true`。
- 更新 Grill prompt：不得輸出 assistant prose；需要確認時由 `forge_grill_complete.questions` 提交恰好一題。
- 空 manifest 可用零 evidence 提交來源／scope 問題；relevance gate 失敗顯示可回答問題並進 `WAIT_USER`。
- 以真實 PI TUI 驗收正常多輪、READY 自動推進、有界 recovery 與 assistant-turn 上限。
- 為真 PI TUI 建立最小 test-only seam：`InteractiveModeOptions` 新增 optional `terminal?: Terminal`，constructor 轉交既有 `createInteractiveTui`；省略時維持 factory 建立 `ProcessTerminal`。

## Not Building

- 不修改 `pi-main/` runtime workflow、其他功能或依賴；僅做核准的 test-only terminal seam，不新增 top-level workflow stage 或第三種 completion status。
- 不做自動 retry、background steer、retry backoff、queue 或 parallel workflow。
- 不重做 PI TUI、不實作固定 widget tree；只修正既有 panel／互動 lifecycle。
- 不改 Deep Knowledge 內容、candidate scoring 或知識來源邊界。
- 不把同一修復拆成另一份需要核准的 UI 計畫。

---

## Approach

### Gap 1：有界 attempt 與 explicit recovery

在既有 session round 狀態上加入最小 attempt／omission marker。首個 completion omission 原子地標記 recovery；相同 attempt 後續 terminal event no-op。`RECOVERY_REQUIRED` 只存在於 `GRILL` 內，不加入 state-machine top-level enum。recovery panel 發出後不安排 follow-up，確保 session settled。

使用者於 2026-08-13 已確認 interface：`ForgeSessionState` 以私有 attempt 狀態維護 omission budget；公開 `recordCompletionOmission(): boolean` 僅首次記錄並進 recovery 時回傳 `true`，重複事件回傳 `false` 且 no-op。`retryGrillRound(): GrillRound | undefined` 只在 recovery 中可用，保留 roundId、request 與 immutable snapshot 並重置 omission budget。`GrillRound` 不公開 attemptId 或 omission marker；retry 後新 attempt 的首次 omission 可再次回傳 `true`。這個小 interface 旨在維持 deep module，避免測試耦合私有狀態；private attempt interface 已於本 session 實作，#1 至 #3 targeted tests GREEN，但完整驗證仍未跑。

`/forge-runtime retry` 驗證目前確為 recovery，再重用既有 round、snapshot、decision summary 與 evidence cache建立新 attempt；新 attempt 有新的 omission budget。`continue` 在 recovery 中不 replay。

### Gap 2：正常 completion 與可見輸出

`NEEDS_CONFIRMATION` completion 在同一操作中以 `{ content: panelText, display: true }` 顯示唯一問題並轉 `WAIT_USER`；使用者回答沿既有 resume path 自動建立下一 round。`READY_FOR_DEEP` 通過 relevance gate 後直接執行既有 deep transition，不等待 command。

Grill invocation 移除「只輸出一個問題」，改為 completion-tool-only：需要確認時 `questions` 恰好一題，`READY_FOR_DEEP` 零題，兩者都不得輸出 assistant prose。

### Gap 3：Discovery completion guard

將首輪 evidence invariant 限定於 manifest 非空。空 manifest 允許零 evidence 的單一來源／scope 問題。relevance gate 失敗不再只 notify 錯誤；它建立可回答的來源／scope decision，顯示 panel 並進 `WAIT_USER`。

### Gap 4：真實 PI TUI 驗收

保留 unit／fake extension harness 作快速回歸，但完成 gate 必須另走真 PI TUI／extension lifecycle：觀察問題、回答、下一 round、READY 自動 Deep、omission recovery settled 與單次輸入的 assistant-turn 上限。

Fragile assumption：真實 PI TUI 驗收環境能提供可控的 completion／omission 回應。若 provider 不穩定，先建立受控但仍通過真 PI TUI 與 Forge extension lifecycle 的模型回應 seam；fake harness 不可替代最終互動驗收。

真實 TUI direct verification 必須使用 `--test-force-exit`：`InteractiveMode.run` 是 production 永久 loop，測試在 assertions／cleanup 完成後才強制結束 isolated process；這不代表新增 runtime abort seam。

Plan #14 seam assumption：只注入 `Terminal`，不注入 TUI factory；省略 `terminal` 時仍由 `createInteractiveTui` 建立 `ProcessTerminal`。此 seam 僅供 test-only 真 PI TUI 驗收，不改 runtime workflow 語意、不新增依賴、不改 pi-main 其他功能。

---

## Files

| 檔案 | 變動 |
| --- | --- |
| `forge-runtime/extensions/forge-runtime.ts` | attempt recovery、retry command、正常自動轉移、可見 panel、relevance failure routing |
| `forge-runtime/src/runtime/session-state.ts` | attempt／omission／recovery marker 與 bounded retry |
| `forge-runtime/src/grill/grill-result.ts` | 空 manifest 的 evidence completion guard |
| `forge-runtime/src/grill/grill-skill.ts` | completion-tool-only prompt 與 question contract |
| `forge-runtime/tests/runtime/session-state.test.ts` | attempt 與 retry state tests |
| `forge-runtime/tests/grill/grill-result.test.ts` | 空 manifest completion test |
| `forge-runtime/tests/grill/grill-skill.test.ts` | prompt contract test |
| `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | omission、panel、自動轉移、relevance failure integration tests |
| `forge-runtime/tests/extensions/pi-grill-interactive.test.ts` | NEW：真實 PI TUI 互動 acceptance |
| `forge-runtime/tsconfig.pi-interactive.json` | 真實 PI TUI test-only source paths 的核准 seam 設定 |
| `forge-runtime/package.json` | 確認 `test` runner 使用 `tsx --test --test-force-exit`，避免互動測試的 production loop 錯誤阻塞結束 |
| `pi-main/packages/coding-agent/src/modes/interactive-mode.ts` | #14：新增 optional `terminal` test-only seam，轉交既有 TUI factory |
| `FORGE_RUNTIME_Arch_v4.md`、`CONTEXT.md`、`docs/adr/ADR-0003` 至 `ADR-0008` | 已核准 contract 與 supersede 關係 |
| `docs/PLAN-A.md`、`docs/PLAN-B.md`、`docs/handoff.md`、`agent-state/*.md` | 計畫、互動驗收與 durable state |

production／test 預計 9 個檔案（1 新增、8 修改）；durable docs 依本次核准清單同步。

## Tests

| 測試 | 驗收條件 |
|---|---|
| `Extension_WhenCustomWaitUserFactoryRuns_ShouldRenderAndSubmitTrimmedAnswer` | fake custom 真正執行四參數 factory；Editor 可 render，Enter 送出 trim 後答案 |
| `Extension_WhenCustomWaitUserFactoryReceivesBlankThenEscape_ShouldReturnToSelectorWithoutDecision` | blank Enter 不完成，Escape 返回 selector，不新增 decision／round |
| `Extension_WhenWaitUserOptionCannotResume_ShouldKeepWaitUserAndCloseSelector` | 無 follow-up bridge 時普通選項只開一次 selector，維持 `WAIT_USER` 且不送出 user message |

| 測試 | 驗收條件 |
| --- | --- |
| `SessionState_WhenCompletionOmissionFirstOccurs_ShouldEnterRecoveryOnce` | 首次 omission 記錄一次並設定 recovery |
| `SessionState_WhenSameAttemptOmissionRepeats_ShouldRemainSingleRecovery` | 同 attempt 重複事件不新增 recovery |
| `SessionState_WhenExplicitRetryRequested_ShouldRetainRoundAndSnapshotAndStartNewAttempt` | retry 建立新 attempt但保留 round／snapshot |
| `Extension_WhenCompletionOmissionOccurs_ShouldShowRetryCancelSwitchAndSettle` | 顯示三個 action，且沒有待送 follow-up |
| `Extension_WhenStreamingMessageEndsWithoutCompletion_ShouldNotSteerOrAutoReplay` | `message_end` 不呼叫 steer／replay |
| `Extension_WhenContinueRequestedDuringRecovery_ShouldNotReplayAttempt` | recovery 中 continue 不重播 |
| `Extension_WhenCompletionNeedsConfirmation_ShouldDisplayQuestionAndEnterWaitUser` | 問題可見並進 `WAIT_USER` |
| `Extension_WhenUserAnswersQuestion_ShouldAutomaticallyStartNextGrillRound` | 回答後不需 continue 即開下一 round |
| `Extension_WhenCompletionReadyForDeep_ShouldAutomaticallyEnterDeepKnowledge` | READY 不需 continue 即進 Deep |
| `Extension_WhenPanelIsEmitted_ShouldUseVisibleContentContract` | panel 為 `content: panelText`、`display: true` |
| `GrillSkill_WhenInvocationBuilt_ShouldRequireCompletionToolWithoutAssistantProse` | prompt 無「只輸出一個問題」，只允許 completion tool contract |
| `GrillCompletion_WhenManifestIsEmpty_ShouldAllowSingleScopeQuestionWithoutEvidence` | 空 manifest 的單一 scope 問題可零 evidence 完成 |
| `Extension_WhenRelevanceGateFails_ShouldDisplayScopeQuestionAndEnterWaitUser` | gate failure 顯示可回答問題並進 WAIT_USER |
| `PiTui_WhenNeedsConfirmationCompletes_ShouldShowQuestionAndAdvanceAfterAnswer` | 真 PI TUI 問題可見且回答後下一 round |
| `PiTui_WhenReadyForDeepCompletes_ShouldAdvanceWithoutContinue` | 真 PI TUI 自動 Deep |
| `PiTui_WhenCompletionIsOmitted_ShouldRecoverOnceAndSettle` | 真 PI TUI 每 attempt recovery 一次且 settled |
| `PiTui_WhenSingleInputRuns_ShouldBoundAssistantTurns` | 單次輸入沒有無上限 assistant turns |

新增 17 條測試；`116` 是原始預估目標，不是硬 gate 或目前實測總數。刪除 ADR-0007 stale test 後，淨測試數會變動。

## 本 session 進度（2026-08-14）

- #1 至 #17 individual tests 已完成並 GREEN；使用者選擇方案 A 並核准 #14 的 test-only seam，#14 已 GREEN。
- focused batch、完整 suite、typecheck、真 PI TUI 與 review 已完成；Plan A acceptance 已完成。
- production 修改集中於 `forge-runtime/src/runtime/session-state.ts` 與 `forge-runtime/extensions/forge-runtime.ts`；測試 #7 已使用上方新名稱，ADR-0007 stale test 已刪除。

| 編號 | 狀態 |
| --- | --- |
| #1 至 #17 individual tests | completed / GREEN |
| #14 `PiTui_WhenNeedsConfirmationCompletes_ShouldShowQuestionAndAdvanceAfterAnswer` | approved seam / GREEN |
| focused batch、完整 suite、typecheck、review | completed / GREEN |

### Final review 與驗證收尾

- Standards review 曾發現 P1：非 active Grill attempt 的兩工具未 fail-closed；已以 `pendingGrillRun && stage===GRILL` 共同 gate 加上 execute guard 修正。
- Spec review 發現兩個驗收缺口並已補齊：正常 TUI 明確排除 `continue`；omission 靜置不自動 retry，輸入 `/forge-runtime retry` 才建立下一 attempt。
- `forge-runtime/tsconfig.pi-interactive.check.json` 已加入 Plan A 文件邊界；upstream 測試路徑修正為 `pi-main/packages/coding-agent/test/interactive-tui.test.ts`。
- runner 因 full-suite 並行造成 loader 30s timeout，`package.json` test 最小修正為 `--test-concurrency=1`，未放寬 timeout。
- 證據：P1 1/1 exit 0（`agent-state/plan-a-review-p1-green.log`）；TUI 4/4 exit 0（`agent-state/plan-a-review-tui-green.log`）；`npm run check` exit 0（`agent-state/plan-a-final-check.log`）；`npm test` 114/114 exit 0（`agent-state/plan-a-final-suite-after-review.log`）。upstream seam Vitest 4/4；upstream check 僅剩既有 `packages/ai` 測試型別錯誤。

## Execution Order

1. 獨立測試子代理先新增最小 session-state 與 extension omission tests，執行 focused batch，確認第一個紅燈並回報 failing test 與原因。
2. 確認紅燈後，獨立實作角色才加入 attempt／recovery marker、`retry` 與 no-steer terminal handling；驗證子代理重跑 focused tests。
3. 測試子代理再加入正常自動轉移、visible panel、prompt 與 discovery guard 的紅燈；實作角色逐 slice 做最小修正。
4. 測試子代理加入真實 PI TUI acceptance；先證明至少一個舊行為紅燈，再補齊必要 integration seam。
5. 獨立驗證角色執行 focused tests、完整 suite、type check 與真實 PI TUI acceptance。
6. 獨立 review 角色依 ADR-0008、Plan A 與真實互動證據審查；全部通過後才更新完成狀態與 handoff。

## Verification

```text
# 僅由獨立驗證子代理執行，從 repo root
cd forge-runtime && npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-name-pattern='^PiTui_WhenNeedsConfirmationCompletes_ShouldShowQuestionAndAdvanceAfterAnswer$' tests/extensions/pi-grill-interactive.test.ts
cd forge-runtime && npx tsx --test tests/runtime/session-state.test.ts tests/grill/grill-result.test.ts tests/grill/grill-skill.test.ts tests/extensions/forge-runtime-extension.test.ts
cd forge-runtime && npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit tests/extensions/pi-grill-interactive.test.ts
cd forge-runtime && npm test
cd forge-runtime && npm run check

# 驗證結果：focused batch、完整 suite、type check 與真 PI TUI 均已完成；116 僅為原始預估，不是硬 gate。
# #14 至 #17 與 final review 均已 GREEN；Plan A acceptance 已完成。
# 真實 PI TUI：問題可見、回答後下一 round、READY 自動 Deep、每 attempt omission recovery 一次且 settled、單次輸入 assistant turns 有界。
```

---

## 2026-08-15 增補 Plan A：WAIT_USER 選項語意契約（Completed）

本增補不重開已完成的 Plan A #1 至 #17；只先補上 Plan B 固定自由輸入入口所依賴的最小 prompt contract。

### Building

- 規定 `questions[].options` 只能包含可直接記錄為 decision 的完整答案。
- 禁止把「請輸入／請提供……」等操作指示放入 options；自由文字由 `WAIT_USER` 的系統「自行輸入…」入口負責。

### Not Building

- 不加入選項文案 heuristic 或語意 parser。
- 不修改 grill result schema、workflow stage、completion status 或 `pi-main/`。

### Approach

只在 `buildGrillingSkillInvocation` 既有 options 規則旁補一條明確約束；結構驗證仍維持既有 string array contract。這避免 UI 猜文案，也避免為單一互動新增 schema。

Fragile assumption：prompt 約束能大幅減少操作指示型 options，但不提供機器層語意證明；固定「自行輸入…」仍是使用者可逃離錯誤候選的 UI 邊界。

### Files

| 檔案 | 變動 |
| --- | --- |
| `forge-runtime/src/grill/grill-skill.ts` | 補上 options 必須是完整答案的 prompt contract |
| `forge-runtime/tests/grill/grill-skill.test.ts` | 新增兩個 prompt contract tests |

共 2 個檔案（0 新增 + 2 修改）。

### Tests

| 測試 | 驗收條件 |
| --- | --- |
| `BuildGrillingSkillInvocation_WhenOptionsAreRequested_ShouldRequireCompleteRecordableAnswers` | invocation 明確要求 options 可直接記錄為 decision |
| `BuildGrillingSkillInvocation_WhenFreeTextIsAvailable_ShouldForbidInputInstructionOptions` | invocation 禁止操作指示型 options，並把自由輸入責任交給 WAIT_USER UI |

### Execution Order

1. 獨立測試子代理先新增上述兩個測試並執行 focused batch，確認第一個紅燈及失敗原因。
2. 確認紅燈後，獨立實作角色才修改 `grill-skill.ts` 做最小 GREEN。
3. 獨立驗證角色重跑 focused test、完整 suite 與 type check。
4. 獨立 review 角色確認沒有 schema、狀態機或 `pi-main/` 變更後，才進 Plan B。

### Execution Result

- 增補已完成並通過 focused test、完整 suite、type check 與獨立 review；未重開 Plan A #1 至 #17。
- Plan B 的 custom Editor 依賴決策已批准：Forge package 使用 `@earendil-works/pi-tui@0.83.0`，只改 Forge package，不改 `pi-main/`；後續以 RED→GREEN 進入固定「自行輸入…」slice。

### Verification

```text
# 僅由獨立驗證子代理執行，從 repo root
cd forge-runtime && npx tsx --test tests/grill/grill-skill.test.ts
cd forge-runtime && npm test
cd forge-runtime && npm run check

# 期望：既有 114 + 新增 2 = 116 passed / 0 failed；type check 通過。
```

## 2026-08-16 增補實測同步

> 歷史段落：本節的 47/44、OOM 與待 RED→GREEN 順序已由下方「最終完成狀態」取代，保留作診斷與時間線證據，不代表目前 blocker。

- prompt-contract 增補已實測完成，並保留上述當時的 focused 5/5、`npm test` 116/116、`npm run check` exit 0 與兩軸 review 0 findings 證據。
- 這不代表 Plan B 的 current 驗證完成；Plan B selector slice 只有歷史 71/71 證據，不能當作目前完整 suite。
- 四參數 custom factory、Theme adapter、冗餘 `onEscape` 移除與有效答案 resume 後結束 command 均已完成；focused regression tests 3/3、`npm run check` exit 0，final Standards／Spec review 皆 0 blocker，scope blast 無 sibling bug。
- 歷史結果：`npm test` exit 1：47 tests 中 44 pass、3 fail；約 123 秒、約 4GB heap OOM，另有 2 個 loader timeout。`selectList` formatter 尚無實際 autocomplete render coverage。
- 真實 PI TUI acceptance 與 current full suite 仍待完成；ticket 不得標記完成，舊 OOM／type-import probe 未執行。本段舊順序已由下方最終 closure 取代。

---

## 歷史 Plan A（已完成）

> 以下只保留執行歷史，不可作為下一輪規範。completion omission 的 continue replay 與空 manifest 首輪 evidence 規則均由 ADR-0008／本檔最上方的新 Plan A supersede。

# Plan A：Forge Runtime v4 Grill 工具化多輪決策迴圈

日期：2026-08-11

狀態：Completed，2026-08-13 final schema exactness 與文件語意 follow-up 完成，完整驗證 97/97 與 type check 均通過。

Prerequisite

- `docs/adr/ADR-0006-grill-readonly-candidate-verification.md` 與 `docs/adr/ADR-0007-grill-completion-tool.md` 均為 Accepted。
- `FORGE_RUNTIME_Arch_v4.md` 已同步為 `WAIT_USER → USER_CONFIRMED → GRILL* → READY_FOR_DEEP → DEEP_KNOWLEDGE`。
- 本輪無 View／widget tree 新需求；`docs/PLAN-B.md` 維持不變。

---
Building

- 把 Light Discovery 輸出凍結為不可變 `GrillEvidenceSnapshot`，以 opaque `candidateId` 提供 wiki、code_base 與存在時的 target source。
- 以 session 內 round／decision ledger 管理 `roundId`、已查核 evidence、已回答 `decisionId` 與同一 round 的 explicit replay。
- 在 Forge extension 註冊 `forge_grill_evidence(candidateId)` 與 `forge_grill_complete(payload)`；Grill 期間只暴露這兩個 tool，並以 `tool_call` deny-by-default 作硬性防線。
- 以 completion tool（而非 assistant 終局文字 JSON）推進 `WAIT_USER` 或 Deep Knowledge；完成後壓制同一 agent turn 的殘餘 prose。
- 將使用者的選項與自由回答統一記為 decision record，經 `WAIT_USER → USER_CONFIRMED → GRILL` 進入下一輪；只有 `READY_FOR_DEEP` 才進 Deep Knowledge。
- 未呼叫 completion tool 的終局回覆顯示 `GRILL_COMPLETION_REQUIRED`，直接提示 `/forge-runtime continue` 與 `/forge-runtime switch <request>`，不做自動重試。

Not Building

- 不修改 `pi-main/`，不使用 provider-specific `toolChoice` 或強制 tool call payload hack。
- 不允許 Grill 使用 `bash`、`read`、`grep`、`find`、`ls`、`edit`、`write`、網路或未知 tool。
- 不新增第三種 Grill result status、背景 steer／follow-up retry、queue、parallel workflow 或跨 session round persistence。
- 不改 Deep Knowledge candidate relevance gate、Deep executor、既有 UI widget tree 或 `docs/PLAN-B.md`。
- 不移除 `/forge-runtime grill-result` 與 `/forge-runtime grill ambiguous <json>`；兩者只保留為明確測試／除錯 injection。`/grill-run` 是歷史命令相容 alias，會正規化進 formal ingress，不另建 bypass lifecycle。

---
Approach

[Gap 1 - 不可變證據 snapshot 與多輪 decision ledger]

`LightDiscoveryResult` 目前只有摘要與 code_base candidates，不能限制 Grill 的查核範圍。擴充它以在 Light Discovery 當下建立 `GrillEvidenceSnapshot`：依固定來源順序為每筆明確引用的 wiki 文件、code_base candidate、存在時的 target source 發出 deterministic opaque `candidateId`，並保存 title、source、content 與 evidence metadata。Grill tool 只能讀這份記憶體 snapshot，不接受 path。

`ForgeSessionState` 新增最小內部 ledger：current round、已完成 round、已查核 candidate ids、已回答 decision ids、待回答 decision。`recordAnswer` 先走 `WAIT_USER → USER_CONFIRMED`，再以同一 snapshot 建立下一個 round；同一 `decisionId` 重複作答或完成一個已完成／過期 round 都拒絕。`continue` 不建立新 round，而是重播 current round 與既有 evidence cache。

`USER_CONFIRMED → GRILL` 是新合法 transition；不新增 workflow stage，也不讓 `reject` 直接手寫 UI stage。

Fragile assumption：Light Discovery 已持有產生 snapshot 所需的內容；若某一候選只保留路徑，必須在 Light Discovery 建立 snapshot 時讀取一次，而不能讓 Grill 重新開任意檔案。

[Gap 2 - 兩個 domain tool 與硬性工具邊界]

在 `forgeRuntimeExtension()` closure 中註冊兩個 official Pi custom tools，並在每個 Grill round 前以 `getActiveTools()` 保存原工具面、`setActiveTools(["forge_grill_evidence", "forge_grill_complete"])` 顯示最小工具面。離開 Grill、cancel 或 switch 時還原原工具面；`tool_call` handler 同時在 pending Grill 期間 block 一切非這兩個名稱的呼叫，因 active-tool 切換只在下一個 agent turn 生效。

`forge_grill_evidence` 只接受 `{ candidateId }`，回傳 snapshot 中對應 evidence 並登記已查核。`forge_grill_complete` 採 sequential execution，接受既有 structured result 欄位加 `roundId`；payload 只可引用已查核 ids，新 snapshot 的第一輪至少要有一筆 evidence 查核。兩個 schema 使用 Pi official `typebox` package `1.3.7`，不自行發明 JSON-schema adapter。

[Gap 3 - completion 成為唯一控制通道]

抽出 completion payload validation，重用 `parseStructuredGrillResult()` 的 status、問題、recommendation 與 evidence 檢查，另驗證 runtime-issued `roundId`、fetched evidence subset 與未回答 `decisionId`。`NEEDS_CONFIRMATION` 呼叫既有 WAIT_USER panel；`READY_FOR_DEEP` 直接走既有 `continueDeepKnowledge()`。

completion 成功時在 tool execute 內一次完成 state transition、清除 pending Grill parser 狀態、標記該 assistant turn 要 suppress，並回傳最小 tool result；不呼叫 `ctx.abort()`。`message_update`／`message_end` 只清除這個完成 turn 的殘餘 text；正常 runtime 不再 parse assistant terminal JSON。若 terminal assistant message 沒有 completion，發 `GRILL_COMPLETION_REQUIRED` 與可操作指令提示，保留 current round。

[Gap 4 - 單一路徑 resume 與既有命令相容]

建立單一 `resumeGrillWithAnswer`／round prompt helper，所有 typed answer、selector selection、`confirm`、`reject <text>` 都先產生 decision record，再回到新 Grill round。selector 將選擇值以 Pi `sendUserMessage(..., { deliverAs: "followUp" })` 送回同一 input path；內部 round invocation 以 closure guard 防止輸入 router 把它誤判成新工作流。`/forge-runtime continue` 走同一 helper，但使用 current round、不新增 decision 或 snapshot；`switch` 的 replacement 必須經正式 ingress（自然請求／asset approval），不得改走 `/grill-run` bridge。

`buildGrillingSkillInvocation()` 改為提供 task、round id、snapshot manifest、已確認 decision、兩個 domain tools 與 completion contract；移除「輸出文字 JSON」指令。`parseStructuredGrillResultMessage()` 保留給 `/forge-runtime grill-result` 測試／除錯入口。

---
Files

┌──────────────────────────────────────────────────────────────────────────────┬─────────────────────────────────────────────────────────────┐
│ 檔案                                                                         │ 變動                                                        │
├──────────────────────────────────────────────────────────────────────────────┼─────────────────────────────────────────────────────────────┤
│ forge-runtime/package.json                                                   │ 加入 pinned `typebox` 1.3.7 runtime dependency               │
│ forge-runtime/package-lock.json                                              │ 鎖定 `typebox` 1.3.7                                         │
│ forge-runtime/extensions/forge-runtime.ts                                    │ custom tools、allowlist、completion／omission、resume routing │
│ forge-runtime/src/discovery/light-discovery.ts                               │ 建立 immutable GrillEvidenceSnapshot                          │
│ forge-runtime/src/grill/grill-result.ts                                      │ completion payload validation 與 round/evidence checks        │
│ forge-runtime/src/grill/grill-skill.ts                                       │ 工具化 round prompt；保留 debug parser                        │
│ forge-runtime/src/runtime/session-state.ts                                   │ round／decision／evidence ledger 與 replay                    │
│ forge-runtime/src/workflow/state-machine.ts                                 │ 允許 USER_CONFIRMED → GRILL                                   │
│ forge-runtime/tests/extensions/forge-runtime-extension.test.ts               │ custom tool、gate、completion、omission、resume integration   │
│ forge-runtime/tests/grill/grill-result.test.ts                               │ round id 與 evidence provenance validation                   │
│ forge-runtime/tests/workflow/state-machine.test.ts                           │ 多輪合法 transition                                            │
│ forge-runtime/tests/runtime/session-state.test.ts                            │ NEW：ledger、duplicate decision、replay                        │
│ FORGE_RUNTIME_Arch_v4.md                                                     │ 已更新多輪 Grill 流程                                         │
│ CONTEXT.md                                                                   │ 已記錄 accepted boundary                                      │
│ docs/adr/ADR-0006-grill-readonly-candidate-verification.md                   │ NEW：已記錄 scope／tool boundary                              │
│ docs/adr/ADR-0007-grill-completion-tool.md                                  │ NEW：已記錄 completion contract                               │
│ docs/PLAN-A.md                                                               │ 本計畫與歷史 Plan A                                           │
│ docs/handoff.md                                                              │ 交接至本計畫                                                  │
└──────────────────────────────────────────────────────────────────────────────┴─────────────────────────────────────────────────────────────┘

共 18 個檔案（3 新增 + 15 修改）；其中 6 個為既有設計／交接文件。

Tests

┌─────────────────────────────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────┐
│ 測試                                                                                        │ 驗收條件                                                                     │
├─────────────────────────────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────┤
│ StateMachine_WhenUserConfirms_ShouldAllowReturnToGrill                                      │ `WAIT_USER → USER_CONFIRMED → GRILL` 合法                                   │
│ SessionState_WhenAnswerRecorded_ShouldEnterUserConfirmedThenGrill                           │ answer 成為 decision record 並建立新 round                                   │
│ SessionState_WhenDecisionAlreadyAnswered_ShouldRejectDuplicate                              │ 重複 decision id 不改變 state                                                │
│ SessionState_WhenContinueRequested_ShouldRetainRoundAndSnapshot                             │ replay 不新增 round、snapshot 或 decision                                    │
│ GrillCompletion_WhenRoundMatchesAndEvidenceFetched_ShouldParse                              │ 有效 payload 被接受                                                          │
│ GrillCompletion_WhenRoundIsStale_ShouldReject                                                │ 錯誤 roundId 被拒絕                                                          │
│ GrillCompletion_WhenEvidenceWasNotFetched_ShouldReject                                      │ 未經 evidence tool 的 id 被拒絕                                              │
│ Extension_WhenGrillStarts_ShouldExposeOnlyDomainTools                                       │ active tools 只含兩個 Forge tool                                              │
│ Extension_WhenNonDomainToolIsCalledDuringGrill_ShouldBlock                                  │ native／未知 tool 在 tool_call 被 block                                       │
│ Extension_WhenEvidenceCandidateIsKnown_ShouldReturnSnapshotContent                          │ candidateId 回傳已凍結內容並登記 fetched                                     │
│ Extension_WhenEvidenceCandidateIsUnknown_ShouldReject                                       │ 偽造 id 不讀檔、不改 state                                                    │
│ Extension_WhenCompletionNeedsConfirmation_ShouldEnterWaitUserAndHideProse                   │ `NEEDS_CONFIRMATION` 顯示 WAIT_USER，餘下 prose 不顯示                       │
│ Extension_WhenCompletionIsReady_ShouldEnterDeepKnowledgeAndHideProse                        │ `READY_FOR_DEEP` 走既有 Deep executor，餘下 prose 不顯示                     │
│ Extension_WhenTerminalMessageOmitsCompletion_ShouldPromptContinueAndSwitch                  │ 顯示錯誤與兩個明確指令，round 保留                                            │
│ Extension_WhenUserAnswerIsReceived_ShouldRecordAndStartNextGrillRound                       │ option／free text 均經同一 resume path                                       │
│ Extension_WhenContinueIsRequested_ShouldReplaySameRound                                     │ 明確 continue 再送相同 round prompt，不重跑 Discovery                        │
└─────────────────────────────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────────────────────────┘

新增 16 條測試；預期 `55 + 16 = 71` passed、0 failed。

Execution Order

1. 子代理先在 `state-machine`、`session-state` 與 `grill-result` 補上述最小測試，執行指定測試並確認現況紅燈。
2. 主代理確認紅燈後，先完成 state transition、session ledger、snapshot 與 completion payload validation；子代理重跑相關測試。
3. 子代理新增 extension harness 的 `registerTool`／`tool_call` 支援與雙 domain tool 的 red tests，確認 native tool gate 與 candidate scope 在舊程式碼失敗。
4. 主代理在 extension 實作 custom tool、active-tool restore、completion／omission suppression 與單一路徑 resume；每完成一個 slice 都由子代理重跑相關測試。
5. 子代理執行完整 `forge-runtime` test 與 type check；只有 71/71 綠燈才更新完成狀態與 handoff。

---

## Execution Progress：2026-08-12

已完成的 red → green slices：

1. `StateMachine_WhenUserConfirms_ShouldAllowReturnToGrill`：先證明舊實作拒絕 transition，後加入 `USER_CONFIRMED → GRILL`；指定測試檔為 2 passed、0 failed。
2. `SessionState_WhenAnswerRecorded_ShouldEnterUserConfirmedThenGrill`、`SessionState_WhenDecisionAlreadyAnswered_ShouldRejectDuplicate`、`SessionState_WhenContinueRequested_ShouldRetainRoundAndSnapshot`：已加入最小 answer／duplicate／round-replay session contract；指定測試檔為 3 passed、0 failed。
3. `GrillCompletion_WhenRoundMatchesAndEvidenceFetched_ShouldParse`、`GrillCompletion_WhenRoundIsStale_ShouldReject`、`GrillCompletion_WhenEvidenceWasNotFetched_ShouldReject`：已加入 TypeBox completion schema 與 round／evidence validation；指定測試檔為 6 passed、0 failed。
4. `forge-runtime/package.json` 與 lockfile 已鎖定 runtime dependency `typebox@1.3.7`。
5. `Extension_WhenGrillStarts_ShouldExposeOnlyDomainTools`、`Extension_WhenNonDomainToolIsCalledDuringGrill_ShouldBlock`：已完成 domain-tool allowlist 與非 domain `tool_call` deny gate；兩項皆 targeted green，尚未執行完整 suite／type check。
6. `Extension_WhenEvidenceCandidateIsKnown_ShouldReturnSnapshotContent`、`Extension_WhenEvidenceCandidateIsUnknown_ShouldReject`、`LightDiscovery_WhenSnapshotCreated_ShouldDeepFreezeEvidence`：Light Discovery 已建立 runtime deep-frozen snapshot，以 `ev-<SHA-256>` manifest 提供候選；evidence tool 只回傳 snapshot content／metadata，unknown ID 固定拒絕。
7. `Extension_WhenGrillIsCancelled_ShouldRestorePreviousActiveTools`、`Extension_WhenGrillIsSwitched_ShouldRestorePreviousActiveTools`：cancel 與 switch fallback 已還原 Grill 前的 active tools；兩項皆 targeted green。
8. `Extension_WhenCompletionNeedsConfirmation_ShouldEnterWaitUserAndHideProse`：completion tool 已先驗證 round／fetched evidence，再以 `NEEDS_CONFIRMATION` 進入 `WAIT_USER`；同一 Grill turn 的 streaming prose／thinking 仍受 suppression。targeted green。

尚未開始或尚未完成：

- Light Discovery 建立 immutable `GrillEvidenceSnapshot`。
- completion `READY_FOR_DEEP` 對 Deep Knowledge 的單一路徑 transition、completion turn 的 terminal-prose suppression、completion omission handling。
- option／free-text resume、extension `/forge-runtime continue` replay transport，以及完整 suite／type check／review。

### Snapshot contract（2026-08-12，使用者已確認）

- 每個 candidate ID 固定為 `ev-<完整 SHA-256>`；輸入使用 Light Discovery 當下已選定來源的 canonical metadata 與內容，ID 不接受模型自訂。
- snapshot 在建立時做 runtime deep-freeze，只收錄 Light Discovery 實際選出的 wiki 文件、code_base candidate 與存在時的對應 target source。
- `forge_grill_evidence({ candidateId })` 的已知 ID 回傳 frozen snapshot 的 `content` 與最小 metadata，並登記為 fetched；unknown ID 一律以固定錯誤拒絕，不讀檔、不改 state。
- canonical hash preimage 固定為 `JSON.stringify(["forge-grill-evidence-v1", kind, canonicalSource, normalizedContent])`；`canonicalSource` 為 `wiki/`、`code_base/` 或 `target/` 下的 root-relative path，`normalizedContent` 將 CRLF／CR 正規化為 LF。不得把絕對路徑、排序、score 或 discovery ID 納入 hash。
- snapshot candidate 固定包含 `candidateId`、`kind`、`title`、`source`、`content`、`metadata`；runtime deep-freeze 必須涵蓋 snapshot、candidate record、candidate、metadata 及其中的陣列。unknown candidate 固定拒絕為 `GRILL_EVIDENCE_CANDIDATE_NOT_FOUND`。
- 這些決定解除 snapshot production implementation 的暫停；其餘 Plan A 邊界不變。

目前尚未執行完整 `npm test`、`npm run check`；`71 passed` 仍是驗收目標，不是實測結果。CodeGraph 已同步但無法展開 extension nested handler 與 test harness；使用者已授權下一 session 唯讀檢視 `forge-runtime/extensions/forge-runtime.ts` 與 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` 以完成下一個 TDD slice。

### 最新續作狀態（2026-08-12）

本段取代上方「尚未開始或尚未完成」的 extension lifecycle 狀態；舊段保留為歷史執行順序。

已完成 targeted green：

1. `Extension_WhenGrillStarts_ShouldExposeOnlyDomainTools`、`Extension_WhenNonDomainToolIsCalledDuringGrill_ShouldBlock`：Grill 僅暴露兩個 domain tool，非 domain tool 在 `tool_call` 被 block。
2. `Extension_WhenEvidenceCandidateIsKnown_ShouldReturnSnapshotContent`、`Extension_WhenEvidenceCandidateIsUnknown_ShouldReject`、`LightDiscovery_WhenSnapshotCreated_ShouldDeepFreezeEvidence`：Light Discovery 以 `ev-<完整 SHA-256>` manifest 建立 runtime deep-frozen snapshot；evidence tool 只讀 snapshot，unknown ID 固定拒絕。
3. `Extension_WhenGrillIsCancelled_ShouldRestorePreviousActiveTools`、`Extension_WhenGrillIsSwitched_ShouldRestorePreviousActiveTools`：cancel／switch 恢復 Grill 前 active tools。
4. `Extension_WhenCompletionNeedsConfirmation_ShouldEnterWaitUserAndHideProse`、`Extension_WhenCompletionIsReady_ShouldEnterDeepKnowledgeAndHideProse`：completion 成功後依 payload 分流至 `WAIT_USER` 或既有 deep-knowledge transition。
5. `Extension_WhenCompletionSuccessIsFollowedByTerminalProse_ShouldSuppressOnlyThatTurn`、`Extension_WhenTerminalMessageOmitsCompletion_ShouldPromptContinueAndSwitch`：completion 成功只壓制同一 turn prose；正常未 completion 的 terminal prose 改發 `GRILL_COMPLETION_REQUIRED`，保留 round 並提示 continue／switch。
6. `Extension_WhenGrillInvocationIsBuilt_ShouldExposeRuntimeIssuedRoundIdAndCompletionContract`：自然／approval Discovery 路徑公開 runtime-issued `roundId`、snapshot manifest、兩個 domain tool 與 completion contract。
7. legacy terminal-JSON 測試已遷移為 completion path 或明確 `/forge-runtime grill-result` debug command；`tests/extensions/forge-runtime-extension.test.ts` 實測 48 passed、0 failed。

尚待完成：

- 三個 review-derived safety slices。
- 完整 `forge-runtime` test suite、`npm run check` 與 final review。

已完成 targeted tests：option／free-text answer resume、`/forge-runtime continue` 同 round replay，以及 switch replacement 經正式 ingress。`/grill-run` 是歷史命令相容 alias，會正規化進 formal ingress；`/forge-runtime grill ambiguous <json>` 僅作低階測試／除錯 injection。

---
Verification

```text
# 僅由子代理執行，從 repo root
cd forge-runtime && npx tsx --test tests/workflow/state-machine.test.ts tests/runtime/session-state.test.ts tests/grill/grill-result.test.ts tests/extensions/forge-runtime-extension.test.ts
cd forge-runtime && npm test
cd forge-runtime && npm run check

# 期望：npm test 0 failed；npm run check 通過。
```

---
Approval and Completion Gate

- 使用者已確認本 Plan A，實作可依 Execution Order 繼續。
- 只有完整 suite、type check 與 review 通過後，才可將本計畫標記為 Completed。

---

## Completion：2026-08-13

- 三個 safety slices 均完成：continue replay 攜帶既有 decision；缺 followUp bridge 時 confirm／reject／selector 維持 `WAIT_USER`；缺 `newSession` 或 replacement 被取消時 switch 保留原 workflow。
- final review 修正：正常 Grill prompt 改為 completion-tool-only；`READY_FOR_DEEP` completion 離開 Grill 後還原原 active tools；缺少完整 tool-boundary capability 時拒絕啟動或重播 Grill。
- 舊測試中假設無 `newSession` 仍可成功 switch、或無 followUp 仍可 direct reject 的互斥契約已移除；成功 switch 測試改用具 `newSession` 的最小 fixture。
- 完整驗證由獨立代理執行：`cd forge-runtime && npm test` 為 77/77 通過；`cd forge-runtime && npm run check` 通過。
- 本輪不改 `pi-main/`、不新增 queue／parallel workflow；`/grill-run` 保留歷史命令相容性，但只會正規化進 formal ingress，取得正式 round／snapshot，不保留獨立 bypass lifecycle。
- 複審 follow-up：首輪 snapshot completion 強制至少一筆已查核 evidence；`NEEDS_CONFIRMATION` 恰好一題、`READY_FOR_DEEP` 無題；無 followUp bridge 的 continue 與 cancel 後 pending closure state 均安全停留／清除。
- 最終獨立驗證：`cd forge-runtime && npm test` 為 83/83 通過；`cd forge-runtime && npm run check` 通過。
- 第三次最終驗證：`cd forge-runtime && npm test` 為 89/89 通過；`cd forge-runtime && npm run check` 通過。
- 第四次最終驗證：`cd forge-runtime && npm test` 為 93/93 通過；`cd forge-runtime && npm run check` 通過。
- 第五次最終驗證：`cd forge-runtime && npm test` 為 94/94 通過；`cd forge-runtime && npm run check` 通過。
- 第六次最終驗證：`cd forge-runtime && npm test` 為 97/97 通過；`cd forge-runtime && npm run check` 通過。
- 第七次最終驗證：`cd forge-runtime && npm test` 為 97/97 通過；`cd forge-runtime && npm run check` 通過。

## 歷史 Plan A：Forge Runtime v4 Grill Terminal Result Lifecycle Repair

日期：2026-08-10

狀態：Completed；使用者確認後已依本計畫完成最小修復與驗證。

Prerequisite（若有）

- `docs/adr/ADR-0005-grill-terminal-result-lifecycle.md` 已獲得使用者確認。
- `docs/PLAN-B.md` 維持原狀，因本輪不涉及 UI 或 widget tree。

---
Building

- 修正 `GRILL` turn 在 assistant tool-call iteration 後，過早清除 `pendingGrillRun` 的 lifecycle bug。
- 只對不含 `toolCall` 的終局 assistant message 解析 `StructuredGrillResult`。
- 終局結果有效時，維持既有分流：`NEEDS_CONFIRMATION → WAIT_USER`；`READY_FOR_DEEP → DEEP_KNOWLEDGE_RETRIEVAL → KNOWLEDGE_UNDERSTANDING`。
- 終局結果無效時，發出受控 `GRILL_RESULT_PARSE_ERROR`，不假裝完成、不中途洩漏一般 prose，且不自動重試。
- 新增最小回歸測試，覆蓋 tool-call 後才收到終局 Grill result 的三條分支。

Not Building

- 不修改 `pi-main/`。
- 不新增自動 retry、背景重問、queue 或第二個 workflow。
- 不重寫 `.pi/skills/grilling/SKILL.md`、不改模型 provider，也不導入跨 provider 的 JSON mode。
- 不修改現有 `WAIT_USER` selector、status/widget tree 或 Deep Knowledge 的候選 relevance 規則。

---
Approach

[Gap 1 - Terminal Grill Result Detection]

PI 會為每個 assistant response 發送 `message_end`，而 tool calls 是一個或多個非終局 assistant response。extension 必須將含 `toolCall` 的 message 視為 Grill 仍在進行中：保留 `pendingGrillRun`、維持 streaming suppression、且不 parse。只有不含 `toolCall` 的終局 assistant message 才可消耗 pending flag 並 parse。

Fragile assumption：PI 會將每個工具呼叫保留為 `content.type === "toolCall"`；若上游改變事件模型，必須重新以 CodeGraph 驗證 lifecycle，而不是改動 `pi-main/`。

[Gap 2 - Controlled Invalid Final Result]

終局 assistant message 若不是有效 `StructuredGrillResult`，workflow 必須保留明確失敗訊號，而不是讓一般文字成為流程終點。此計畫推薦不做自動 retry：格式修復會改變一次 agent turn 的語義並增加隱性重試；使用者可透過既有明確入口重新發起 Grill。

已確認決策：採用「顯性 error、無自動 retry」；替代方案是一次受控的內部重試，但不納入本 Plan A。

---
Files

┌─────────────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┐
│ 檔案                                                                │ 變動                                                     │
├─────────────────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ forge-runtime/extensions/forge-runtime.ts                           │ 修改，識別 toolCall iteration，僅 parse 終局 Grill result │
│ forge-runtime/tests/extensions/forge-runtime-extension.test.ts      │ 修改，補 tool-call → terminal-result 回歸測試             │
│ docs/adr/ADR-0005-grill-terminal-result-lifecycle.md                │ NEW，記錄 terminal lifecycle boundary                     │
│ docs/PLAN-A.md                                                      │ 修改，本計畫                                               │
│ CONTEXT.md                                                          │ 修改，記錄已定位 gap                                      │
│ docs/handoff.md                                                     │ 修改，記錄核准與實作進度                                  │
└─────────────────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────┘

共 6 個檔案（1 新增 + 5 修改）。

Tests

┌──────────────────────────────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────────────────────────────┐
│ 測試                                                                                 │ 驗收條件                                                                   │
├──────────────────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────────────────────────────────┤
│ Extension_WhenGrillUsesToolCallThenNeedsConfirmation_ShouldEnterWaitUser             │ tool-call message 不消耗 pending；終局 `NEEDS_CONFIRMATION` 進 `WAIT_USER` │
│ Extension_WhenGrillUsesToolCallThenReadyForDeep_ShouldCompleteDeepKnowledge          │ tool-call 後的終局 `READY_FOR_DEEP` 進 `KNOWLEDGE_UNDERSTANDING`           │
│ Extension_WhenTerminalGrillResultIsInvalid_ShouldEmitParseErrorWithoutDeepTransition │ 非 JSON 終局只發出 parse error，不進 Deep Knowledge                         │
└──────────────────────────────────────────────────────────────────────────────────────┴────────────────────────────────────────────────────────────────────────────┘

Execution Order

1. 使用者確認本計畫與 ADR-0005 後，子代理先在 extension harness 補第一個 tool-call → `WAIT_USER` 測試。
2. 子代理先執行該測試，確認舊程式碼紅燈，並回報 failing test 名稱與原因。
3. 主代理確認紅燈後，才在 `forge-runtime/extensions/forge-runtime.ts` 做最小 lifecycle 修正。
4. 子代理補 `READY_FOR_DEEP` 與 invalid final result 測試；每個 slice 都先紅再改，再重跑相關測試。
5. 全部回歸綠燈後，由子代理執行完整 `forge-runtime` 測試與 `npm run check`。

Execution Result

1. 舊程式碼的第一條測試紅燈：最終狀態為 `Forge GRILL [active]`，未進 `WAIT_USER`。
2. 已在 `message_end` 對含 `toolCall` 的 assistant message 提前 return，保留 `pendingGrillRun` 至真正終局 result。
3. 三條指定回歸測試與完整 extension 測試檔通過；子代理完整驗證為 `npm test` 55/55 通過、`npm run check` 通過。

後續決策註記（2026-08-11）

- 使用者已確認：`GRILL` 可使用工具，但僅限對 `LIGHT_DISCOVERY` 候選來源做唯讀查核；每次使用者作答後都須返回下一輪 `GRILL`，只有 `READY_FOR_DEEP` 可進入 Deep Knowledge；同一迴圈固定使用 Light Discovery snapshot，只有使用者透過 `/forge-runtime switch <request>` 改變任務範圍才重跑 Discovery；每輪完成以專用 `forge_grill_complete` tool 回報，正常 runtime 不再解析 assistant 終局文字 JSON；Workflow 發出不可自訂的 round id，已回答 decision id 不可重問；Grill 僅暴露兩個 domain tool，其他工具 deny-by-default；evidence 以 immutable snapshot 與 opaque candidate id 存取；completion 後壓制同 turn 的殘餘 prose；候選不足仍以 `NEEDS_CONFIRMATION` 請使用者改變 Discovery 範圍；新 snapshot 的第一輪必須以 evidence tool 實際查核至少一筆來源；options 與自由回答皆會成為 decision record；未呼叫 completion tool 時發受控錯誤，並直接提示 `/forge-runtime continue` 或 `/forge-runtime switch <request>`；completion payload 沿用既有 result schema 加 round id。這不是本完成計畫的 scope，後續須以新 ADR 與新 Plan 落地。

---
Verification

```text
# 僅由子代理執行，從 repo root
cd forge-runtime && npm test
cd forge-runtime && npm run check

# 實測：npm test 55/55 passed、0 failed；npm run check 通過。
```

---
Approval Gate

- 使用者已明確確認 ADR-0005 與本 Plan A，可開始測試紅燈與任何程式碼修改。

---

# Plan A：PI extension TypeBox loader compatibility（2026-08-13）

## Building

- 在 `forge-runtime/tests/extensions/` 新增真正 PI extension loader 的回歸測試。
- 將 `forge-runtime/src/grill/grill-result.ts` 的 TypeBox compile import 改為 PI loader 已支援的 alias。
- 以 PI CLI 的明確 `--extension` 路徑驗證 `pi` 可載入 Forge extension。

## Not Building

- 不修改 `pi-main/`、PI loader alias 清單或上游 TypeBox package。
- 不改動 `StructuredGrillResult` schema、parser 行為、completion lifecycle 或新增相依套件。
- 不以 direct `tsx` import 取代真實 loader 回歸測試。

## Approach

PI loader compatibility

`grill-result.ts` 的 `typebox/schema` 是合法 TypeBox export，但 PI extension loader 只提供 `typebox`、`typebox/compile`、`typebox/value`。將 compile 呼叫改為 `typebox/compile` 的現有 API，讓 Forge package 使用 loader 的公開相容性 surface。

Fragile assumption：`pi-main` source runtime 已安裝，且 `npx tsx packages/coding-agent/src/cli.ts --offline --no-session --no-extensions --extension ../forge-runtime/extensions/forge-runtime.ts --help` 會在載入 extension 後自行結束；若上游 CLI 的資源載入順序改變，需重新確認這個 integration seam。

## Files

| 檔案 | 變動 |
| --- | --- |
| `forge-runtime/tests/extensions/pi-extension-loader.test.ts` | NEW：以真實 PI CLI loader 驗證 Forge extension 可載入 |
| `forge-runtime/src/grill/grill-result.ts` | 將不受支援的 TypeBox schema subpath 改為支援的 compile alias |
| `CONTEXT.md` | 記錄 extension loader compatibility boundary |
| `docs/adr/ADR-0007-grill-completion-tool.md` | 記錄 TypeBox import compatibility 決策 |
| `docs/PLAN-A.md` | 記錄本 Plan A |
| `docs/handoff.md` | 記錄進度與驗證入口 |
| `agent-state/typebox-loader-compatibility.md` | NEW：持久化本 ticket 狀態 |

共 7 個檔案（2 新增、5 修改）。

## Tests

| 測試 | 驗收條件 |
| --- | --- |
| `Pi_WhenLoadingForgeRuntimeExtension_ShouldNotEmitTypeBoxSchemaResolutionError` | global compiled PI CLI 的 offline print probe 不含 `index.mjs/schema` |
| `Pi_WhenLoadingForgeRuntimeExtension_ShouldNotFailDuringExtensionLoad` | 同一 probe 不含 `Failed to load extension`；後續 offline/model exit 不視為 loader failure |

## Execution Order

1. 子代理先新增 `pi-extension-loader.test.ts` 的兩個 regression assertions，並以 global compiled `pi --offline --no-session --no-extensions --extension .pi/extensions/forge-runtime.ts -p "loader smoke"` 作 probe。
2. 子代理先執行 `cd forge-runtime && npx tsx --test tests/extensions/pi-extension-loader.test.ts`，確認舊程式碼紅燈，回報 failing test 名稱與失敗原因。
3. 主代理確認紅燈後，才由獨立實作子代理在 `src/grill/grill-result.ts` 做最小 import 修正。
4. 獨立驗證子代理重跑 focused test，確認兩個 assertions 綠燈；再執行完整 `npm test`、`npm run check` 與 PI CLI runtime check。
5. 獨立 review 子代理只審查本 ticket 的文件與程式變動；若有修正，重新派驗證子代理。

## Verification

```text
# 僅由子代理執行，從 repo root
cd forge-runtime && npx tsx --test tests/extensions/pi-extension-loader.test.ts
cd forge-runtime && npm test
cd forge-runtime && npm run check

pi --offline --no-session --no-extensions --extension .pi/extensions/forge-runtime.ts -p "loader smoke"

# 期望：97 既有 + 2 新增 = 99 passed、0 failed；CLI 不得出現 extension loader error。
# 注意：offline print 在 loader 通過後仍可能因模型不可用而 exit 1。
```

## Approval Gate

- 使用者已明確要求修復實際 `pi` 載入錯誤；本 Plan A 僅採 Forge package import 相容性修正，未跨越 `pi-main/` 邊界。

## Test-seam correction（2026-08-13）

- `pi-main` source CLI 直接載入 `forge-runtime/extensions/forge-runtime.ts` 的兩個 assertions 在舊程式碼即通過，不能作為本錯誤的紅燈 guard。
- production code 保持未修改；Plan A 暫停於 red phase，改以使用者實際的 global `pi` 與 `.pi/extensions/forge-runtime.ts` bootstrap path 重建可重現 seam。

## Red evidence（2026-08-13）

- replacement seam 已由 `forge-runtime/tests/extensions/pi-extension-loader.test.ts` 驗證為紅燈：`Pi_WhenLoadingForgeRuntimeExtension_ShouldNotEmitTypeBoxSchemaResolutionError` 與 `Pi_WhenLoadingForgeRuntimeExtension_ShouldNotFailDuringExtensionLoad` 都在舊程式碼失敗。
- probe 在約兩秒內 exit 1，且在任何 offline/model error 前出現 `Failed to load extension` 與 `typebox/build/index.mjs/schema`；可進入最小 production import 修正。

## Execution Result（2026-08-13）

- 已在 `forge-runtime/src/grill/grill-result.ts` 將 `typebox/schema` 的 `Schema.Compile` 改為 `typebox/compile` 的 `Compile`；沒有修改 schema、parser 行為或 `pi-main/`。
- red evidence：兩個 global compiled PI loader assertions 都因原始 `index.mjs/schema` error 失敗。
- green evidence：focused loader test 2/2、完整 `npm test` 99/99、`npm run check` 與 global compiled PI runtime probe 都 exit 0；三個 extension error 字串均未出現。
- 唯一測試環境前提：`pi-extension-loader.test.ts` 需要 PATH 中可用的 compiled `pi` CLI，缺少時明確視為 integration prerequisite 失敗，不靜默 skip。

## Final Review（2026-08-13）

- 獨立 review 未發現 Standards 或 Spec 缺陷：schema、validator lifecycle 與 completion 回傳結構未變，修改只移除不支援的 `typebox/schema` alias。
- 限制：workspace 沒有 Git baseline，review 以指定檔案與 Plan A 的證據進行，無法產生 fixed-point diff；CodeGraph 也未能逐行載入新增測試與文件，但 focused／完整／runtime 驗證已實際覆蓋 loader seam。

## 2026-08-16 已核准增補：WAIT_USER 開放回答與單次發布（歷史快照，已由最終完成狀態取代；當時待 RED→GREEN）

### Building

- 讓 WAIT_USER 將 options 視為推薦／快捷回答，接受 trim 後非空自由文字。
- 讓語意不足的回答進入下一輪 GRILL 的新 clarification decision，不重發原 `decisionId`。
- 讓同一 pending `decisionId` 只發布一次 WAIT_USER；移除通用 Confirm／Reject 顯示；exact evidence id 去重，主畫面只顯示唯一 evidence 數量，raw `ev-...` ID 留在 runtime state／紀錄且不顯示；completion 後不輸出 assistant prose。

### Not Building

- 不新增 schema、session-state 欄位、workflow stage、通用輸入元件或 `pi-main/` 修改。
- 不預先修改 session-state；先由紅燈證明既有 raw free-text 已會 `recordAnswer` 但契約仍有 gap。
- 不重開本文件既有 completed sections。

### Files

Production seams：

- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/src/ui/wait-user-panel.ts`
- `forge-runtime/src/grill/grill-skill.ts`

Tests：

- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `forge-runtime/tests/grill/grill-skill.test.ts`
- `forge-runtime/tests/ui/wait-user-panel.test.ts`（新增）

共 6 檔，超過 5 檔但分屬三個既有 seam；不得預先修改 session-state。

### Tests

Focused command：

```text
cd forge-runtime && npx tsx --test tests/extensions/forge-runtime-extension.test.ts tests/grill/grill-skill.test.ts tests/ui/wait-user-panel.test.ts
```

Assertions 必須涵蓋開放 options、new clarification decision、單次 WAIT_USER、無通用 Confirm／Reject、exact evidence id 去重後的唯一數量摘要與 completion 無 prose。

### Execution Order

1. 由獨立測試子代理先補三份 focused assertions，明確打出第一個 RED。
2. 紅燈確認後，才由獨立實作角色在三個既有 seam 做最小 GREEN；不修改 session-state。
3. 由獨立驗證角色執行上述 focused command 與 `npm run check`；完整 suite 保留 OOM 風險，不宣稱 current full-suite pass。

### Verification

- focused command 三檔均通過，且 `npm run check` exit 0。
- 最近一次完整測試嘗試 47 中 44 pass、3 fail，另有 loader timeout／約 4GB heap OOM；該結果不視為 current full-suite pass。
- 真實 PI TUI 視覺驗收在後續 verification，不阻塞先完成 RED→GREEN 的文件計畫。

### Approval / Fragile assumptions

- 使用者已核准上述六項契約；本增補可進入 RED→GREEN，但 ticket 仍未完成。
- 六檔超過五檔是因三個既有 seam 各有 focused coverage；本計畫不預設 session-state 修改。

## 最終完成狀態（2026-08-16）

本節 supersede 上述舊的 47/44、OOM blocker 與待 RED→GREEN 狀態。

### Building

- Plan A implementation 已完成：WAIT_USER custom Editor／trim／blank Enter／Escape／shared resume、clarification decisionId、pending decisionId 一次性 publish、unique evidence count 與 completion prose suppression 均已落地。

### Tests

- 最終程式／測試路徑：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/src/grill/grill-skill.ts`、`forge-runtime/src/ui/wait-user-panel.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/grill/grill-skill.test.ts`、`forge-runtime/tests/ui/wait-user-panel.test.ts`。
- focused batch：83/83 pass。
- canonical `npm test`：124/124 pass，無 OOM／timeout。

### Verification

- `npm run check`：兩段 `tsc --noEmit` 通過。
- scripted PI TUI：focused 1/1、full 4/4 pass。
- final review：Standards 0 findings；Spec finding 已修正，closure 0 findings。
- Plan B 人工視覺驗收、固定 widget tree、selectList autocomplete render coverage 尚未完成；下一步由使用者決定是否進入 Plan B。

---

# Plan A：WAIT_USER 重入與 UI lease 生命週期

日期：2026-08-16

狀態：已完成（2026-08-17）。正式程式、精準／完整驗證與審查均已完成。

## 建置範圍

- 同一時間只保留一個 pending decision；不同 `decisionId` 重入採「先到的待決策優先（first-pending-wins）」由 extension 靜默忽略，不拋錯、不改動原 decision 或 UI，也不發布第二個 UI。
- 相同 `decisionId` 重入只重顯 UI；UI 已 active 時略過重複發布，不再次做 `WAIT_USER` transition。
- 將 `published` marker 改為互動期間的 in-flight UI lease；`ctx.ui.custom` 整段互動持有，透過 `finally` 清除，正常返回與 throw 都涵蓋。
- Escape／無 UI 保留 `WAIT_USER` 與 pending decision，允許自然文字或同 ID 日後重試，不自動重試。
- UI throw 清 lease 後向上傳遞，仍保留 `WAIT_USER` 與 pending decision。

## 不建置

- 不修改 `pi-main/`、schema、stages 或 completion。
- 不做 queue、replace、history dedupe、answered decisionId reuse 改動或 reset lifecycle。
- 不處理上游強制關閉 component 且未呼叫 `done` 所造成的 Promise／lease pending；列為已知風險。

## 實作方式

在既有 `forge-runtime.ts` 的 WAIT_USER 發布與互動 seam 做最小修正：先以 pending decision identity gate 保護原狀態，再以 UI active／lease 邊界控制發布與清理。不同 ID 在 transition 前靜默忽略；同 ID 只走重顯路徑。UI 結束或例外統一清 lease，例外照原路徑向上傳遞。

## 檔案

| 檔案 | 變動 |
| --- | --- |
| `forge-runtime/extensions/forge-runtime.ts` | WAIT_USER single-pending、same-ID rerender、UI lease 與 failure／cancel semantics |
| `forge-runtime/tests/extensions/forge-runtime-extension.test.ts` | 不同 ID 靜默忽略、同 ID 重試、UI throw、Escape／無 UI 與 active UI 去重回歸測試 |

正式程式／測試實際只修改上述 2 個檔案；本文件與 ADR、handoff、ticket state 為 durable 文件，不列入正式程式檔案範圍。

## 測試

至少覆蓋以下案例；不預先承諾新增測試總數，驗收以基線與新增案例全數通過為準：

- 不同 ID 重入被 extension 靜默忽略，不拋錯、不發布第二個 UI，原 pending decision、WAIT_USER 與 marker／lease 不變。
- 相同 ID 在 UI 失敗後可重試，且重試不再次做 WAIT_USER transition。
- UI throw 向上傳遞，並清除 lease、保留 WAIT_USER／pending decision。
- Escape／無 UI 正常返回，保留 WAIT_USER／pending decision，允許後續重試且不自動重試。
- active UI 收到相同 ID 時不重複發布。

## 執行順序

1. 已完成回歸案例、最小 production 修正與 focused 驗證。
2. 已完成 full suite、兩段 type check 與 scripted PI TUI 驗證。
3. 已完成 Standards／Spec 審查；無 runtime 發現，且無範圍膨脹。

## 驗證

```text
# 僅由獨立驗證子代理執行，從 repo root
cd forge-runtime
npx tsx --test tests/extensions/forge-runtime-extension.test.ts tests/grill/grill-skill.test.ts tests/ui/wait-user-panel.test.ts
npm test
npm run check
```

命令依 `forge-runtime/package.json` 的 `test`／`check` scripts；實際結果為精準測試套件 87 通過／0 失敗、`npm test` 128 通過／0 失敗／0 略過、`npm run check` 兩段 tsc 均通過。scripted PI TUI 精準 1/1、完整 4/4 通過。

## 脆弱假設

若上游強制關閉 component 而沒有呼叫 `done`，Promise／lease 可能 pending；本 Plan A 不加入 reset lifecycle，後續若要處理需另行核准。

## Ticket closure（2026-08-17）

Plan A 與本 ticket 已完成，無待實作或 re-review。最終 Standards review 為 0 findings；最終 Spec review 為 0 findings。精準測試套件 87/87、完整 `npm test` 128/128、`npm run check` 兩段 tsc 均通過；runtime／test 在最終測試後未再修改，後續僅進行文件翻譯與狀態同步。下一步只能由使用者另行決定方案 B 人工視覺驗收，或開立新 ticket。

保留三個已知 gap：缺少 `decisionId` 的 ingress 不做 dedupe；上游 UI component 不呼叫 `done` 可能使 Promise／lease 永久 pending；Plan B 人工視覺驗收尚未完成。
