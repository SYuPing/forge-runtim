# ADR-0014 Light Discovery 檔名與 metadata 模組

日期：2026-08-22

## 狀態

Accepted

## Context

Intent 只負責把新輸入分成 `passthrough` 或 `start_forge`。當 route 為 `start_forge` 時，需要一個可獨立插入流程的 Light Discovery，依原始使用者輸入在受限知識來源中找出可能相關的檔案。搜尋結果必須可重現，也不能把檔案內容或模型判斷偷渡成候選資料。

## Decision

1. Light Discovery 對外只提供一個 public seam；輸入只有 workspace/root 與原始 `userMessage`，不接受 seeds、workflow、Grill state 或 route。Input normalization 在 module 內部整理搜尋詞，並承接既有 extension 私有 seed extraction；caller 只傳 raw `userMessage`。
2. 模組內部固定依序為 Input normalization → deterministic Core → Output normalization。
3. 只搜尋 root `wiki/` 與 `code_base/`；不搜尋 target source、`docs/`、`Memory/`、`pi-main/` 或 OS。
4. v1 只比對檔名、相對路徑與 metadata，不做全文內容比對。metadata 只包含穩定欄位：`source`、`relativePath`、`fileName`、`extension`。
5. 每個來源最多回傳 3 筆，排序固定；相同 input 與 filesystem state 必須產生相同 output。
6. Output 只含 `matches` 與 warnings/source availability 所需狀態，不含完整內容、summary、Pattern Card、Grill snapshot 或決策。
7. 單一檔案或來源失敗時保留部分結果並回傳 warning；是否進入 `WAIT_USER` 由 workflow 決定。
8. 既有 Grill 所需的 full-content/snapshot 由 Light Discovery 外部的相容 adapter 暫時建立；本 ticket 不修改 Grill 或 Deep Knowledge 決策。

## Rejected alternatives

- 不公開 seeds、workflow 或 route，避免 caller 綁定內部推導與流程狀態。
- 不回傳 full-content 或 snapshot，避免候選搜尋與 Grill evidence／決策邊界混在一起。
- 不建立 class、factory 或 plugin registry；目前只有一個實作，單一 public seam 已足夠。
- 不新增 YAML/frontmatter metadata 規範；metadata 是 optional acceleration layer，不應變成使用前置條件。

## Consequences

- Light Discovery 可在流程中被插入、移除或替換，而不改 Intent contract。
- 檔名／路徑搜尋的精度有限；需要全文或語意查詢時，另由後續階段處理。
- 來源缺失或部分讀取失敗可保留可用結果，但 workflow 必須依 warning 決定是否停下來詢問使用者。
- Grill 維持既有行為，full-content/snapshot 的相容責任暫留在模組外部 adapter。

## Scope boundary

本 ADR 只核准 `start_forge → Light Discovery` 的設計與第一階段實作，不推進 Grill、Deep Knowledge 或人類決策。使用者已於 2026-08-22 明確核准實作。

## v4 分階段交付例外（2026-08-22）

使用者已核准本 ticket 採正式的「v4 分階段交付例外」：v4 end-state 與最高架構準則不變；本 ticket 僅交付第一階段的 `wiki/`／`code_base/` metadata-only discovery，不宣稱已完整符合 v4 所要求的多來源搜尋、Summary 或 Evidence ID。其餘 v4 end-state 能力須另開 ticket，先完成相應決策，再進行實作。

## 實作收尾（2026-08-22）

- `light-discovery.ts` 已落地 public seam（`rootDir`、raw `userMessage`）；module 內完成 normalize、metadata-only scan 與 deterministic output。
- `forge-runtime.ts` 在模組外建立 Grill／Deep Knowledge 相容 adapter；兩個 caller 均傳 raw message。模組不產生 full content、summary 或 snapshot。
- `wiki/`、`code_base/` 各最多 3 筆，依相對路徑固定排序，並回傳 `matches`、`warnings`、`sourceAvailability`；既有缺失來源人工核准流程保留。
- 驗證：互動 9/9、focused 79/79、`npm run check` exit 0、完整 `npm test` 140/140；0 fail、0 skip、0 todo，僅有既有 Node `DEP0190` warning。實作、驗證與雙軸審查均完成；詳見 `docs/handoff.md` 與 `agent-state/light-discovery-file-metadata-20260822.md`。

## 審查收尾（2026-08-22）

- 初次 Standards 與 Spec review 各有 3 個發現事項；已採納並完成必要修正。
- 修正後 Spec re-review 為 0 發現事項；Standards re-review 僅指出文件中的過時數字，已同步修正為目前 79/79 與 140/140。
- 本 ADR 的實作、驗證與雙軸審查均完成；未解風險僅為既有 Node `DEP0190` warning，v4 後續階段另案處理。
