---
title: WAIT_USER UI-only state publication
type: architecture-decision-record
scope: Forge Runtime WAIT_USER state publication
updated: 2026-08-29
source: CONTEXT.md、docs/PLAN-A.md、ADR-0012、PI current 與官方 0.84.3 delivery contract
status: implemented/verified-with-existing-workspace-caveats
---

# ADR-0020：WAIT_USER UI-only state publication

## 狀態

已接受設計，且已完成實作與驗證，保留既有 workspace caveats。Ticket：`wait-user-ui-only-state-publication-20260829`。

## 背景

Forge 的 `WAIT_USER` 需要保留 workflow state 與人類決策介面，但 `publishState()` 目前會以 `pi.sendMessage` 傳送 `deliverAs: "displayOnly"` 的 `forge-stage` custom message。PI current 與官方 0.84.3 僅支援 `steer`、`followUp`、`nextTurn`；未知 delivery 在 streaming 會落入 `steer`，純顯示訊息因此可能進入 agent loop。

## 決策

採最小 Plan A：停止 WAIT_USER `forge-stage` custom message 投遞，保留 state transition、`setStatus`、WAIT_USER selector、custom editor、使用者回答與 followUp。這輪不修改 `pi-main`，不新增替代 UI、core delivery contract、session persistence 或新的 scheduler。

## 三種 WAIT_USER 類型的影響

1. `NEEDS_CONFIRMATION`：保留 WAIT_USER state 與問題／選項輸入；不再產生 `forge-stage` transcript panel。
2. Deep 或其他需要人類決策的 WAIT_USER：同樣保留決策邊界與回答 transport；不依賴 custom message 才能繼續。
3. `RECOVERY_REQUIRED`／completion omission recovery：保留 retry、cancel、switch 與 settle 行為；不新增或重做 recovery persistence panel。

## 契約變更

WAIT_USER state publication 不再承諾 `forge-stage` custom message 進入 transcript、session persistence 或 reload panel。正式契約改為 state／status／人類輸入與 followUp 的流程行為；`displayOnly` 不再是 Forge WAIT_USER 的必要 delivery。

## 代價

聊天 transcript、session reload 與回放不再有 WAIT_USER `forge-stage` panel；使用者仍可透過 WAIT_USER UI、status 與正式回答流程完成決策。

## 最脆弱假設

WAIT_USER selector／custom editor 與回答 followUp 不依賴 `forge-stage` custom message 的 session persistence。指定 targeted verification 已完成；真實 PI smoke 與完整 suite 的既有 caveats 見後文驗證紀錄。

## 驗證與狀態

實作已完成：`publishState` 先更新 `setStatus`，遇 `deliverAs: "displayOnly"` 即返回，不呼叫 `sendMessage`；omission branch state 使用 display-only 語意，recovery panel 維持 `triggerTurn: false`。state／selector／custom editor、answer followUp、retry／recovery 均保留，未修改 `pi-main`。

驗證：extension targeted 2/2；PI targeted 3/3，涵蓋 no-auto-replay 與 explicit retry callCount 2→3；static touched errors 0，剩餘 pi-main highlight.js 21 個 baseline errors；`git diff --check` 0、`pi-main` diff 0。真實 PI 0.84.3 no-session smoke 的合法 `/grill-run` WAIT_USER `display-only smoke` 通過並完成 confirm；cancel 因在 streaming 送入而 inconclusive。完整 pi interactive file 10/11，唯一 Deep dirty-scope failure 與完整 suite integration hang 均非本 ADR 範圍。

## 與 ADR-0012 的關係

本 ADR supersede ADR-0012 對 WAIT_USER transcript、session persistence、reload panel 的要求；ADR-0012 其餘 display-only 歷史與 PI core 決策保留，不在本 ticket 擴大修改。

## Rollback

若實作驗證失敗，回退本 ticket 的 Forge／tests 變更，保留 WAIT_USER state machine 與人類輸入流程；不恢復不受支援的 `displayOnly` 投遞，除非另行核准 PI core delivery contract ticket。

### 審查結論

核心規範／安全 PASS；manual retry gap 已補。Interactive harness 的 private renderer terminal cast 僅是 upstream 沒有 public injection seam 的測試 caveat，未新增抽象。
