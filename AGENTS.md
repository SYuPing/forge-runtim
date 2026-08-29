# Repo Rules

## 最高準則

- Restate your last message. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another.
- 所有對話、文件、註解、commit/issue/PR 文字一律使用繁體中文。
- 任何分析、設計、開發開始前，先切到 `ponytail:full`。
- 最高原則是基於 PI package / extension / skill 開發；不要直接修改 `pi-main/` 內的程式碼，除非使用者明確授權。
- 不得為了讓測試通過而修改 `pi-main` 原始碼、放寬 fail-closed 或既有正式流程條件；測試只能驗證正式契約，不得用 workaround 改變契約。
- 純前端顯示且不參與狀態、傳輸或人類決策的步驟，不得使用會進入 agent loop 的流程通道，也不得改變流程順序、排程或結果。
- `FORGE_RUNTIME_Arch_v4.md` 是最高架構準則。只要遇到模糊邊界、邏輯矛盾、或會跨越人類決策邊界的情況，先停下來整理衝突並和使用者確認；未獲授權不得繼續實作。
- 所有程式碼搜尋一律走 `codegraph.mcp`，並一律委派唯讀子代理做唯讀探索並等待摘要。目前 repo `.codegraph/`目錄為`C:\Users\User\Desktop\Agents\pi-plugin-dev\.codegraph`；若索引不存在、失效、或需要擴大到超過 3 個檔案 / 500 行程式碼，先處理 `codegraph sync`，不要默默退回其他搜尋流程，除非使用者明確批准例外。
- 探索委派：主代理需要閱讀使用者工作項目的文件或程式碼來建立理解時，先委派唯讀子代理並等待摘要；子代理名稱**不可**重複使用；此角色固定使用 `gpt-5.6-luna` 與 `high` reasoning effort，且不再遞迴委派。系統、技能與代理規則的讀取不觸發此流程。
- 子代理收尾：主代理收到任何子代理的回傳結果後，必須優先執行 `close_agent`；工具不可用時，明確終止該次行程，避免閒置子代理被系統自動復用。
- 執行測試、驗證、或任何會跑程式的檢查時，一律委派子代理；主 context 不直接跑測試命令。
- 執行markdown文件撰寫時，一律委派子代理；主 context 不直接寫文件，**主程式碼例外，主context不碰測試，但可以寫主程式碼**。
- `/Memory/record.md` 是開發目標、重大決策、實作里程碑與目前狀態的知識庫；`/Memory/lesson_learn.md` 是 bug、根因、修復方式與可重用教訓的知識庫。開始實作前須先參考兩份檔案。
- 完成開發時，將目標、重大實作過程、驗證與狀態更新至 `/Memory/record.md`；將本輪發現的 bug、根因、修復方式與教訓更新至 `/Memory/lesson_learn.md`。沒有 bug 時明確記錄「本輪未發現新 bug」，不得捏造。
- 兩份 Memory 文件都必須保留 YAML metadata，至少包含 `title`、`type`、`scope`、`updated`、`source`、`status`；`updated` 使用 `YYYY-MM-DD`。
- `record.md` 只放開發目標與重大實作過程；`lesson_learn.md` 只放 bug 與教訓。兩份文件可互相連結，但不得複製同一段完整內容形成兩個真相來源。
- 每筆 bug 或教訓都要附可核對的檔案、測試或 log 證據；只知道現象時標示為觀察，不把未驗證假設寫成根因。歷史紀錄保留原日期與證據，不回填不存在的細節。

## Repo 邊界

- 根目錄目前只有 `FORGE_RUNTIME_Arch_v4.md`、`forge-runtime/`、`pi-main/`；沒有根層 `package.json`，不要假設能直接在 repo root 跑 `npm` workflow。
- `forge-runtime/` 目前是空目錄；新的 Forge Runtime 實作預設建在這裡。
- `pi-main/` 是上游 PI monorepo，只用來查 API、extension、skill、package 參考實作。它有自己的 `AGENTS.md`，但本 repo 的最高準則優先於上游慣例。

## 設計與交付流程

- 強制遵守 `/design-plan-workflow`。
- 每次設計決策都要先產出或更新 `CONTEXT.md`、`ADR.md`、`PLAN-A.md`；沒有 `PLAN-A.md` 不進入開發。
- 每次開發完成後，必須同步更新 `CONTEXT.md`、`ADR.md`、`PLAN-A.md`、`handoff.md`。
- 依 `FORGE_RUNTIME_Arch_v4.md`，agent 可以提出 recommendation，但不能替使用者做最終 design decision；有 ambiguity 就停在等待確認。

## 上游 PI 可驗證事實

- PI core 刻意保持 minimal；新能力應優先做成 package / extension / skill，而不是改 core。來源：`pi-main/CONTRIBUTING.md`、`pi-main/packages/coding-agent/README.md`。
- PI package 可在 `package.json` 內用 `pi` manifest 掛載 `extensions`、`skills`、`prompts`、`themes`；若沒有 manifest，PI 會自動掃描同名目錄。來源：`pi-main/packages/coding-agent/README.md`、`pi-main/packages/coding-agent/examples/extensions/with-deps/package.json`。

## 上游參考命令（僅供子代理）

- 安裝依賴：`cd pi-main && npm install --ignore-scripts`。`pi-main/.npmrc` 啟用 `save-exact=true` 與 `min-release-age=2`。
- 靜態檢查：`cd pi-main && npm run check`。
- 非 e2e 測試入口：`cd pi-main && ./test.sh`。此腳本會隔離 HOME、快取與憑證後再跑 `npm test`。
- 從原始碼啟動 PI CLI：`cd pi-main && ./pi-test.sh`；若要避免帶入本機 API keys，用 `./pi-test.sh --no-env`。

## Subagent context safety

- 每個獨立 ticket 必須建立新的子代理。
- 已完成的子代理不得接收無關的下一張 ticket。
- 只有同一 ticket 的直接 follow-up 才能重用原子代理。
- 子代理一次只能負責一個明確 deliverable。
- 探索、實作、測試與 review 必須由不同角色執行。
- 子代理不得同時負責 implementation 與 final review。

## Durable task state

- 開始工作前必須讀取 CONTEXT.md、ADR.md 與對應 ticket。
- 每完成一個 milestone，更新 agent-state/<ticket-id>.md。
- 狀態檔必須記錄：
  - 已完成項目
  - 重要決策
  - 修改檔案
  - 測試結果
  - 未解問題
  - 下一步
- 若對話歷史疑似經過 compaction、內容不完整或狀態矛盾：
  1. 停止修改
  2. 重讀 CONTEXT.md、ADR.md、ticket 與狀態檔
  3. 檢查 git status 與 git diff
  4. 重新確認已完成及未完成項目
  5. 完成狀態重建後才可繼續

## Output discipline

- 不得將完整 build、lint 或 simulation log 貼回父代理。
- 大型輸出寫入檔案，只回傳錯誤摘要與檔案位置。
- 最終回傳必須包含：
  - 結論
  - 證據或 file:line
  - 修改內容
  - 驗證結果
  - 未解風險
