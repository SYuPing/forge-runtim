---
title: spec-gap-exploratory-development-20260902 agent state
type: agent-state
scope: Spec Gap 探索性開發與驗證層級
updated: 2026-09-02
source: docs/adr/ADR-0026-spec-gap-exploratory-development.md、docs/tickets/spec-gap-exploratory-development-20260902.md、docs/PLAN-A.md
status: implementation-complete-verified
---

# spec-gap-exploratory-development-20260902

## 已完成項目

- 已讀取現行 CONTEXT、PLAN-A、handoff、相關 ADR、Memory、ticket 與狀態格式。
- 已確認 ADR-0024、ADR-0025 已占用，新增決策採 ADR-0026。
- 已完成使用者核准設計的文件化：Spec Gap、三層驗證、黑箱 binding、主張邊界與高風險操作限制。

## 重要決策

- spec 未取得預設允許 exploratory 開發，不阻擋 Knowledge Understanding。
- Spec Gap 使用既有 Evidence Package／非 blocking limitation／`human_premise` 路徑，不新增完整 state。
- 高風險真實操作在正式 spec 或對應真實驗證前禁止，但目前缺少可驗證 execution guard；Plan A 不把資料契約冒充安全 enforcement。
- 只有完整正式 spec 證據可支撐 `spec_verified`；黑箱測試必須綁定 target、version、environment、scenario、date。

## 修改檔案

- `forge-runtime/src/evidence/evidence-engine.ts`
- `CONTEXT.md`
- `docs/adr/ADR-0026-spec-gap-exploratory-development.md`
- `docs/PLAN-A.md`
- `docs/handoff.md`
- `docs/tickets/spec-gap-exploratory-development-20260902.md`
- `agent-state/spec-gap-exploratory-development-20260902.md`

## 測試結果

- S1 RED 已由獨立測試角色完成：`EvidencePackage_WhenExploratorySpecGapIsComplete_ShouldValidateWithoutBlocking`。
- 命令：`cd forge-runtime; npx tsx --tsconfig tsconfig.pi-interactive.json --test --test-force-exit --test-concurrency=1 tests/evidence/evidence-engine.test.ts`。
- 結果：18 pass／1 fail。失敗原因：`createEvidencePackage` 尚未保存 `verificationLevel`，因此 exploratory Spec Gap 無法完成驗證。
- 本代理未執行測試；以上為獨立 runner 回傳的 RED 證據。
- S1 production 已完成：`forge-runtime/src/evidence/evidence-engine.ts` 新增 exploratory Spec Gap 資料與驗證，並保留既有 fail-closed 規則。
- S1 GREEN 已由獨立 verifier 完成：指定測試 19/19，exit 0；S1 已完成。
- S2 RED 已由獨立測試角色完成：`EvidencePackage_WhenBlackBoxBindingIsIncomplete_ShouldRejectUpgrade`。
- 結果：19 pass／1 fail。失敗原因：validator 尚未檢查 black-box binding。
- 本代理未執行測試；以上為獨立 runner 回傳的 RED 證據。
- S2 production 已完成：`evidence-engine` 對 `black_box_verified` 要求 `version`、`environment`、非空 `scenarios` 與 `verifiedAt`。
- S2 GREEN 已由獨立 verifier 完成：20 pass／0 fail，exit 0；S2 已完成。
- S3 RED 已由獨立測試角色完成：`EvidencePackage_WhenSpecVerifiedHasFormalReference_ShouldValidate` 與 `EvidencePackage_WhenSpecVerifiedLacksFormalReference_ShouldReject`。
- 結果：21 pass／1 fail。失敗原因：validator 對 `spec_verified` 缺少 formal reference 仍放行。
- 本代理未執行測試；以上為獨立 runner 回傳的 RED 證據。
- S3 production 已完成：`formalSpecReference` 具備 `target`、`version`、`locator`、`evidenceId`；validator 要求該 `evidenceId` 位於 package 的 `evidence`。
- S3 GREEN 已由獨立 verifier 完成：22 pass／0 fail，exit 0；`EvidencePackage_WhenSpecVerifiedHasFormalReference_ShouldValidate` 與 `EvidencePackage_WhenSpecVerifiedLacksFormalReference_ShouldReject` 均已通過。
- （歷史執行紀錄）S1–S3 已完成；後續 S4a–S4e 亦已完成，現況以「最終完成狀態」為準。

## 未解問題

