---
title: Grill 軟上限與人類 checkpoint 狀態
type: agent-state
scope: grill-soft-cap-human-checkpoint-20260831
updated: 2026-09-01
source: ADR-0025、PLAN-A、ticket、使用者核准
status: implementation-complete-verified
---

# Agent state：Grill 軟上限與人類 checkpoint

## 已完成

- 使用者已核准軟上限＋人類 checkpoint 設計。
- ADR、Plan A、ticket、handoff、CONTEXT 與 Memory durable tracking 已完成。
- 第一個 GREEN milestone 已完成：固定測試 `GrillRoundBudget_WhenAcceptedAnswersReachEight_ShouldRequireCheckpoint` 先以第 8 答後仍為 `GRILL` 的預期失敗（exit 1）確認 RED，再以 1 pass、exit 0 確認 GREEN。
- production 已完成第一個 slice：UI 狀態新增 `grill_checkpoint`；session state 只計入接受的正常回答，第 8 答先保存後進入 checkpoint，reset／new snapshot 會清零計數。
- session-state regression milestone 已完成：4 個固定 regression 使用正確的 `npx tsx ... --test` runner 全數 4/4 pass、exit 0；第一輪誤用 Vitest 得到 exit 1，已確認是 runner 誤用並重跑排除，不是產品失敗。
- extension harness blocker 已解除：CodeGraph 三線診斷確認 input handler 的下一輪 invocation 會在 `sendInput()` transform 回傳，不會出現在 `observedUserMessageCalls`；UI select/editor mock 為死碼，status widget 也不承諾 `waitUser.kind`，因此移除實作耦合 assertion。固定 extension 測試 `GrillCheckpoint_WhenLimitIsReached_ShouldNotQueueFollowUp` 已 1 pass、0 fail、exit 0；未修改 extension production。
- `continue_one` slice 已完成並通過固定測試：1 pass、0 fail、exit 0。`session-state` 只接受白名單 `continue_one`，不計入 decision 或回答 count；下一輪完成後以 one-shot 旗標再次進入 checkpoint。

## 重要決策

- `MAX_AUTOMATIC_GRILL_ROUNDS = 8`；只計成功接受的人類回答。
- 第 8 題先保存，再進既有 WAIT_USER 的 `grill_checkpoint`；不新增 workflow state。
- 三個固定 option：`continue_one`、`converge`、`cancel`；late/stale/duplicate fail-closed。
- `cancel` 重用非 Deep cancel cleanup：清除 pending／timer／fallback、恢復原 tools、設 `activeWorkflow=undefined`、執行 `sessionState.reset()`，最後 UI 回到 `RECEIVE` 且 `waitUser=undefined`；不得偽造 `READY_FOR_DEEP` 或進入 Deep。
- `reject()` 原本只更新 UI projection、未同步 orchestrator；乾淨 RED 顯示 `WAIT_USER` → `WAIT_USER`，修復後 reject／retry 測試通過。`recordAnswer` 對 checkpoint 改為 fail-closed。

## 修改檔案

- `forge-runtime/src/ui-state.ts`：新增 `grill_checkpoint` UI 狀態。
- `forge-runtime/src/session-state.ts`：只計接受的正常回答，第 8 答先保存後進 checkpoint，reset／new snapshot 清零。
- `forge-runtime/test/...`：固定測試 `GrillRoundBudget_WhenAcceptedAnswersReachEight_ShouldRequireCheckpoint` 已驗證 RED → GREEN。
- `forge-runtime/test/...`：session-state 4 個固定 regression 以正確 runner 驗證 4/4 pass、exit 0。
- 本狀態檔：記錄本 milestone。

## 測試結果

- 固定測試 `GrillRoundBudget_WhenAcceptedAnswersReachEight_ShouldRequireCheckpoint`：RED（第 8 答後仍 `GRILL`，exit 1）→ GREEN（1 pass，exit 0）。
- session-state 4 個固定 regression：4/4 pass、exit 0（`npx tsx ... --test`）；首輪 Vitest exit 1 為 runner 誤用，非產品失敗。
- reject／retry regression：乾淨 RED 為 `WAIT_USER` → `WAIT_USER`，修復後通過。
- 固定 extension 測試 `GrillCheckpoint_WhenLimitIsReached_ShouldNotQueueFollowUp`：1 pass、0 fail、exit 0；harness blocker 已解除，未修改 extension production。
- `continue_one` 固定測試：1 pass、0 fail、exit 0；驗證白名單、checkpoint decision 不計數，以及 one-shot 回 checkpoint。
- `converge` 原固定測試：有效 RED；目前在 [forge-runtime-extension.test.ts:3311](/C:/Users/User/Desktop/Agents/pi-plugin-dev/forge-runtime/tests/extensions/forge-runtime-extension.test.ts:3311) 呈現 `handled` 與 `transform` 差異，production 尚未修改。新決策要求先補兩條測試：無盲點 READY→Deep；一個盲點問一題後直接 Deep。
- 尚未執行其餘 ticket 測試；既有 baseline：session-state 27/27、extension 146/146、skill 6/6、full 266/266。`npm run check` 的既有 `pi-main` highlight.js TS7016 blocker 保留。

