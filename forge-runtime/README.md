# Forge Runtime

Forge Runtime 是一個供 [PI](../pi-main/packages/coding-agent/README.md) 載入的私有 TypeScript package。它把使用者的自然語言請求帶入可驗證的釐清流程：先辨識意圖與蒐集輕量證據，再進行 Grill，最後只在條件滿足時進入深度知識檢索。

它的重點是保留人類決策邊界。資料不足時會請求明確同意或提出一個需要確認的問題；偵測到 code base 衝突時會停止，不會自行選擇方案。

## 流程

```text
使用者請求
  -> Intent
  -> Light Discovery
  -> GRILL
       ├─ NEEDS_CONFIRMATION -> WAIT_USER
       ├─ READY_FOR_DEEP -> DEEP_KNOWLEDGE_RETRIEVAL
       └─ 驗證失敗 -> ROOT_CAUSE
```

實作中的 stage 名稱是 `GRILL`。若遺漏 Grill completion，流程會進入 `GRILL + RECOVERY_REQUIRED`，此時應使用 `retry`，不是 `continue`。

## PI 載入方式

`package.json` 的 PI manifest 會載入 `./extensions/forge-runtime.ts`。該 extension 會註冊下列 lifecycle handler：

- `input`
- `message_end`
- `message_update`
- `tool_call`

它也會提供兩個 Grill tools 與三個 Deep tools：

- `forge_grill_evidence`
- `forge_grill_complete`
- `forge_deep_search`
- `forge_deep_retrieval_complete`
- `forge_deep_complete`

Deep 分成 Retrieval 與 Understanding 兩階段。每個 Deep attempt 以
`attemptId + sourceRoundId + phase` 識別；retry 只換新的 attempt、保留來源輪次並回到原 Deep phase，cancel 保留目前輸入與證據，`continue` 也回到原 Deep phase，不會繞回 Grill。所有 stale outcome 都會安靜拒絕；若 active-tools 能力無法安全確認，Runtime 會拒絕啟動 Deep。

## 使用者入口

自然語言請求會依序經過 Intent、Light Discovery 與 Grill。若工作區缺少 `wiki/` 或 `code_base/`，Runtime 會先要求使用者明確同意再繼續；若偵測到 code base conflict，流程會停止。

可用的 `/forge-runtime` commands：

| Command | 用途 |
| --- | --- |
| `grill ambiguous <json>` | 以包含 `question`、`recommendation`、`options`、`evidenceIds` 的 JSON 直接建立 `WAIT_USER` 步驟，用於手動驗證歧義場景。 |
| `grill-result <json>` | 以 JSON 提交 Grill 結果；需要確認時進入 `WAIT_USER`，否則進入 deep gate。 |
| `confirm` / `reject` | 回應 Runtime 要求的確認。 |
| `continue` | 繼續目前可繼續的流程。 |
| `retry` | 從遺漏 completion 的 recovery 狀態重試。 |
| `cancel` | 取消目前流程。 |
| `switch <request>` | 改以新的請求繼續。 |

`WAIT_USER` selector 會固定在選項最後提供 runtime 擁有的「自行輸入…」。選取後可在同一互動中輸入文字，trim 後必須是非空內容才會送出；blank Enter 不送出，Escape 返回 selector。畫面只顯示去重後的 evidence count，不顯示 raw evidence ID，也不顯示通用 Confirm／Reject。`confirm`／`reject` command 或回答路徑仍可存在，並不代表 UI 必須顯示通用按鈕。

## Grill completion 契約

`forge_grill_complete` 只接受兩種結果：

- `NEEDS_CONFIRMATION`：必須剛好包含一個問題。
- `READY_FOR_DEEP`：不得包含問題。

第一輪 completion 必須通過 fetched-evidence 驗證。Evidence snapshot 會產生 `ev-<SHA-256>` 形式的 candidate ID，並在建立後凍結，避免後續流程改寫已確認的證據。

## 知識來源邊界

Light Discovery 只讀取工作區根目錄的 `wiki/`，並搜尋 `code_base/`。candidate 必須存在，且同時命中 path 與 content 訊號才能進入 deep 流程；有多個 candidate 時，它們還必須共用同一個 discovery seed，否則會要求更多線索。

## 目錄結構

```text
forge-runtime/
├─ extensions/forge-runtime.ts   # PI extension 入口
├─ src/discovery/                # 輕量探索與 evidence snapshot
├─ src/grill/                    # Grill 契約與結果驗證
├─ src/workflow/                 # state machine 與 orchestrator
├─ schemas/                      # Grill result JSON Schema
└─ package.json                  # PI manifest 與開發命令
```

## 開發與驗證

需求：Node.js `>=22.19.0`。

```powershell
npm install
npm run check
npm test
```

`npm run check` 會執行兩組 TypeScript 檢查；`npm test` 以序列方式執行測試。

## 目前限制

- 這是私有 package，README 不提供發布或全域安裝流程。
- `src/grill/grill-skill.ts` 目前會讀取 repo 根目錄的 `.pi/skills/grilling/SKILL.md`，因此該檔案是執行 Grill 時的必要 workspace 相依。
- README 只描述已實作的 Plan A 範圍，不代表後續 View 或 UI 工作已完成。
- 固定安全上限：query 最多 1500 個 Unicode code points；同一 source／Grill round 最多 8 次搜尋，retry／cancel 不重設；單筆證據最多 256 KiB，整輪最多 2 MiB（包含 Grill fetched 與 Deep supplemental）；decisions、findings、limitations 各最多 50 筆，每段 statement 最多 4,000 個 Unicode code points。超限會拒絕且不改目前 state；檔案會先 `stat`，恰好等於上限可以讀取。
- 每次來源搜尋最多 3 個相關候選，是呈現／候選上限；它不同於 Evidence Package 每類最多 50 筆的安全上限。
- 人類決策會以 `問題：…；決定：…` 持久保存，同一 `decisionId` 的首筆決策不可覆寫；Evidence Package 先注入人類決策，模型重複相同 ID 會被拒絕。Evidence Package 也要求 ID 唯一、finding 引用存在的 evidence，且 blocking limitation 不得完成。