- 其餘 Spec Gap 欄位與三層驗證仍待驗證；本輪沒有可驗證的 capability／execution guard，高風險操作 enforcement 仍是後續 gap。
- 尚無可驗證的 capability／execution guard；高風險操作 enforcement 是後續 gap。
- 獨立 code review 發現 P1：`formalSpecReference` 目前只驗證 `evidenceId` 存在，可能指向非正式 evidence。
- 獨立 code review 發現 P2：`scenarios` 尚未深度 freeze；malformed Spec Gap runtime input 可能 throw。
- S4 設計已核准：formalSpecReference 只是主張，`spec_verified` 必須對照 runtime 另傳的受信任 formal-spec validation context（evidenceId／target／version／locator），缺 context 或指向非正式 evidence 一律錯誤；scenarios 深度 immutable；malformed 新增欄位 fail-closed。
- S4a RED 已由獨立測試角色完成：新增／調整 formal trust context tests；結果 23 pass／2 fail。
- 失敗原因：validator 尚未使用 trusted context。
- 本代理未執行測試；以上為獨立 runner 回傳的 RED 證據。
- （中間方案，已被 S4e 取代）S4a 曾新增 `TrustedFormalSpecContext` 與 exact reference matching；現行 API 已移除該型別與第二個 validator 參數，`spec_verified` 固定 fail-closed。
- S4a 首次 GREEN 驗證失敗：25 tests、24 pass／1 fail。合法 `EvidencePackage_WhenSpecVerifiedHasFormalReference_ShouldValidate` 因 `formalSpecReference` 與 trusted context 不一致遭誤拒；其餘 trust tests 通過。
- 本代理未執行測試；以上為獨立 verifier 回傳的失敗證據。
- S4a 已 GREEN：25/25，exit 0。
- 正向 fixture 的外層物件錯誤已修正；production contract 無需放寬。
- S4b RED 已由獨立測試角色完成：`EvidencePackage_WhenBlackBoxScenariosInputChanges_ShouldKeepImmutableSnapshot`、`EvidencePackage_WhenSpecGapTargetIsMalformed_ShouldRejectWithoutThrowing`。
- 結果：25 pass／2 fail。失敗原因：`scenarios` 未 clone/freeze；`target` 非字串造成 throw。
- 本代理未執行測試；以上為獨立 runner 回傳的 RED 證據。
- S4b production 已完成：加入 `scenarios` clone/freeze 與 Spec Gap runtime type guards。
- S4b 首次驗證：27 tests、26 pass／1 fail；兩個新 test 均通過，但既有 exploratory test 因 output 新增 `scenarios: undefined` 而 `deepStrictEqual` 失敗。
- 本代理未執行測試；以上為獨立 verifier 回傳的回歸證據。
- S4b 回歸修正與 GREEN 已完成：27/27，exit 0；optional `scenarios` 缺失時不再輸出 `undefined`，兩個 S4b tests 與既有 exploratory test 均通過。
- （中間方案的歷史 typecheck 紀錄，已由 S4e API 收窄取代）當時 evidence test 傳入 `{ formalSpecReference: ... }`，型別不符合 `TrustedFormalSpecContext`；這是本 ticket test fixture 型別錯誤，非上游 blocker。現行 API 不接受該 context。
- 二次 review 確認目前 runtime 沒有 trusted formal-spec importer/context provider；live `spec_verified` 必須故意 fail-closed，`exploratory`／`black_box_verified` 不受影響。正式 source importer 是後續獨立 ticket，不得宣稱正式升級已可用。
- S4c 設計已加入：只要 `scenarios` 存在，任何 verification level 都必須是字串陣列，錯誤時回傳 validation error 且不 throw；`black_box_verified` 仍要求非空。
- S4a／S4b test context fixture 型別錯誤已修正，並已完成 typecheck。
- S4c RED 已由獨立測試角色完成：新增 exploratory SpecGap 的 `scenarios` 非陣列與含非字串元素兩個測試。
- 指定 evidence test 結果：29 tests、27 pass／2 fail；兩個錯誤案例均錯誤回傳 `ok: true`。
- S4c GREEN 已完成：共同 Spec Gap validator 在 `scenarios` 欄位出現時要求其為字串陣列；`black_box_verified` 的非空既有契約保持不變。
- 獨立 evidence 測試結果：29/29 pass、0 fail、0 skip，約 278ms。
- 本代理未執行測試；以上為獨立 verifier 回傳的 GREEN 證據。
- S4d RED 已由二次 code review 發現並由獨立測試覆蓋：`spec_verified` 的 malformed `formalSpecReference` 可能因 `.trim()` 直接 throw。
- 測試覆蓋 `target`／`version`／`locator`／`evidenceId` 的數字、空值、`null`、`undefined`、物件；指定 evidence run 結果為 30 tests、29 pass／1 fail，失敗為 `target` number 造成 TypeError。
- 來源綁定是 future trusted importer 的必要契約；目前 live 沒有 context，因而仍 fail-closed，不影響 exploratory／black-box。
- 本代理未執行測試；以上為獨立 review／runner 回傳的 RED 證據。
- S4d GREEN 已完成：production 改用型別安全的 `nonEmptyString` 檢查 `formalSpecReference` 四個必要欄位；壞型別／空白值回傳 `ok: false`，不 throw。
- 獨立 evidence 測試結果：30/30 pass、0 fail、0 skip。
- 本代理未執行測試；以上為獨立 verifier 回傳的 GREEN 證據。
- 第三輪 review 記錄 S4e RED／設計修正：公開的 `TrustedFormalSpecContext` 是可偽造的結構型別，任意 caller 可能以相同 `evidenceId` 通過 `spec_verified`。
- Current runtime 必須改為不接受 caller supplied context；所有 `spec_verified` 一律 fail-closed，直到建立獨立 trusted formal-spec importer，提供不可偽造的 capability／來源綁定。
- Live `exploratory`／`black_box_verified` 不受影響；本代理未執行測試，以上為第三輪 review 的設計結論。
- S4e GREEN／API 收窄已完成：刪除公開 `TrustedFormalSpecContext`；`validateEvidencePackage` 改為只接受 `EvidencePackage`；即使 `spec_verified` 的 `formalSpecReference` 格式正確，current runtime 仍固定 fail-closed。
- 獨立 evidence 測試結果：30/30 pass。
- 本代理未執行測試；以上為獨立 verifier 回傳的 GREEN 證據。
- S4e 後 typecheck RED：`npm run check` 發現本 ticket 4 errors；`evidence-engine.ts` 約 line 252 對已收窄 union 仍比較 `spec_verified`，tests 約 lines 729／762／865 仍傳第二 context 參數。
- （歷史 RED，已完成）當時尚未確認上游錯誤；後續已修正本 ticket 型別問題並完成最終 check。現況以「最終完成狀態」為準。

