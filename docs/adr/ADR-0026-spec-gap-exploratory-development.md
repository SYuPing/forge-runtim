---
title: Spec Gap 探索性開發與驗證層級
type: architecture-decision-record
scope: Forge Runtime 缺少正式 spec 時的 Knowledge／Evidence 與開發主張邊界
updated: 2026-09-02
source: 使用者核准、FORGE_RUNTIME_Arch_v4.md、ADR-0016、ADR-0021、ADR-0023、ADR-0024
status: accepted-implemented-verified
---

# ADR-0026：Spec Gap 探索性開發與驗證層級

## Context

正式 spec 可能私有、付費、受 NDA 限制、難以取得或尚未公開。若把文件未取得直接等同 Evidence failure，會錯誤阻擋探索性開發；若把推測當成 spec 證據，又會產生錯誤的相容性或安全主張。

## Decision

1. 缺少正式 spec 時建立 `Spec Gap`，不把它當一般 Evidence failure。每筆 gap 記錄 `target`、可選 `version`、`reason`、`missingEvidence` 與 `impact`。
2. 驗證層級固定為 `exploratory`、`black_box_verified`、`spec_verified`。探索性層級允許本機實作、mock、模擬器與唯讀驗證，但不得宣稱相容或符合 spec。
3. 黑箱驗證必須綁定目標、版本、環境、情境與日期，只能宣稱指定環境實測；完整相容性主張需要可核對的正式 spec。
4. 高風險真實操作在正式 spec 或對應真實驗證前禁止。現有 Forge 尚無可驗證的 capability／execution guard，因此本 ADR 只定義資料與 workflow 契約，不宣稱已封鎖任意 shell 或外部操作；可靠 enforcement 是後續 gap。
5. 沿用既有 Evidence Package、非 blocking limitation 與 `human_premise`，不新增完整 workflow state，也不修改 `pi-main/`。Spec Gap 允許 Knowledge Understanding 完成探索型封包，但保留主張限制。

## Consequences

新產品可在 spec 難以取得時繼續做技術探索；相容性、合規與高風險操作仍有清楚的主張邊界。探索封包可能帶有未償還的規格缺口，日後取得 spec 或完成指定環境實測後才可升級。

## Not in scope

不自動取得或繞過權限取得 spec，不建立 NLP 分類器、完整狀態、第二份 Evidence DTO、依賴或任意操作 guard，不修改 `pi-main/`。

## 驗收方向

- `Spec Gap` 能以既有 Evidence Package／limitation 保存五項欄位與驗證層級。
- `exploratory` 可完成 Knowledge Understanding，但相容性與高風險主張仍受結構化限制。
- `black_box_verified` 缺少任一綁定欄位時不能升級；完整時只能形成指定環境實測主張。
- `spec_verified` 必須引用可核對正式 spec 證據。

## 2026-09-02 S4 安全修正設計補充

S1–S3 已完成實作並通過最小測試；完整 `npm test` 已通過。文件 review 的 P1／P2 不代表 S1–S3 尚未完成，而是指出需追加的 S4 安全修正：

- `formalSpecReference` 只是主張資料，不能自行證明 spec；`spec_verified` 必須對照 runtime 另外傳入的受信任 formal-spec validation context，至少包含 `evidenceId`、`target`、`version`、`locator`；缺少 context 一律 validation error。
- 受信任 context 的 `evidenceId` 必須指向 package 中可核對的正式 spec evidence，不能只驗證 ID 存在。
- `scenarios` 必須深度 immutable，避免 package 建立後被外部 mutation 改寫。
- 新增欄位的 malformed runtime input 必須回傳可辨識 validation error，不能以 throw 取代 fail-closed 結果。

S4 不改變本 ADR 的探索性開發方向，也不建立 generic execution guard；高風險真實操作的可靠 enforcement 仍是後續 gap。

## 2026-09-02 二次 review 與 S4c 補充

- 目前 runtime 沒有 trusted formal-spec importer 或 context provider，因此 live `spec_verified` 故意維持 fail-closed；`exploratory`／`black_box_verified` 不受影響。正式 source importer 是後續獨立 ticket，不得宣稱正式升級已可用。
- S4c：只要 Spec Gap 的可選 `scenarios` 欄位存在，任何 verification level 都必須是字串陣列，否則回傳 validation error 且不得 throw；`black_box_verified` 仍另外要求陣列非空。
- S4a／S4b 的 test context fixture 型別錯誤已修正，且已完成 typecheck 與完整驗證；結果見下方最終段落。

## 最終實作與驗證（2026-09-02）

S1–S4e 已完成。Evidence test 28/28 pass；`forge-runtime npm test` 292/292 pass，0 fail／skip／cancelled／todo，約 30.15 秒。`npm run check` 無本 ticket 診斷，僅保留上游 `pi-main` `syntax-highlight.ts` 的 21 個 TS7016；未修改上游。最終 CodeGraph review 無阻擋 finding，`git diff --check` 無 whitespace error。

Current runtime 沒有可信 formal-spec importer／不可偽造 capability／來源綁定，所以格式正確的 `spec_verified` 仍刻意 fail-closed；這不是正式驗證已可用。exploratory／black-box 不受影響。可信 importer、來源綁定與 generic execution guard 均列為獨立後續工作。

### Current-runtime verification note（2026-09-02）

流程圖核對確認底層 Evidence engine 已完成，但 `forge_deep_complete` 尚未傳入 `verificationLevel`、`specGap` 或 `formalSpecReference`；trusted importer／來源綁定尚未落地，因此 current runtime 的 `spec_verified` 仍固定 fail-closed。此註記不新增決策，也不表示 extension 已完成 production wiring。
