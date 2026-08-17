# ADR-0010：WAIT_USER 單一待決策與 UI 互動生命週期

日期：2026-08-16

## 狀態

已接受

## 背景

`WAIT_USER` 的重入可能來自相同問題再次發布、不同問題意外插入，或 UI 取消／失敗後的重試。若重入改變原待決策，或把「已發布」誤當成互動已完成，會遺失問題、阻斷重試，或重複建立狀態轉移。

## 決策

1. 同一時間只允許一個 pending decision。不同 `decisionId` 的重入採 first-pending-wins，extension 必須靜默忽略新 decision；不得拋錯、覆寫原 decision 或發布第二個 UI。
2. 相同 `decisionId` 的重入只重顯 UI，不再做 `WAIT_USER` transition。若該 UI 已 active，略過重複發布。
3. 原 `published` marker 的語意改為 in-flight UI lease：整段 `ctx.ui.custom` 互動期間持有，透過 `finally` 清除；清除責任涵蓋正常返回與例外。
4. Escape 或沒有 UI 時正常返回，保留 `WAIT_USER` 與 pending decision；允許自然文字或日後相同 ID 重試，但不自動重試。
5. UI throw 清除 lease 後向上傳遞例外，仍保留 `WAIT_USER` 與 pending decision。
6. answered decisionId reuse 維持既有行為，本次不修改。

## 拒絕的替代方案

- 不採 queue：同一 session 的待決策必須保持單一且可追溯，排隊會讓人類決策順序與當前問題脫鉤。
- 不採 replace：不同 ID 取代原問題會丟失 first pending，且讓未完成的 UI 與 workflow decision 不一致。
- 不做 history dedupe 或 reset lifecycle：這些會擴大到已回答歷史與上游元件生命週期，超出本次重入修正。

## 範圍

- 不修改 `pi-main`、schema、stages 或 completion。
- 不新增 queue、replace、history dedupe 或 reset lifecycle。

## 後果與風險

失敗與取消不會污染待決策，下一次相同 ID 可重新進入互動；不同 ID 會被靜默忽略且原狀態不變，不向呼叫端拋錯，也不發布第二個 UI。若上游強制關閉 component 而沒有呼叫 `done`，Promise 或 UI lease 可能保持 pending；本次明確排除 reset lifecycle，保留此風險供後續另案處理。

## 實作與驗證

已在 `forge-runtime/extensions/forge-runtime.ts` 分離 pending identity 與 UI in-flight lease：不同 ID 靜默忽略；同 ID 在 UI 返回後可重顯；active UI 去重；`finally` 涵蓋正常返回、Escape／undefined 與 throw；成功回答清除 identity。

- 精準測試套件：87 通過、0 失敗、0 略過。
- `npm test`：128 通過、0 失敗、0 略過。
- `npm run check`：兩段 tsc 均通過。
- Standards 審查曾找到文件過期與英文標題，現已修正；Spec 無 runtime 發現、無範圍膨脹。

未解缺口：缺少 `decisionId` 的 ingress 不做 dedupe；上游 UI component 不呼叫 `done` 可能永久 pending；方案 B 人工視覺驗收仍待使用者決策。
