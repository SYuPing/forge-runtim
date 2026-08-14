# ADR-0003 Active Workflow Control

日期：2026-08-09

## 狀態

Accepted

> 2026-08-13 補充：completion omission recovery 已由 ADR-0008 取代。`continue` 不再重播 omission attempt；此情境只能由明確 `/forge-runtime retry`、`cancel` 或 `switch` 處理。

## Context

- 前段 auto-routing 已完成，一般工程自然語句可自動進既有 grill flow。
- `WAIT_USER` 的自然語句續接也已完成，但 `open_workflow` 目前只有硬擋與提示，沒有可操作的使用者路徑。
- v1 仍維持「每個 session 只允許一個 open workflow」的架構邊界，不做 queue 或 parallel workflows。
- 因此下一個最小缺口不是 classifier，而是 active workflow 時如何安全處理使用者的中斷、取消與換題。

## Decision

1. `open_workflow` 狀態不再只有被動硬擋；需提供明確控制路徑。
2. 一般 active workflow 提供 `continue`、`cancel`、`switch <request>`；Grill completion omission 另提供明確 `retry`。
3. `continue` 只代表「維持目前 workflow，不切換題目」，不建立新 workflow，也不改變既有 stage。
4. `cancel` 會清空目前 active workflow 的 session state，回到 `RECEIVE`。
5. `switch <request>` 的語義固定為 `cancel + start_forge(new request)` 的單一步驟，不保留舊 workflow queue。
6. 偵測到 `new-topic-conflict` 時，extension 要提供固定提示文字，明確告知使用者可用的下一步。
7. `continue` 不得作為 completion omission recovery；`GRILL + RECOVERY_REQUIRED` 只接受明確 `/forge-runtime retry` 重跑同一 round／snapshot。

## Decision Table

| 題目 | 決策 | 原因 |
| --- | --- | --- |
| open workflow 中斷處理 | 提供 `continue / cancel / switch` | 比純硬擋更可用，又比 queue 簡單 |
| completion omission | 提供獨立 `retry / cancel / switch` | 避免 `continue` 同時承擔一般續接與 recovery |
| `continue` 語義 | 只維持現有 workflow | 避免偷渡新題或隱含切換 |
| `cancel` 語義 | reset 回 `RECEIVE` | 提供最小明確出口 |
| `switch` 語義 | `cancel + start_forge(new request)` | 滿足換題需求，不引入第二個 open workflow |
| 互動形式 | 先 command-first | 沿用現有 extension command 能力，最省 |
| queue / parallel workflows | 不做 | 超出 v1 範圍，容易放大 state 複雜度 |

## Consequences

- 好處：可以把目前「只能被擋下來」的 UX，提升成最小可操作的流程。
- 好處：不用修改 `pi-main/`，也不用先做 widget tree。
- 好處：`confirm` 現在先進 `USER_CONFIRMED`，再由 runtime 依候選 gate 與 deep executor 決定是否進下一段，不再把確認視為直接跳 deep 的同義詞。
- 代價：`continue` 仍然偏工程化，初版主要依賴 command，而非視覺化控制元件。
- 代價：`switch` 會丟棄舊 workflow，不保留佇列或暫存待辦。

## Not Building

- 不做 multi-workflow queue。
- 不做 parallel workflows。
- 不做自動保存舊 workflow 待切回。
- 不做 widget tree 或 selector 優化。
- 不修改 `pi-main/` core。

## Fragile Assumption

- command-first 控制已足夠覆蓋 v1 的 active workflow 中斷情境；completion omission 另以 ADR-0008 的 `retry` 與可見 recovery panel 處理。若使用者仍頻繁卡住，才考慮更強的 stage-aware UI control。
