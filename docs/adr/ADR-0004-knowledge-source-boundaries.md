# ADR-0004 Knowledge Source Boundaries

日期：2026-08-09

## 狀態

Accepted

> 2026-08-13 補充：空 manifest 與 relevance gate 的互動出口依 ADR-0008 收斂；不得建立不可完成的首輪 evidence contract，也不得只顯示 gate error。

## Context

- Forge runtime 之後會承載 `RTL`、`UVM TB`、電路合成、`C#`、`C++` 等不同領域的代理開發，不應把 `pi-main` 或 Forge 自身程式碼誤當成知識檢索主體。
- 文件知識、代碼知識、與真實 target source 必須分層，否則 agent 容易把範例、文件與實際專案狀態混在一起。
- 使用者要求：知識庫與代碼庫邊界必須硬，缺少任一正式參考資產時，不得由 agent 自行承擔無參考開發風險。

## Decision

1. 知識來源固定分三層：`wiki/`、`code_base/`、當前專案原始碼。
2. `wiki/` 是正式文件知識庫；`LIGHT_DISCOVERY` 與 `DEEP_KNOWLEDGE` 的文件知識來源都只允許讀取根目錄 `wiki/`。
3. 文件知識檢索不得 fallback 到 repo 其他目錄，不得搜尋整個作業系統。
4. `code_base/` 是代碼知識庫，供 agent 做 code lookup、範例學習、模式比對與設計參考。
5. 當前專案原始碼是唯一可確認真實行為、真實入口與最終修改落點的 target source。
6. 若根目錄缺少 `wiki/` 或 `code_base/` 任一目錄，agent 必須立即停下來，詢問使用者是否接受在缺少正式知識庫/代碼庫的情況下繼續。
7. 只有在使用者明確授權後，agent 才能在缺少 `wiki/` 或 `code_base/` 的情況下繼續開發。
8. 若 `code_base/` 與當前專案原始碼衝突，agent 必須立即停下來，展示衝突點，待使用者釐清後才能繼續。
9. `pi-main` 只作 runtime extension API、session API、command hook 等承載層事實的極窄參考，不屬於 domain knowledge，也不是 `LIGHT_DISCOVERY` / `DEEP_KNOWLEDGE` 的預設搜尋面。
10. `wiki/` 與 `code_base/` 的 metadata 都只屬於 optional acceleration layer，不得成為 agent 可運作的前置條件。
11. 沒有 metadata 時，`LIGHT_DISCOVERY` 與 `DEEP_KNOWLEDGE` 必須仍能靠路徑、檔名、標題、檔案類型與內容關鍵字做窄搜。
12. `DEEP_KNOWLEDGE` 前必須先經過 `candidate relevance gate`，不得只因為有 1-3 個候選檔案就直接展開 deeper extraction。
13. 每個候選至少需有兩種獨立訊號支持，才可視為足夠相關；若只靠單一訊號命中，不得進入 `DEEP_KNOWLEDGE`。
14. 若候選相關性不足，或候選群主題分散過大，agent 必須明確回報「候選相關性不足」，並要求更多線索或使用者指定方向。
15. `target source` 若沒有對應落點，應標記為 `Target Gap`，不得視為衝突。
16. `Target Gap` 代表可參考 `code_base` 做新功能開發，流程可繼續。
17. 只有在 `target source` 已有對應落點，且與 `code_base` 出現同名相對路徑不同內容時，才視為 `Target Conflict`，並停下來詢問使用者。
18. Light Discovery 產生空 manifest 時，首輪 Grill 不得強制引用不存在的 evidence；必須允許以零 evidence 提出恰好一個來源／scope 問題。
19. candidate relevance gate 失敗時，runtime 必須把來源／scope 問題可見地送入 `WAIT_USER`，不得只在 `GRILL` 留下錯誤。

## Decision Table

| 題目 | 決策 | 原因 |
| --- | --- | --- |
| 文件知識來源 | 只讀根目錄 `wiki/` | 保持知識邊界硬，避免搜尋失控 |
| 代碼知識來源 | 使用 `code_base/` | 讓 agent 有可參考的範例代碼庫 |
| 真實落地依據 | 當前專案原始碼 | 範例與文件都不能取代 target source |
| 缺少 `wiki/` 或 `code_base/` | 先停下來問使用者 | 無參考開發屬於人類決策邊界 |
| `code_base/` 與 target source 衝突 | 先停下來問使用者 | agent 不可自行裁決範例與現況衝突 |
| `pi-main` 角色 | 只作 runtime API 參考 | 避免把承載層誤當成 domain knowledge |
| metadata 角色 | optional acceleration layer | 不把整理 metadata 變成使用門檻 |
| `DEEP_KNOWLEDGE` 啟動條件 | 先過 `candidate relevance gate` | 避免把錯誤候選放大成完整 pattern |
| `Target Gap` | 可繼續 | 新功能開發不應被誤判成衝突 |
| `Target Conflict` | 先停下來問使用者 | 只有既有對應落點且內容衝突才算真正衝突 |
| 空 manifest | 允許零 evidence 的來源／scope 問題 | 避免首輪 Grill 形成不可滿足 contract |
| relevance gate 失敗 | 顯示可回答問題並進 `WAIT_USER` | 讓使用者能解除來源或範圍阻塞 |

## Consequences

- 好處：知識邊界更清楚，文件知識、代碼知識與真實專案狀態不再混淆。
- 好處：適合跨領域代理，`RTL`、`UVM TB`、合成流程、`C#`、`C++` 都能共用同一套結構。
- 好處：不要求使用者先整理 metadata，`wiki/` 與 `code_base/` 可以先用再逐步優化。
- 好處：`candidate relevance gate` 讓系統可在不夠確定時停止，避免深挖完全無關的候選。
- 澄清：`candidate relevance gate` 必須是獨立的 runtime routing step，而不只是 `LIGHT_DISCOVERY` 內部的候選過濾條件；只有 gate 通過後，runtime 才能正式進入 `DEEP_KNOWLEDGE_RETRIEVAL`。
- 澄清：gate 通過後的最小 deep executor 仍必須只讀 `wiki/`、`code_base/` 與 target source；它可以產出 `discoverEvidence(..., mode: "deep")`，但不代表已開放 semantic retrieval。
- 好處：`Target Gap != Conflict` 讓新功能開發不會被誤擋住。
- 代價：當缺少 `wiki/` 或 `code_base/` 時，流程會停下來等使用者授權，不能再默默 fallback。
- 代價：`code_base/` 與 target source 衝突時，開發節奏會被刻意中斷，以保住人類決策邊界。
- 代價：`DEEP_KNOWLEDGE` 不再保證每次都能產出 pattern card；候選不足時必須停下來補線索。

## Not Building

- 不在本 ADR 內決定 `wiki/` 與 `code_base/` 的內部結構細節。
- 不在本 ADR 內要求 `wiki/` 或 `code_base/` 先補 metadata 才能使用。
- 不在本 ADR 內實作 code lookup 的具體索引技術。
- 不在本 ADR 內引入 queue、parallel workflows 或 widget tree。

## Fragile Assumption

- `wiki/` 與 `code_base/` 能在多領域專案中被穩定維護成可信參考資產；若長期缺漏或頻繁過期，runtime 需要更多治理與新鮮度檢查，但那不屬於這一版決策。
