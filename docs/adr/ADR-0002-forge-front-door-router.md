# ADR-0002 Forge Front Door Router

日期：2026-08-08

## 狀態

Accepted

## Context

- `GRILL/WAIT_USER` 中段能力已完成，且已在真 `pi-main` runtime 與同一 session pause/resume 路徑驗證。
- 目前一般使用者輸入已可自動串進 Forge workflow；前段入口的重點是保證 `RECEIVE -> INTENT_UNDERSTANDING -> LIGHT_DISCOVERY -> GRILL` 真實可見，而不是只在 hook 內部 transform。
- 下一個最小缺口不是 UI，而是前段入口與 deep gate 的銜接：如何把一般自然語句安全地導入前段 stage，並在 `candidate relevance gate` 通過後進 deep executor。
- 依 `FORGE_RUNTIME_Arch_v4.md` 與 repo 規則，workflow 必須保有決策控制權；`Recommendation != Decision`，不可讓前段 router 越過人類決策邊界。

## Decision

1. 一般自然語句的預設入口為 `Forge Router`；只有 slash command 直接 bypass。
2. v1 每個 session 只允許一個 open workflow，不做 parallel workflow 或 queue。
3. `WAIT_USER` 狀態優先於所有新 intent 判定；簡短確認語句如「好」「可以」「照做」皆視為 `resume_wait_user`。
4. `open_workflow` 狀態下禁止雙開新題；若輸入呈現新題目傾向，仍回 `resume_open_workflow`，並標記 `new-topic-conflict`。
5. `INTENT_UNDERSTANDING` 只輸出最小 contract：`route`、`goal`、`taskKind`、`ambiguities`、`lightDiscoverySeeds`。
6. `passthrough` 只保留給純問答、閒聊、翻譯、改寫、一次性資訊查詢與非工程任務；凡屬工程工作請求，一律先過 Forge router。
7. `LIGHT_DISCOVERY` v1 只做薄探索，文件知識實際只讀 `wiki/`；必要時可搭配極窄 local code lookup 與 `code_base/` 候選摘要。
8. 只要 `ambiguities` 非空，或輸入跨人類決策邊界，後續必須進 `GRILL`；`INTENT_UNDERSTANDING` 不得直接決定方案。

## Decision Table

| 題目 | 決策 | 原因 |
| --- | --- | --- |
| 一般輸入入口 | 先進 `Forge Router` | 讓 workflow 能接手一般工程請求，而不依賴手動 slash command |
| slash command | 直接 bypass | 避免破壞既有明確 command 路徑 |
| session 併發 | 一次只允許一個 open workflow | 避免 state 混亂，先保住 v1 穩定性 |
| `WAIT_USER` 優先權 | 高於新 intent 判定 | 保住人類決策邊界，不讓回覆被誤判成新題 |
| `open_workflow` 新題衝突 | 不雙開，標記 `new-topic-conflict` | 少一套 queue/parallel state，差異留給後續版本 |
| intent contract | 只保留 5 個欄位 | 先固定 routing 需要的最小資料，不做大型 taxonomy |
| `passthrough` 邊界 | 僅非工程任務 | 工程請求應由 workflow 接手，而不是讓一般聊天路徑吞掉 |
| `LIGHT_DISCOVERY` 來源 | 先縮到本地 docs + 窄 code lookup | 降低 context 污染，保留 evidence traceability |
| 歧義處理 | 一律升級到 `GRILL` | 避免 router 越權做設計決策 |

## Consequences

- 好處：可以用最小 router 先把一般使用者輸入接上 Forge workflow，而不必先完成完整知識平台或 UI。
- 好處：單一 open workflow 與 resume 優先策略，能顯著降低 session state 混亂風險。
- 好處：前段 router 現在會把 stage、relevance gate 與 deep executor 連成同一條路，避免只做 transform 但不顯示流程。
- 澄清：前段 router 若使用 `input transform` 把一般使用者輸入橋接成內部 skill prompt，transcript 仍必須保留原始使用者輸入；內部 orchestration prompt 不可直接外漏到 user-visible transcript。
- 代價：v1 對換題與多工不友善，使用者需先完成、取消或明確切換現有 workflow。
- 代價：`LIGHT_DISCOVERY` 故意偏薄，早期命中率與便利性不會追求極致。

## Not Building

- 不在本 ADR 內引入外部知識庫。
- 不在本 ADR 內規劃 multi-workflow queue 或 parallel workflows。
- 不在本 ADR 內做大型 intent taxonomy。
- 不在本 ADR 內把 `LIGHT_DISCOVERY` 擴成深度研究代理。
- 不在本 ADR 內修改 `pi-main/` core。

## Fragile Assumption

- 以「單一 open workflow + resume 優先」為核心的前段 router，足以涵蓋 v1 的一般工程使用情境；若實測顯示換題頻率高且阻礙明顯，才再討論 queue、explicit switch 或多 workflow 能力。