## 最終完成狀態（2026-09-02）

### 已完成項目

- S1–S4e 已完成；Evidence verification levels 為 `exploratory`、`black_box_verified`、`spec_verified`。
- 缺 formal spec 時，完整且 non-blocking 的 Spec Gap 可讓 exploratory 開發繼續，但不得宣稱正式 spec 相容。
- `black_box_verified` 要求 `version`、`environment`、非空字串 `scenarios`、`verifiedAt`；所有存在的 `scenarios` 均須為字串陣列，新增欄位會 clone/freeze，壞資料回 validation error 且不 throw。
- `formalSpecReference` 的 `target`、`version`、`locator`、`evidenceId` 均以非空字串安全驗證；公開 `TrustedFormalSpecContext` 與第二個 validator 參數已移除。

### 重要決策與已知限制

- Current runtime 尚無可信 formal-spec importer／不可偽造 capability／證據來源綁定，因此格式正確的 `spec_verified` 仍固定 fail-closed；不影響 exploratory／black-box，也不宣稱正式驗證已可用。
- 可信 importer、capability／來源綁定與 generic execution guard 列為獨立後續工作。

### 修改檔案

- Production：`forge-runtime/src/evidence/evidence-engine.ts`。
- Tests：`forge-runtime/tests/evidence/evidence-engine.test.ts` 及本 ticket 相關既有回歸測試。
- Documents：本 ticket 的 CONTEXT、ADR-0026、PLAN-A、handoff、ticket、agent-state，以及 Memory 兩檔。

### 驗證結果

- Evidence test：28/28 pass。
- `forge-runtime` `npm test`：292/292 pass，0 fail／skip／cancelled／todo，約 30.15 秒。
- `npm run check` 無本 ticket 診斷；仍受上游 `pi-main/.../syntax-highlight.ts` 的 21 個 TS7016（缺少 `highlight.js` declarations）影響，未修改上游。
- 最終 CodeGraph review 無阻擋 finding；`git diff --check` 無 whitespace error，僅有 LF／CRLF 警告。

### 下一步

本 ticket 已完成。若要啟用 live `spec_verified`，需另立並完成 trusted formal-spec importer／不可偽造 capability／來源綁定 ticket；generic execution guard 亦須另案處理。

## 歷史下一步（已完成）

上述 source／test 最小修正與 typecheck 已完成；現況以「最終完成狀態」為準。
