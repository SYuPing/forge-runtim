# ADR-0007：Grill 以專用 completion tool 回報每輪結果

狀態：Accepted

> 部分 superseded（2026-08-13）：completion omission 的 `continue` replay 規範已由 ADR-0008 取代。completion tool、round、evidence、雙態 result 與 tool boundary 其餘決策仍為 Accepted。

每個 `GRILL` round 的結構化完成結果由專用 `forge_grill_complete` tool 提交，而不是依賴 assistant 的終局文字 JSON。該 tool 將工具蒐證與 workflow completion 分離：前者維持 ADR-0006 的唯讀候選查核邊界，後者以結構化 payload 交由 Workflow 驗證並導向 `WAIT_USER` 或下一個合法階段。

## Consequences

- Workflow 不得以一般 assistant prose 推進 Grill state；正常 runtime 不再解析 assistant 終局文字 JSON，completion payload 必須經 schema validation。
- `/forge-runtime grill-result` 僅保留為明確的測試／除錯入口，不可成為模型驅動的正常控制路徑。
- Workflow 發出不可由模型自訂的 `roundId`，completion tool 必須回傳相同 id；`NEEDS_CONFIRMATION` 的問題 id 是穩定 `decisionId`，已回答的 id 不可重問或重複提交。
- completion tool 成功後必須在同一操作中完成 workflow transition，並壓制該 agent turn 餘下的 streaming 與終局 prose；不可用 `abort()` 中斷已成功的 completion。
- completion result 僅有 `NEEDS_CONFIRMATION` 與 `READY_FOR_DEEP`；候選證據不足時以唯一 `NEEDS_CONFIRMATION` 問題請使用者補來源或明確變更 Discovery 範圍，不新增第三種 workflow result。
- completion payload 的 `evidence` 只可引用本 workflow 已由 `forge_grill_evidence` 回傳的 candidate id；非空 snapshot 的第一輪至少須成功查核一筆 evidence，空 manifest 則可零 evidence 提交唯一來源／scope 問題；後續 round 可重用既有查核結果。
- assistant 終局若未呼叫 completion tool，runtime 記錄該 attempt 的首次 omission，保留目前 round，並進入 `GRILL + RECOVERY_REQUIRED`。可見 panel 提供 `/forge-runtime retry`、`cancel`、`switch`；禁止 background steer、follow-up retry 與自動 Deep。`continue` 不再承擔 omission recovery。
- completion payload 固定為既有 `StructuredGrillResult` 加 runtime-issued `roundId`：`roundId`、`status`、`questions`、`recommendation`、`evidence`、`requiresUserConfirmation`；`questions[0].id` 是 `decisionId`，不新增其他 status 或欄位。
- completion tool schema 與使用者作答後的 resume transport 已由 Plan A 定義；ADR-0005 的既有 terminal `message_end` lifecycle 維持歷史／測試相容性描述。

## 實作進度（2026-08-12）

- 已鎖定 `typebox@1.3.7`，並在 `src/grill/grill-result.ts` 建立 `parseGrillCompletion(payload, context)`；它以 schema 驗證 payload，檢查 runtime-issued `roundId` 與 fetched evidence provenance，並重用既有 structured result parser。
- 已由子代理驗證有效 completion、過期 round、未查核 evidence 三條 unit-level 路徑；`tests/grill/grill-result.test.ts` 為 6 passed、0 failed。
- `forge_grill_complete` 的 `NEEDS_CONFIRMATION → WAIT_USER` 已完成 targeted green：payload 經 round／evidence 驗證後完成 state transition，並保留 Grill domain tools。
- `Extension_WhenCompletionIsReady_ShouldEnterDeepKnowledgeAndHideProse` 已 targeted green：`READY_FOR_DEEP` completion 會沿既有 candidate relevance gate 進入合法 deep-knowledge transition。
- `Extension_WhenCompletionSuccessIsFollowedByTerminalProse_ShouldSuppressOnlyThatTurn` 已 targeted green：成功 completion 後只壓制同一 agent turn 的 streaming／terminal prose，不呼叫 `abort()`。
- 歷史實作 `Extension_WhenTerminalMessageOmitsCompletion_ShouldPromptContinueAndSwitch` 曾以 continue／switch 提示保留 round；該 recovery 規範已由 ADR-0008 supersede，下一輪實作須改為 retry／cancel／switch 與有界 attempt。
- `Extension_WhenGrillInvocationIsBuilt_ShouldExposeRuntimeIssuedRoundIdAndCompletionContract` 已 targeted green：自然／approval Discovery 路徑會公開 runtime-issued round id 與 completion contract。
- answer 與 `/forge-runtime continue` replay、三個 review-derived safety slices、完整驗證與 final review 均已完成；final schema exactness follow-up 驗證為 97/97 通過與 type check 通過。
- active-tools restore 的保存與恢復時機未由本 ADR 定義；其餘 Accepted 決策與範圍不變。