## 未解問題

- 尚未驗證其餘 checkpoint option、cleanup、late/stale/duplicate fail-closed 與 skill 行為。
- 8 輪是否適合所有一般案例仍是最脆弱假設，但 soft checkpoint 失敗只增加一次人類確認，不丟資料或自動決策。
- extension harness 的回答 round-trip capture／async path 已釐清：下一輪 invocation 應從 `sendInput()` transform 回傳觀察，不能依賴 `observedUserMessageCalls`；實作耦合 assertion 已刪除。剩餘風險為其餘 checkpoint option、cleanup、late/stale/duplicate fail-closed 與 skill 行為尚未驗證。
- converge 歧義已由使用者於 2026-09-01 決定：只啟動一次 convergence invocation；無真正知識盲點時模型提交 `READY_FOR_DEEP`，runtime 沿 `continueDeepKnowledge` 進 `DEEP_KNOWLEDGE_RETRIEVAL`；有真正知識盲點時最多問一題，保存回答後直接進 Deep，不回 checkpoint、不再 Grill、不問第二題，也不偽造 READY。真正知識盲點是 Deep Retrieval 所缺客觀知識／證據，不含可採用預設的 implementation detail。

## 下一步

已完成 implementation、驗證與 final review；本 ticket 可交付。

## 收尾狀態（2026-09-01）

### 已完成

- 第 8 個有效回答後 checkpoint；`continue_one` 恰一正常 round；`converge` 無盲點 READY→Deep，有盲點最多一題後直接 `DEEP_KNOWLEDGE_RETRIEVAL`；`cancel` 回 RECEIVE／恢復工具。
- `ui-state` 新增 `grill_checkpoint`；`session-state` 完成計數、重設與正式 `beginGrill` transition；extension 完成 `pendingConvergenceRoundId`、convergence prompt 與 final-answer guard；grilling skill 完成 frontmatter／文案。

### 修改檔案

- `forge-runtime/src/ui/ui-state.ts`
- `forge-runtime/src/runtime/session-state.ts`
- `forge-runtime/extensions/forge-runtime.ts`
- `forge-runtime/skills/grilling/SKILL.md`
- `forge-runtime/tests/runtime/session-state.test.ts`
- `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`
- `forge-runtime/tests/grill/grill-skill.test.ts`

### 驗證結果

- GrillCheckpoint 4/4；三檔 189/189；grill skill 9/9；`quick_validate` valid。
- 完整 `npm test` 281/281；`git diff --check` exit 0。
- `npm run check` 本輪 Forge 錯誤已清除，僅剩未修改 `pi-main` `syntax-highlight.ts` 的 `highlight.js` TS7016 baseline。

### 未解問題

僅剩上游 `pi-main` 型別 baseline；本 ticket 不修改 `pi-main`。

## 最終狀態（2026-09-01）

- status：`complete`
- 已完成：converge 0 題直接 Deep、1 題回答後直接 Deep；convergence 跳過 relevance；普通 empty-candidate 仍等待；bare cancel 完整 cleanup；blank/stale/duplicate 防護；canonical skill 路徑修正。
- 修改檔案：`forge-runtime/src/ui/ui-state.ts`、`forge-runtime/src/runtime/session-state.ts`、`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/skills/grilling/SKILL.md`、三個對應測試檔，以及本 ticket durable docs。
- 驗證：完整 281/281；精準 convergence/cancel/relevance 5/5；session 33/33；cancel 8/8；`quick_validate` 成功；pack dry-run 260 files；isolated tarball install/path resolution 成功；diff check 0。
- 風險：`npm run check` 僅剩未修改 `pi-main` `highlight.js` TS7016 baseline；package 仍含約 213 個 `.log`；true knowledge gap 由 prompt/skill 契約約束，未做 runtime NLP classifier。
- 下一步：本 ticket 無待實作項目；若要清理 package log 或加入語意 verifier，另開設計與授權。
