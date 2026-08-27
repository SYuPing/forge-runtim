---
title: Deep target source contract 狀態
type: agent-state
scope: deep-target-source-contract-20260827
updated: 2026-08-27
source: docs/adr/ADR-0017-deep-target-source-contract.md、docs/tickets/deep-target-source-contract-20260827.md、CONTEXT.md、docs/PLAN-A.md
status: implementation-complete-validated
---

# deep-target-source-contract-20260827

## 已完成項目

- 已讀取既有 handoff、CONTEXT、PLAN-A、ADR-0015／0016、架構準則與 Memory 文件。
- 初始里程碑完成使用者核准設計的文件化；當時尚未修改 production code，亦尚未執行測試或驗證。
- 已建立第一個測試並確認有效 RED：測試預期 invalid，實際結果為 `needs_decision`；setup 已通過，exit 1。
- Slice 1 GREEN 已完成：`forge-runtime.ts` 的 `forge_deep_search` 已加入 pre-budget `targetSource` guard；第一個行為測試已完成，精準測試 exit 0，結果為 1 pass／0 fail。
- Slice 2 GREEN 已完成：production follow-up 已加入排序去重的 target source manifest，空集合以 `[]` 呈現；`Extension_DeepRetrievalFollowUp_ShouldCarryTargetManifestIncludingEmptyList` exit 0，1 pass／0 fail。
- Slice 3 GREEN 已完成：新增 `Extension_DeepSearchTargetSourceUnmatched_ShouldEnterWaitUser`；首次精準執行 exit 0／PASS，結果為 15 passed、0 failed。現有 production 已符合，未新增 production code。
- Slice 4 RED 已完成：`Extension_DeepSearchStaleSibling_ShouldTerminate` 執行 exit 1；`status: stale` 已通過，expected `terminate: true`、actual `undefined`。
- Slice 4 GREEN 已完成：production shared stale return 已加入 `terminate: true`；`Extension_DeepSearchStaleSibling_ShouldTerminate` exit 0／PASS。
- Slice 5 GREEN 已完成：新增 `Extension_DeepSearchWikiAndCodeBase_ShouldRemainUnaffected`；精準 regression exit 0／PASS，15 passed、0 failed；現有 production 無需再改。
- 五個 slice 已完成。
- Full-suite regression 修正已完成：保留既有歷史結果，針對 3 個失敗逐一完成根因修正。
- Schema review 里程碑已完成：唯一 finding 為 schema 的 optional 欄位未形成 discriminated union；已補上 TypeBox `Compile` schema assertions。
- 五個 slice 均已完成並通過驗證：target guard、follow-up target manifest、unmatched target 等待使用者、stale sibling 終止，以及 wiki／code_base regression。
- Schema review finding 已修復並通過 assertions；Standards review 與 Spec review 均為 PASS。

## 重要決策

- ADR-0017 是 target source contract 的唯一真相來源。
- follow-up 直接列出既有 snapshot target manifest，空清單也明確呈現。
- target 缺 `targetSource` 回 retryable invalid，保留 attempt 與 budget；明確但無唯一匹配才進 `WAIT_USER`。
- stale Deep sibling 回傳 `terminate: true`；不修改 `pi-main/`、`session-state.ts`、snapshot 契約或合法後續。
- Fragile assumption：PI/provider 正確使用 discriminated union；handler guard 必須保留。
- Schema review finding 已採最小修正：production schema 改為兩分支 union，分別表達帶 `targetSource` 與不帶 `targetSource` 的合法形狀。

## 修改檔案

- 新增：`docs/tickets/deep-target-source-contract-20260827.md`
- 新增：`docs/adr/ADR-0017-deep-target-source-contract.md`
- 新增：本狀態檔
- 更新：`CONTEXT.md`、`docs/PLAN-A.md`、`docs/handoff.md`、`Memory/record.md`、`Memory/lesson_learn.md`
- 本次 slice 1 GREEN 新增／修改 production 與測試檔案已完成；本狀態檔為本次唯一允許更新的文件。
- Slice 4 GREEN 修改 production shared stale return 與對應測試；本狀態檔為本次唯一允許更新的文件。
- Slice 5 僅完成 wiki／code_base regression 驗證；現有 production 無需再改，本狀態檔為本次唯一允許更新的文件。
- Full-suite regression 修正涉及：舊 ambiguous fixture、follow-up manifest 位置與 `forge_deep_search` stale 分支；本狀態檔仍為本次唯一允許更新的文件。
- Schema review 相關修改涉及 production schema 與 TypeBox Compile assertions；本狀態檔仍為本次唯一允許更新的文件。

## 測試結果

- 第一個測試已執行並有效 RED：exit 1；expected `invalid`、actual `needs_decision`；setup 已通過。
- Slice 1 GREEN 精準測試：exit 0，1 pass／0 fail。
- Slice 2 GREEN：`Extension_DeepRetrievalFollowUp_ShouldCarryTargetManifestIncludingEmptyList` exit 0，1 pass／0 fail；production follow-up target source manifest 已排序去重，空集合為 `[]`。
- Slice 3 GREEN：`Extension_DeepSearchTargetSourceUnmatched_ShouldEnterWaitUser` 首次精準執行 exit 0／PASS，15 passed、0 failed；既有 production 已符合，未新增 code。
- Slice 4 RED：`Extension_DeepSearchStaleSibling_ShouldTerminate` exit 1；`status: stale` 已通過，expected `terminate: true`、actual `undefined`。
- Slice 4 GREEN：`Extension_DeepSearchStaleSibling_ShouldTerminate` exit 0／PASS；shared stale return 已回傳 `terminate: true`。
- Slice 5 GREEN：`Extension_DeepSearchWikiAndCodeBase_ShouldRemainUnaffected` 精準 regression exit 0／PASS，15 passed、0 failed；現有 production 無需再改。
- 新增 5 個 RED 測試；基線 extension 117、完整 suite 212，最終 GREEN 為 122 與 217，0 failed。
- 完整 check：PASS，exit 0（log：`forge-runtime/.tmp/post-schema-check.log`）。
- `npm run check`：PASS，exit 0（log：`forge-runtime/.tmp/post-schema-check.log`）。
- `npm test`：217／217 通過，exit 0（log：`forge-runtime/.tmp/post-schema-test.log`）。
- 根因與修正：
  - 舊 ambiguous fixture 缺少不匹配的 `targetSource`；已補上 unmatched `targetSource`，恢復 fixture 的歧義覆蓋。
  - follow-up manifest 放在 identity JSON 之後，造成契約檢查讀不到前置 manifest；已將 manifest 移到 identity JSON 前。
  - `forge_deep_search` 有四個 stale 分支未一致終止；已統一各四個 stale 分支回傳 `terminate: true`。
- Targeted regression：3 tests／3 pass／0 skip，exit 0（log：`forge-runtime/.tmp/targeted-regression-20260827.log`）。
- Schema assertion RED：1 fail；expected `false`、actual `true`。
- Schema assertion GREEN：1 pass／0 fail。
- Standards review：PASS；Spec review：PASS。

## 未解問題

- Node `DEP0190` 警告仍存在，但不影響驗證結果。
- 尚未建立 git commit。

## 下一步

- 下一步由使用者檢閱變更並決定是否提交。
