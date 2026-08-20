# ADR-0011：Grill 成功完成的代理回合終止邊界

## 狀態

已核准（2026-08-19）；由 ADR-0012（2026-08-20）擴充

本 ADR 僅部分取代 ADR-0007 中「成功完成僅靠顯示抑制收尾」的語意；display-only message contract 由 ADR-0012 擴充。ADR-0008 的完成遺漏復原決策，以及 ADR-0007／ADR-0008 其餘的完成契約、回合／證據、`WAIT_USER`／深度知識分流、重試／取消／切換、穩定結束與互動驗收決策均維持有效。

## 背景

成功的 `forge_grill_complete` 已能觸發正常狀態轉移，但若只抑制同一回合的虛構完成文字，底層代理回合仍可能繼續執行，進而重播過期回合或產生無限助理回合。這會把已進入 `WAIT_USER` 或 `KNOWLEDGE_UNDERSTANDING` 的工作流程再度暴露給舊 Grill 回合。

## 決策

1. 成功的 `forge_grill_complete` 回傳既有公開 `AgentToolResult.terminate: true`，作為目前代理回合的唯一終止邊界。
2. 成功 `NEEDS_CONFIRMATION` 仍立即進入 `WAIT_USER`；使用者介面回答建立新的 Grill 回合，不重用已終止的回合。
3. 成功 `READY_FOR_DEEP` 仍通過既有閘門，自動完成深度知識，並穩定結束在 `KNOWLEDGE_UNDERSTANDING`。
4. 移除只為虛構完成文字存在的 `suppressCompletionTurn` 旗標與相關分支；完成遺漏復原保留原政策。
5. 載荷驗證、過期回合、阻擋或其他錯誤結果不加 `terminate`，以免錯誤工具呼叫偽造成功終止。
6. 不使用 `abort()`；本 ADR 可與 ADR-0012 的窄化 `pi-main` display-only core 例外並存，不改重試／取消／切換、穩定結束、遺漏或自動重試政策。
7. `terminate` 是當前代理回合的邊界，但仍可能被已排入的 steer 延續；這個 queue 語意不在本 ADR 內重新定義。

## 不建置

- 不定義 `KNOWLEDGE_UNDERSTANDING → GRILL → WAIT_USER` 的 Deep 後新 ambiguity transition。
- 不新增深度知識的證據快照政策。
- 不處理同一助理批次同時發出證據與完成事件的 PI 全結果終止強化。
- 不建立 provider／顯示訊息分離接縫；成功 `NEEDS_CONFIRMATION` 的顯示改由 ADR-0012 的 display-only contract 定義。

## 影響

- 成功完成會真正封口目前代理回合，不再由顯示抑制假裝終止。
- `WAIT_USER` 與 `KNOWLEDGE_UNDERSTANDING` 不會被同一個舊 Grill 回合反向重播。
- 錯誤、過期與完成遺漏復原的既有行為保持不變。

## 脆弱假設

- PI 現有公開 `AgentToolResult.terminate` 能終止整個當前代理回合，且不需要修改 `pi-main/`。
- 成功完成的工具結果不會與同一助理批次的其他非終止結果混在一起；該強化延後另案處理。
- 原先「不改 `pi-main/`」的限制已被方案 C 的窄化 core 例外取代；例外只涵蓋 coding-agent ExtensionAPI／session display-only 路徑，不涵蓋 harness 或其他 package。

## 實作同步（2026-08-20）

- Plan A 已完成，使用者已授權 `pi-main` 例外；不執行 Plan B。
- successful `NEEDS_CONFIRMATION` 僅傳 display-only WAIT_USER state message；READY 仍自動進 Deep，不要求 idle。
- 回答後流程為 `WAIT_USER → USER_CONFIRMED → GRILL`；UI/command 先 resume、重用 `pendingReplayInvocation`，再送完整 followUp invocation。queued steer 延續語意仍 out-of-scope。
