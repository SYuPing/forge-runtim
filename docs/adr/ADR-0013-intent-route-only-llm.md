# ADR-0013 Intent Route-Only LLM Contract

日期：2026-08-21

## 狀態

Accepted

## Context

目前 Intent Understanding 同時負責路由、goal、taskKind、ambiguities 與 light discovery seeds，造成入口修改容易影響下游流程。使用者已確認本階段只拆解「使用者輸入 → Intent Understanding」，並要求讓 LLM 判斷是否為明確的聊天、翻譯、改寫、一次性資訊查詢或非工程任務。

## Decision

1. Intent 只做路由，驗證後的唯一輸出為嚴格 JSON：`{"route":"passthrough"}` 或 `{"route":"start_forge"}`；不得加入 reason、confidence 或其他欄位。
2. 明確非工程任務才可 `passthrough`；不確定、疑似工程請求或模型無法可靠判斷時一律 `start_forge`。
3. missing model、completion error、timeout、abort、invalid JSON、invalid schema 一律 `start_forge`。
4. WAIT_USER、open workflow、slash control 先由 workflow guard 處理；`/grill-run` 明確為 `start_forge`，不送模型分類。
5. 使用官方 `ctx.model` 與 `ctx.modelRegistry.complete()`，timeout 固定 10 秒；使用現有 TypeBox 與 `JSON.parse`，不新增依賴。
   路由規則只放在 completion 的 `systemPrompt`；不可信的 raw user input 以獨立 `user` message 傳入，僅作分類資料。injection structure regression 必須確認輸入文字不能覆寫 system prompt 規則或改變訊息角色結構。
6. 原始 `userMessage` 原封不動保留於 workflow context。`goal`、`taskKind`、`ambiguities`、`lightDiscoverySeeds`、`resumeSelection` 不再是 Intent 輸出；start_forge 後以原始有效文字取得 goal，seed fixed-point helper 留在 extension handoff private helper。
7. 「記錄 route」只指驗證後 JSON 決策供 router 消費，本 ticket 不新增永久 audit log。
8. 自然輸入的 `rawText` 必須原樣保留；`/grill-run` 使用 canonical payload wrapper 進入 formal `start_forge` ingress，避免 wrapper 文字成為下游任務內容。
9. seed fixed-point helper 由 extension handoff private helper 負責；Light Discovery production 與內部測試不在本 ticket scope。`IntentModelContext` 是 `understandIntent` 的唯一第二參數 model seam；`IntentInput` 不含 model context，不複製 PI model client。

## Supersedes

本 ADR 只 supersede [ADR-0002](./ADR-0002-forge-front-door-router.md) 第 5、8 點及其對應五欄位 intent decision table；ADR-0002 的 session、slash、WAIT_USER、open workflow 與 passthrough 邊界仍有效，除非本 ADR 明確取代。

## Consequences

- Intent contract 變小，route 與下游理解責任分離，降低修改 A 影響 B 的風險。
- 下游必須從 workflow context 取得原始 userMessage，不能再依賴 Intent 衍生欄位。
- LLM 分類失敗會保守啟動 Forge，可能增加誤啟動；這是避免漏掉工程請求的刻意取捨。

## Not Building

- 不在本 ticket 改造 Light Discovery、Grill 或 Deep Knowledge。
- 不在本 ticket 修改 Light Discovery production 或其內部測試；只保留 extension handoff 的公開 seed characterization test。
- 不新增永久 route audit log、reason/confidence 欄位、第三種 route 或新依賴。
- 不修改 `pi-main/`。

## 驗證狀態

實作與 finalgreen 驗證已完成；獨立 Standards 與 Spec final review 均為 0 findings，ticket 已完成。下一步只能等待使用者確認後再進入 Light Discovery。
