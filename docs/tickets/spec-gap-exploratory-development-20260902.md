---
title: Spec Gap 探索性開發
type: ticket
scope: Forge Runtime 缺少正式 spec 時的 Knowledge／Evidence 與開發主張邊界
updated: 2026-09-02
source: ADR-0026、使用者核准、docs/PLAN-A.md
status: implementation-complete-verified
---

# Ticket：spec-gap-exploratory-development-20260902

## Goal

正式 spec 難以取得時，允許探索性新產品開發與本機驗證，同時建立可追溯 `Spec Gap`，限制相容性主張，並提供日後黑箱或正式 spec 證據的升級路徑。

## Contract

- `Spec Gap` 記錄 `target`、可選 `version`、`reason`、`missingEvidence`、`impact`。
- 驗證層級為 `exploratory`、`black_box_verified`、`spec_verified`。
- `exploratory` 可完成 Knowledge Understanding，但不得宣稱相容／符合 spec。
- `black_box_verified` 必須綁定目標、版本、環境、情境與日期，只能宣稱指定環境實測。
- `spec_verified` 必須引用可核對正式 spec 證據，才能形成完整相容性主張。
- 高風險真實操作在正式 spec 或對應真實驗證前禁止；本 ticket 不假稱已有任意 shell／外部操作 execution guard。

## Files

預期最小 production 為 `forge-runtime/src/evidence/evidence-engine.ts` 與 `forge-runtime/extensions/forge-runtime.ts`；測試為 `forge-runtime/tests/evidence/evidence-engine.test.ts` 與 `forge-runtime/tests/extensions/forge-runtime-extension.test.ts`。若 RED 證明既有 seam 不足，先更新 Plan／ADR，不默默擴大。

## Execution order

1. 讀取 handoff、CONTEXT、ADR-0026、PLAN-A、狀態檔與 Memory。
2. S1 先由獨立測試角色建立 Evidence RED，確認失敗位置。
3. production worker 做最小 Evidence 契約實作並由獨立 runner 驗證 GREEN。
4. S2 接入 extension schema／handler，驗證 exploratory 與兩種升級邊界。
5. S3 驗證 cleanup、既有 human premise 與正常 Deep 流程回歸。
6. 最後由獨立驗證與 Standards／Spec review 收尾，再同步 durable documents 與 Memory。

## Not building

不改 `pi-main/`、不新增完整狀態機、UI、依賴、正式 spec 取得器、NLP classifier 或任意操作 capability guard；不放寬既有 fail-closed validator。

## Acceptance

探索型 Knowledge 可完成並保留 Spec Gap；不完整黑箱欄位不能升級；完整黑箱只能形成指定環境實測；正式 spec 證據才可形成 spec verified；既有流程、清理與人類前提契約不回歸。

## 最終完成（2026-09-02）

S1–S4e 已完成。缺 formal spec 時，完整 non-blocking Spec Gap 允許 exploratory 開發繼續，但不得宣稱正式 spec 相容。`black_box_verified` 要求 `version`、`environment`、非空字串 `scenarios`、`verifiedAt`；所有存在的 `scenarios` 均須為字串陣列，新增欄位會 clone/freeze，壞資料回 validation error 且不 throw。`formalSpecReference` 四欄位均安全驗證為非空字串；公開 `TrustedFormalSpecContext` 與第二個 validator 參數已移除。

Current runtime 尚無可信 formal-spec importer／不可偽造 capability／證據來源綁定，因此格式正確的 `spec_verified` 仍固定 fail-closed；不影響 exploratory／black-box，不宣稱正式驗證已可用。上述 importer、來源綁定與 generic execution guard 是獨立後續工作。

驗證：evidence 28/28；`forge-runtime npm test` 292/292，0 fail／skip／cancelled／todo，約 30.15 秒；`npm run check` 無本 ticket 診斷但保留上游 `pi-main` 21 個 TS7016；CodeGraph review 無阻擋 finding；`git diff --check` 無 whitespace error。ticket 已完成。

## S1–S3 狀態與 S4 remediation（2026-09-02）

（歷史執行紀錄）S1–S3 已完成；後續 S4a–S4e 亦已完成。最終狀態與驗證以本 ticket「最終完成」段落為準。

S4 必須補上：

- （已被 S4e 收窄取代的中間方案）原先規劃由 runtime 另外傳入受信任 formal-spec validation context（`evidenceId`、`target`、`version`、`locator`）；現行 API 已移除該 context 與第二個 validator 參數，current runtime 的 `spec_verified` 固定 fail-closed。
- `formalSpecReference` 僅是主張，不能自行證明 spec。
- `scenarios` 深度 immutable；malformed 新增欄位輸入回傳 validation error，維持 fail-closed，不以 throw 結束。

S4 不建立 generic execution guard；高風險操作的可靠 enforcement 仍是後續 gap。（歷史執行紀錄）remediation RED、最小修正、完整驗證與 review 均已完成。

## 二次 review 與 S4c（2026-09-02）

- 目前 runtime 沒有 trusted formal-spec importer/context provider，因此 live `spec_verified` 故意 fail-closed；`exploratory`／`black_box_verified` 不受影響。正式 source importer 另立獨立 ticket，不宣稱正式升級已可用。
- S4c：可選 `scenarios` 只要存在，任何 verification level 都必須是字串陣列；錯誤時回傳 validation error、不 throw；`black_box_verified` 仍要求非空。
- S4a／S4b test context fixture 型別錯誤已修正，並已完成 S4c RED→GREEN、完整驗證與 review；Plan A 已完成。