## Safety completion（2026-08-13）

- 正常 Grill invocation 只要求使用 `forge_grill_evidence` 與 `forge_grill_complete`；assistant terminal JSON 不得作為 completion 替代。
- `READY_FOR_DEEP` completion 成功離開 Grill 後會還原先前 active tools；`NEEDS_CONFIRMATION` 仍保留 Grill 工具面。
- `/forge-runtime continue` 的同 round replay 僅保留為一般 active-workflow 歷史語義；completion omission recovery 必須使用 ADR-0008 的明確 `/forge-runtime retry`。
- runtime validator 強制 `NEEDS_CONFIRMATION` 恰一題、`READY_FOR_DEEP` 零題；這是 completion contract，不只是 prompt 建議。
- `schemas/grill-result.schema.json` 與 runtime TypeBox schema 同步上述 cardinality，避免外部 schema 與 runtime contract drift。
- baseline schema 亦同步 `roundId`、question object boundary、option union 與 `confidence:number`，避免外部 completion payload 與 runtime parser 不一致。

## ADR-0008 現行補充（2026-08-13）

- `NEEDS_CONFIRMATION` completion 立即以可見 panel 顯示恰好一題並進 `WAIT_USER`；作答後自動建立下一 Grill round。
- `READY_FOR_DEEP` completion 通過 gate 後立即自動進 Deep Knowledge，無需 `continue`。
- 可見 panel 固定使用 `{ content: panelText, display: true }`。
- Grill prompt 不再要求 assistant「只輸出一個問題」；需要確認時只能透過 `forge_grill_complete.questions` 提交恰好一題，且不得輸出 assistant prose。

## Loader compatibility follow-up（2026-08-13）

- `forge-runtime` 的 runtime TypeBox import 必須限於 PI extension loader 已公開支援的 alias；`typebox/schema` 雖是 TypeBox package 的合法 export，並非目前 PI loader 的相容性 surface。
- completion parser 的 compile step 改採已支援的 `typebox/compile`；這不改變 schema 或 completion contract。
- 不修改 `pi-main` 的 loader alias 清單。Forge package 的 import 調整可在 package 邊界解決問題，且符合 ADR-0001 的上游 core 邊界。
- 回歸測試以 PI CLI 明確載入 Forge extension 並走 `--help` 自動退出為準；direct source import 只可作 parser unit coverage，不可單獨證明 loader 相容性。

## 實作結果（2026-08-13）

- global compiled PI 的 `--offline --no-session --no-extensions --extension .pi/extensions/forge-runtime.ts -p "loader smoke"` 已不再出現 extension load error 或 `index.mjs/schema`。
- `grill-result.ts` 只將 compile import 替換為 `typebox/compile` 的 `Compile`；`StructuredGrillResult` 與既有 completion validator contract 不變。
- focused loader regression 2/2、完整 `forge-runtime` suite 99/99 與 type check 均通過。
- 獨立檔案審查未發現 completion contract drift；workspace 無 Git baseline，故未能執行 fixed-point diff review。
