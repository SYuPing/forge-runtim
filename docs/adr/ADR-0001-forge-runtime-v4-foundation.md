# ADR-0001 Forge Runtime v4 Foundation

日期：2026-08-07

## 狀態

Accepted

## Context

- `FORGE_RUNTIME_Arch_v4.md` 已把 v4 定義為 deterministic、workflow-controlled、evidence-driven、knowledge-first 的 engineering runtime。
- 本 repo 規則要求：基於 PI package / extension / skill 開發，不得直接修改 `pi-main/`，除非使用者明確授權。
- `forge-runtime/` 目前為空，適合從零建立可控邊界。
- 上游 PI 已提供 extension event、tool hook、UI widget、skill loading 與 package manifest，可用來承載 Forge runtime，而不需 fork core。

## Decision

1. Forge Runtime v4 以獨立 package 形式建於 `forge-runtime/`。
2. Forge Runtime 的第一階段交付物是 workflow kernel，而不是完整 UI 或完整知識平台。
3. Workflow kernel 必須先固定以下 contract：
   - state machine
   - mandatory skill dispatch
   - light discovery / deep retrieval 分流
   - `WAIT_USER` human decision boundary
   - evidence -> context -> ADR traceability
   - implement gate -> TDD -> validation -> review -> judge -> repair routing
4. 初版 UI 能力延後到 Plan B；Plan A 只要求底層 contract 可被 extension 驅動與測試驗證。
5. 初版 subagent 角色只保留最小隔離：Implementation、Test、Validation、Review、Judge/Repair。

## Decision Table

| 題目 | 決策 | 原因 |
| --- | --- | --- |
| 實作邊界 | 不改 `pi-main/`，只建 `forge-runtime/` | 符合 repo 規則與 PI minimal core 路線 |
| workflow 控制權 | 由 state machine + orchestrator 持有 | 符合 v4 的 Workflow Sovereignty |
| 人類決策邊界 | `Recommendation != Decision`，歧義即進 `WAIT_USER` | 避免 LLM 越權決策 |
| 知識擷取 | 先 Light Discovery，確認後再 Deep Retrieval | 降低 context 污染，保留 evidence traceability |
| 第一版範圍 | 先底層 contract，再補 UI | 減少一次同時碰 orchestration 與 view 的風險 |

## Consequences

- 好處：可以用最小可驗證骨架先證明 v4 路線成立，再逐層擴充。
- 代價：初版 user experience 會偏工程化，需要 Plan B 補上可視化 confirmation 與狀態呈現。
- 澄清：mandatory stage routing 不能只停留在 state mutation；像 `WAIT_USER` confirm 這類邊界，一旦確認完成，runtime 必須在同一 workflow 內實際續接下一個 mandatory stage，而不只是把 stage 名稱改掉。
- 風險：若 extension hook 不足以表達 `WAIT_USER` 或 tool gating，需停下來重新確認是否接受薄適配層，不能默默侵入 `pi-main/`。

## Not Building

- 不在本 ADR 內決定完整外部知識後端。
- 不在本 ADR 內決定所有 reasoning plugin 規格。
- 不在本 ADR 內規劃十幾種 subagent 細分角色。
- 不在本 ADR 內規劃最終商業化或部署拓樸。

## Fragile Assumption

- Extension API 足夠承載 workflow runtime。若第一個最小 integration slice 無法表達 `WAIT_USER` 與 mandatory stage enforcement，必須中止後續實作並重新確認架構。
