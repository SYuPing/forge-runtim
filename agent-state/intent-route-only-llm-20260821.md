---
title: Intent route-only LLM ticket state
type: agent-state
scope: intent-route-only-llm-20260821
updated: 2026-08-22
source: ADR-0013、CONTEXT.md、docs/PLAN-A.md、scoped validation logs
status: complete
---

# Intent route-only LLM

## 已完成項目

- Intent contract 已收斂為嚴格 route-only JSON：`passthrough` 或 `start_forge`。
- workflow guard 已先處理 WAIT_USER、open workflow、slash control；`/grill-run` 使用 canonical payload wrapper。
- LLM 使用 PI modelRegistry seam，固定 10 秒 timeout，所有模型／解析／schema 異常 fail-closed 為 `start_forge`。
- rawText 保留；goal 由 start_forge 後取得，seed fixed-point helper 留在 extension handoff private helper；Light Discovery production／內部測試不在 scope；未修改 `pi-main/`。
- resume normalization regression、router／Grill faux-provider call sequence、fixed-point input rules 與 loader smoke 邊界已修復或固定。

## 重要決策

- 只允許兩種 route；不確定輸入不得 passthrough。
- Intent 不輸出 goal、taskKind、ambiguities、lightDiscoverySeeds 或永久 audit log。
- `IntentModelContext` 作為共用 model seam；loader smoke 與 LLM prompt 驗證分離；單檔 loader smoke 保留既有 PI runtime dist 前置條件。
- prompt isolation 已固定：規則只在 `systemPrompt`，raw input 是獨立 `user` message；injection structure regression 已加入。`IntentModelContext` 是唯一第二參數 seam，`IntentInput` 不含 model context；faux provider queue／route call-count 已配合 router completion 調整。

## 修改檔案

- Production：`forge-runtime/src/intent/intent-understanding.ts`、`forge-runtime/src/intent/intent-types.ts`、`forge-runtime/extensions/forge-runtime.ts`；刪除 `forge-runtime/src/intent/resume-check.ts`（session resume guard 移到 extension／共用 model 前置流程）。Light Discovery production 不在 scope。
- Tests：`forge-runtime/tests/intent/intent-understanding.test.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`（公開 seed characterization test）、`forge-runtime/tests/extensions/pi-extension-loader.test.ts`（loader smoke 修正）。Light Discovery 內部測試不在 scope。
- Tests：`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`（faux provider queue／route call-count 與互動路徑回歸）。
- Durable docs：`CONTEXT.md`、`docs/adr/ADR-0013-intent-route-only-llm.md`、`docs/PLAN-A.md`、`docs/handoff.md`、`Memory/record.md`、`Memory/lesson_learn.md`。

## 驗證結果

| 項目 | 結果 | 證據 |
| --- | --- | --- |
| Intent focused | 12/12 pass，exit 0 | `.tmp/intent-route-only-systemprompt-focused-intent.log` |
| Forge extension focused | 91/91 pass，exit 0 | `.tmp/intent-route-only-systemprompt-focused-extension.log` |
| PI loader smoke | 2/2 pass，exit 0 | `.tmp/intent-route-only-systemprompt-focused-pi-loader.log` |
| TypeScript check | exit 0 | `.tmp/intent-route-only-systemprompt-check.log` |
| Full suite | 146/146 pass，exit 0 | `.tmp/intent-route-only-systemprompt-test.log` |

## 歷史診斷證據

- 初始 Red：route-only focused assertions 失敗，因舊 implementation 仍輸出五欄位；見歷史 `.tmp`／本 ticket 早期 agent-state 記錄。
- 中間 validation 曾出現 asset approval action mismatch、pi-tui 缺失與 loader timeout；後續 production/test harness 修正及分離 loader smoke 後，finalgreen 已全數通過。歷史 log 保留於 `.tmp/`，不代表目前狀態。

## 未解問題

- loader smoke 仍依賴單檔既有 PI runtime dist 前置條件；若環境缺失，應先補前置條件，不修改 route contract。
- LLM 分類仍具模型誤判風險；現行 system/user 隔離與 fail-closed 只能降低風險，不能消除誤判。

## 下一步

- 等待使用者確認；未獲確認前不進入 Light Discovery。

## Final closeout（2026-08-22）

- Standards final review：0 findings。
- Spec final review：0 findings。
- acceptance／closure 已完成；本階段只處理使用者輸入到 Intent Understanding。
- 修改檔案、驗證結果與歷史診斷證據如上；`pi-main/` 與 Light Discovery production／內部測試未修改。
