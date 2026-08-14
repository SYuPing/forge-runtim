# ADR-0006：Grill 的唯讀候選查核與多輪決策邊界

狀態：Accepted

> 2026-08-13 補充：completion recovery 與 discovery guard 依 ADR-0008。空 manifest 不得強制首輪 evidence；relevance gate 失敗必須產生可見、可回答的來源／scope 問題。

`GRILL` 可以使用工具，但工具僅用於查核 `LIGHT_DISCOVERY` 明確產出的候選來源，且必須為唯讀；不得修改 workspace、執行會產生外部副作用的操作，或擴大成 repo-wide／OS-wide 搜尋。此權限邊界由 Forge Workflow／Extension gate 強制執行，而非只依賴 LLM prompt；查核不能取代人類設計決策，未解的設計邊界仍必須進入 `WAIT_USER`。`GRILL` 採多輪決策：每輪只提交一個最阻塞問題，使用者每次作答後記錄答案並返回下一輪 `GRILL`，僅 `READY_FOR_DEEP` 可進入 Deep Knowledge。同一個決策迴圈固定使用其起始的 Light Discovery snapshot；只有使用者改變 task goal、target 或技術範圍時，才會明確重跑 Light Discovery。

## Consequences

- `LIGHT_DISCOVERY` 保有廣泛且低成本的候選蒐集責任；`DEEP_KNOWLEDGE` 保有使用者決策後的擴大蒐證與知識整理責任。
- 每個 round 必須攜帶既有使用者決策，並避免重問相同 decision；reject 不再是 workflow 終點，而是下一輪 Grill 的輸入。
- 候選來源不足時，`GRILL` 不得自行擴大查詢；若需更換或擴大 snapshot，必須先取得使用者對範圍變更的明確輸入。
- `GRILL` v1 僅暴露 `forge_grill_evidence(candidateId)` 與 `forge_grill_complete(payload)` 兩個 domain tool；在 `tool_call` 採 deny-by-default，原生工具與未知工具一律阻擋。
- `forge_grill_evidence` 僅接受 opaque `candidateId`；其不可變 snapshot 只收錄 Light Discovery 明確引用的 `wiki` 文件、`code_base` 候選與存在時的對應 target source，模型不得傳入任意路徑。
- `WAIT_USER` 的 options 僅是快捷選擇與 recommendation；自由回答與選項回答同樣成為該 `decisionId` 的人類決策，並重新進入下一輪 `GRILL`。
- 只有明確 `/forge-runtime switch <request>` 可要求改變 task scope；replacement 必須經正式 ingress（自然請求／asset approval）建立新 snapshot，不得透過 `/grill-run` bridge。其他自由回答皆屬既有 decision loop，候選不足時必須請使用者明確 switch，不得自行重跑 Discovery。
- round id、已回答 decision 的去重，以及結構化完成回報機制須由後續計畫明確定義；本 ADR 不改變 ADR-0005 的 `toolCall → terminal message_end` lifecycle 決策。

## 實作進度（2026-08-12）

- `Extension_WhenGrillStarts_ShouldExposeOnlyDomainTools` 已 targeted green：Grill active tools 僅暴露兩個 domain tool。
- `Extension_WhenNonDomainToolIsCalledDuringGrill_ShouldBlock` 已 targeted green：Grill 期間非 domain `tool_call` 會被 block。
- immutable snapshot 的具體資料 shape 已由下列 Snapshot contract 確認；本註記不改變其餘架構決策。
- `Extension_WhenEvidenceCandidateIsKnown_ShouldReturnSnapshotContent`、`Extension_WhenEvidenceCandidateIsUnknown_ShouldReject` 與 `LightDiscovery_WhenSnapshotCreated_ShouldDeepFreezeEvidence` 已 targeted green：Light Discovery 會建立 runtime deep-frozen snapshot；已知 candidate 僅回傳 snapshot evidence，unknown ID 固定拒絕。
- `Extension_WhenGrillIsCancelled_ShouldRestorePreviousActiveTools` 與 `Extension_WhenGrillIsSwitched_ShouldRestorePreviousActiveTools` 已 targeted green：cancel／switch 會恢復 Grill 前的 active tools。

## Snapshot contract（2026-08-12）

- 使用者已確認：candidate ID 固定為以 Light Discovery 當下已選定來源的 canonical metadata 與內容計算之 `ev-<完整 SHA-256>`；模型不得指定或影響其格式。
- snapshot 必須在建立時 runtime deep-freeze，且只收錄實際選出的來源。
- 已知 candidate 的 evidence tool result 僅回傳 frozen snapshot content 與最小 metadata，並登記 fetched；unknown candidate 必須以固定錯誤拒絕，不讀檔、不改變 workflow state。
- canonical hash preimage 固定為 `JSON.stringify(["forge-grill-evidence-v1", kind, canonicalSource, normalizedContent])`；canonical source 為 `wiki/`、`code_base/` 或 `target/` 下 root-relative path，content 一律先正規化為 LF。絕對 path、排序、score 與 discovery ID 不得納入 hash。
- candidate 固定包含 `candidateId`、`kind`、`title`、`source`、`content`、`metadata`；snapshot、candidate record、candidate、metadata 及巢狀陣列都必須 runtime deep-freeze。unknown candidate 固定錯誤為 `GRILL_EVIDENCE_CANDIDATE_NOT_FOUND`。

## Safety completion（2026-08-13）

- deny-by-default 是 trust boundary：缺 `registerTool`、`getActiveTools`、`setActiveTools` 或 event hook 任一能力時，runtime 拒絕啟動或重播 Grill，不以 prompt-only 模式降級。
- 離開 Grill 的成功 `READY_FOR_DEEP` completion 必須還原進入 Grill 前的 active tools；仍在 `WAIT_USER` 的 completion 保留 domain-only tools。
- switch 僅在 replacement session 成功建立後才可清理舊 workflow；缺 `newSession` 或 replacement 取消均保留原 workflow 與工具 gate。
- 非空 snapshot 的第一個 round 必須以至少一筆已查核 evidence 完成；空 manifest 則允許零 evidence 提交唯一來源／scope 問題，避免不可完成的 Grill。同一 snapshot 的後續 round 可重用既有 evidence cache。
- candidate relevance gate 檢查 Light Discovery 已記錄的 path／content signal evidence；多筆 candidate 沒有共同 matched discovery seed 時視為主題分散，停在 `CANDIDATE_RELEVANCE_INSUFFICIENT`，不進 Deep。
- Grill prompt 必須明示只允許兩個 domain tools；runtime gate 仍是最終強制層。
- `WAIT_USER` 仍是受控 Grill loop；非 domain `tool_call` 一律阻擋。重複 decision answer 必須安全停留，不能透過 resume transport 建立新 round。
- candidate relevance gate 失敗不得只停在 `GRILL` 顯示錯誤；runtime 必須顯示來源／scope 問題並進 `WAIT_USER`，回答後再進下一輪 Grill。
