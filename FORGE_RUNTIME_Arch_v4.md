基於你剛剛實際在 PI 上跑出的結果，我會把之前的 v3 **正式升級成 Forge Runtime v4**。

這一版最大的變化不是「多幾個 Agent」，而是把 **Workflow 控制權從 LLM Prompt 中拿回來**：

> **LLM 負責理解、推理與產生決策候選；Forge Workflow 負責決定流程、狀態轉移、強制 Skill、Pause、Fan-out、Validation、Repair。**

這非常適合從全新的 PI 0.83.0 基線開始做。PI 本身的定位就是保持 core minimal，透過 TypeScript Extensions、Skills、Packages 等方式擴充；官方也明確表示 PI 不內建 sub-agent、plan mode、MCP，而鼓勵透過 extension 自己實作。([GitHub][1])

---

# Forge Runtime v4

## Engineering Intelligence Platform for Chip Design

我會把 v4 定義成：

> **A deterministic workflow-controlled, evidence-driven, knowledge-first engineering agent runtime built on PI.**

核心不是：

```text
LLM → Tools → Code
```

而是：

```text
User
 ↓
Forge Workflow
 ↓
Deterministic State Machine
 ↓
LLM Reasoning / Skills
 ↓
Evidence
 ↓
Decision
 ↓
Execution
 ↓
Validation
 ↓
Repair
```

---

# 一、完整 v4 系統架構

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                         FORGE RUNTIME v4                                    │
│             Engineering Intelligence Platform for Chip Design               │
│                         Based on PI 0.83.0                                  │
└──────────────────────────────────────────────────────────────────────────────┘

 USER / IDE / CI / REST / CLI
          │
          ▼
┌──────────────────────┐
│ 1. Capability Gateway│
│ Intent / Auth /      │
│ Session / Request    │
└──────────┬───────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    2. WORKFLOW ORCHESTRATOR                         │
│                                                                     │
│  Workflow Lifecycle Controller                                     │
│                                                                     │
│  Intent → Discovery → Grill → Knowledge → Context → ADR            │
│          → Spec → Ticket → Plan → Implement → TDD                 │
│          → Fan-out → Validate → Review → Judge → Complete          │
│                                                                     │
│  ★ Mandatory Skill Dispatcher                                      │
│  ★ Pause / Resume                                                  │
│  ★ Human Confirmation                                              │
│  ★ Fan-out / Fan-in                                                │
│  ★ Retry / Recovery                                                │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    3. STATE MACHINE                                │
│                                                                     │
│ RECEIVE                                                             │
│   ↓                                                                 │
│ INTENT                                                              │
│   ↓                                                                 │
│ LIGHT_DISCOVERY      ← deterministic                               │
│   ↓                                                                 │
│ GRILL                 ← mandatory skill                            │
│   ↓                                                                 │
│ AMBIGUOUS? ───── YES ──→ WAIT_USER                                 │
│   │                         │                                       │
│   NO                        └──── User Confirm ────┐               │
│   │                                                │               │
│   └────────────────────────────────────────────────┘               │
│                         ↓                                           │
│ DEEP_KNOWLEDGE_RETRIEVAL                                           │
│                         ↓                                           │
│ KNOWLEDGE_UNDERSTANDING                                            │
│                         ↓                                           │
│ CONTEXT                                                            │
│                         ↓                                           │
│ ADR                                                                │
│                         ↓                                           │
│ TO_SPEC                                                            │
│                         ↓                                           │
│ TO_TICKET                                                          │
│                         ↓                                           │
│ PLANNING                                                           │
│                         ↓                                           │
│ IMPLEMENT_GATE                                                     │
│                         ↓                                           │
│ TDD                                                                │
│                         ↓                                           │
│ FAN_OUT_EXECUTION                                                  │
│                         ↓                                           │
│ VALIDATION                                                         │
│                         ↓                                           │
│ REVIEW                                                             │
│                         ↓                                           │
│ JUDGE                                                              │
│                         │                                           │
│              ┌──────────┴──────────┐                                │
│              │                     │                                │
│            PASS                  FAIL                               │
│              │                     │                                │
│              ▼                     ▼                                │
│          COMPLETE           ROOT_CAUSE_ANALYSIS                     │
│                                    │                                │
│                                    ▼                                │
│                             REPAIR ORCHESTRATOR                     │
│                                    │                                │
│                       Targeted State Rollback                      │
└─────────────────────────────────────────────────────────────────────┘
```

這個 State Machine 是 v4 的**心臟**。

---

# 二、最重要的架構改變：Workflow > LLM

這一版我會把權限關係定死。

```text
                    Forge Workflow
                          │
          ┌───────────────┼────────────────┐
          ▼               ▼                ▼
       State           Skill            Tool
     Transition       Dispatch         Execution
          │               │                │
          └───────────────┼────────────────┘
                          ▼
                         LLM
```

而不是：

```text
LLM
 │
 ├── decide whether to grill
 ├── decide whether to search
 ├── decide whether to implement
 ├── decide whether to test
 └── decide whether to review
```

### v4 的原則

| 行為                 | 誰決定                     |
| ------------------ | ----------------------- |
| 是否 Intent          | Workflow                |
| 是否 Light Discovery | Workflow                |
| 是否 Grill           | Workflow                |
| 是否需要 User          | Workflow + Grill result |
| 是否 Deep Retrieval  | Workflow                |
| 是否產生 Context       | Workflow                |
| 是否產生 ADR           | Workflow                |
| 是否 to-spec         | Workflow                |
| 是否 to-ticket       | Workflow                |
| 是否 implement       | Workflow                |
| 是否 TDD             | Workflow                |
| 是否 Fan-out         | Workflow                |
| 是否 Validation      | Workflow                |
| 是否 Review          | Workflow                |
| 是否 Repair          | Workflow                |
| **怎麼理解問題**         | LLM                     |
| **怎麼推理**           | LLM                     |
| **怎麼產生候選方案**       | LLM                     |
| **怎麼寫 Code**       | LLM + implement         |

這是整個 v4 最重要的 Architecture Decision。

---

# 三、v4 的第一個核心：Two-Stage Knowledge Retrieval

這是從你實際執行 NT51365Z 得出的最重要改進。

不是：

```text
Intent
 ↓
Grill
 ↓
Knowledge
```

也不是：

```text
Intent
 ↓
Full Knowledge
 ↓
Grill
```

而是：

```text
Intent
 ↓
LIGHT DISCOVERY
 ↓
GRILL
 ↓
USER CONFIRMATION
 ↓
DEEP KNOWLEDGE
```

---

## ① Light Discovery

它**不是 LLM Skill**。

而是 deterministic engine。

例如：

```text
forge_discover
```

輸入：

```json
{
  "query": "NT51365Z SPI RTL",
  "domain": "RTL",
  "mode": "light"
}
```

搜尋：

```text
Wiki
Code Index
ADR
Spec
Rule
Memory
```

但是只返回：

```text
Document
Relevant Section
Metadata
Summary
Evidence ID
```

不把整份 Data Sheet 放進 Context。

---

# 四、為什麼 Light Discovery 不需要 Prompt？

因為它直接由 TypeScript Workflow 呼叫。

```text
INTENT_COMPLETE
       │
       ▼
DISCOVERY_REQUIRED
       │
       ▼
DiscoveryEngine.run()
       │
       ├── Wiki Search
       ├── Code Search
       ├── ADR Search
       ├── Rule Search
       └── Graph Search
       │
       ▼
DiscoveryPackage
       │
       ▼
GRILL
```

所以就算 LLM Prompt 寫：

> 不需要搜尋 Wiki。

也沒用。

Workflow 還是：

```text
DISCOVERY_REQUIRED
```

這就是你問的：

> 「如何在 PI 上不要依靠 Prompt 做到輕量探索？」

答案就是：

**把 Discovery 寫成 State + Engine，而不是 Prompt。**

---

# 五、第二個核心：Grill Gate

Grill 是 Matt Pocock skill，但在 v4 中它是：

> **Workflow Mandatory Skill**

不是：

> User Callable Skill

也不是：

> LLM Optional Skill

PI 本身支援 Skills 與 Extensions，而 PI Package 可以把 extensions、skills、prompts 等資源一起封裝。([GitHub][2])

所以 Forge 可以把 Matt Pocock skills 放在自己的 Forge Package 裡。

---

# 六、Grill 的權責

Grill 可以：

```text
理解需求
找出 ambiguity
找出 missing information
找出 contradictory requirements
找出 assumptions
提出 alternatives
提出 recommendation
```

但是：

## Grill 不可以自行做 User Decision

例如：

```text
Recommendation:
3-wire 9-bit
```

可以。

但是：

```text
Decision:
3-wire 9-bit
```

不可以，除非：

```text
User Confirmed
```

所以：

```text
Recommendation ≠ Decision
```

這條應該直接寫進 v4 ADR。

---

# 七、Grill 的輸出必須 Structured

例如：

```json
{
  "status": "NEEDS_CONFIRMATION",

  "questions": [
    {
      "id": "SPI_MODE",
      "question": "NT51365Z SPI 要使用 3-wire 還是 4-wire？",
      "options": [
        "3-wire 9-bit",
        "4-wire"
      ]
    }
  ],

  "recommendation": {
    "value": "3-wire 9-bit",
    "reason": "Project usage and datasheet evidence",
    "confidence": 0.91
  },

  "evidence": [
    "EV-0001",
    "EV-0002"
  ],

  "requires_user_confirmation": true
}
```

Workflow 只要看到：

```text
requires_user_confirmation = true
```

就：

```text
WAIT_USER
```

---

# 八、WAIT_USER 是真正的 State

不是：

```text
LLM:
Please confirm...
```

而是：

```text
Workflow State:

WAIT_USER
```

PI Extension 負責把 UI 顯示給使用者。

PI 的 Extension API 本身可以加入 custom UI，也有 lifecycle events 與 custom tools，因此這類 confirmation gate 很適合放在 Forge Extension，而不是靠 Prompt。([GitHub][3])

---

# 九、使用者作答後回到 Grill；邊界釐清後才進 Deep Knowledge

例如：

```text
User:
3-wire 9-bit
```

Workflow：

```text
WAIT_USER
      ↓
USER_CONFIRMED
      ↓
GRILL（下一輪；帶入已確認決策）
      ↓
READY_FOR_DEEP
      ↓
DEEP_KNOWLEDGE
```

每輪 Grill 只處理一個最阻塞的設計邊界。使用者的選項或自由回答都必須記錄為人類決策，再由下一輪 Grill 判斷是否仍有未解邊界；只有 Grill 明確回報 `READY_FOR_DEEP` 才可進入 Deep Knowledge。

窄例外（零候選探索 opt-in）：上述一般規則維持不變。只有當前 manifest snapshot 為 `matches=[]`、runtime 已送出 marker `forge-empty-snapshot-exploratory-consent` 的固定探索 opt-in，且使用者回覆符合既有 `isApproval` 的明確肯定時，該回答才視為 `human_premise`（不是知識充分性確認），允許由 `WAIT_USER` 直接進入既有 `DEEP_KNOWLEDGE_RETRIEVAL`；拒絕或模糊回答維持 `WAIT_USER`。有候選流程仍必須經下一輪 Grill，且任何一般 `NEEDS_CONFIRMATION` 不適用此例外。

## 九之一、Grill Completion 與 Recovery 的最高規範（2026-08-13）

### Grill 呼叫傳輸不變量（2026-08-17）

`input` transform 產生的完整 Grill invocation 必須原樣進入該 attempt 的 provider request。provider-facing invocation 至少必須保留 Grill completion contract、runtime-issued `roundId`、snapshot manifest 與目前任務；在 provider 消費前，任何 `message_end`、history cleanup 或顯示用途的 rewrite 都不得原地改寫同一個 message object。

使用者原始請求的短版顯示屬於 presentation concern，不得與 provider transport 共用會互相覆寫的訊息生命週期。若沒有獨立且可驗證的 presentation seam，v1 優先保留完整 invocation；不可為了縮短 transcript 而破壞 completion-tool-only contract。

### Display-only 自訂訊息契約（2026-08-20）

coding-agent ExtensionAPI 新增真正的 display-only custom message：`deliverAs: "displayOnly"` 優先於 `triggerTurn`／`steer`／`followUp`／`nextTurn`。訊息仍進入 UI、transcript、session persistence 與 reload，但永不排入 provider／LLM context，也永不觸發 turn。其持久 marker 為 `excludeFromContext?: boolean`，建立 display-only 訊息時固定為 `true`；讀取缺少 marker 的舊 session 維持舊語意，不重用 `display` 欄位。顯示抑制與 display-only 是兩個獨立的 core contract。

Forge 僅讓成功 `forge_grill_complete` 的 `NEEDS_CONFIRMATION` WAIT_USER state message 使用 display-only；其他 command、retry、cancel、switch、deep knowledge 與一般 state message 維持現況。`excludeFromContext` 的 rehydrate 排除也涵蓋 branch summarization，不只一般 compaction。

`forge_grill_complete` 是每個 Grill attempt 的唯一正常完成通道。正常 completion 與 completion omission 必須走不同 lifecycle：

```text
NEEDS_CONFIRMATION
  → 顯示恰好一個問題
  → WAIT_USER
  → User answer
  → 自動進下一 Grill round

READY_FOR_DEEP
  → runtime gate
  → 自動進 DEEP_KNOWLEDGE_RETRIEVAL

Completion Omission
  → 記錄該 attempt 已 omission／已進 recovery
  → GRILL + RECOVERY_REQUIRED
  → 顯示 retry / cancel / switch
  → session settled，等待使用者
```

`RECOVERY_REQUIRED` 是 `GRILL` 的 substate／marker，不是新的 top-level workflow stage。每個 round 的每次執行都是一個有界 attempt；同一 attempt 首次漏呼叫 completion 時只能進 recovery 一次，重複 terminal event 必須 no-op。

completion omission 發生後必須立即停止：

- streaming `message_end` 不得呼叫會造成 steer 的 `sendMessage` 或 follow-up replay。
- 不得 background retry、不得自動 replay、不得自動進 Deep Knowledge。
- recovery panel 必須提供 `/forge-runtime retry`、`/forge-runtime cancel`、`/forge-runtime switch <request>`。
- 只有明確 `/forge-runtime retry` 可用同一 round 與同一 immutable snapshot 建立新 attempt；新 attempt 仍有相同的一次 recovery 上限。
- `/forge-runtime continue` 不再承擔 omission recovery；處於 `RECOVERY_REQUIRED` 時不得把 continue 當成 retry。

所有可見 Grill／WAIT_USER／recovery panel 的 message contract 固定為：

```ts
{
  content: panelText,
  display: true,
}
```

Grill prompt 不得再要求 assistant「只輸出一個問題」。模型不得輸出 assistant prose；若需要確認，必須呼叫 `forge_grill_complete`，且 `questions` 恰好一題；若為 `READY_FOR_DEEP`，`questions` 必須為空。

Discovery guard 同樣是完成性規範：

- 非空 manifest 的首輪 completion 才強制至少一筆已查核 evidence。
- 空 manifest 必須允許零 evidence 的單一來源／scope 問題，不得建立不可完成的首輪 Grill。
- candidate relevance gate 失敗必須產生可見、可回答的來源／scope 問題並進 `WAIT_USER`，不得只留在 `GRILL` 顯示錯誤。

真實互動驗收是 release gate。必須在 PI TUI 證明問題可見、回答後自動開始下一 round、`READY_FOR_DEEP` 自動推進、completion omission 每個 attempt 最多進 recovery 一次且 session settled；明確 retry 可開新 attempt，但單次使用者輸入不得產生無上限 assistant turns。

這時才搜尋：

```text
NT51365Z
+
SPI
+
3-wire
+
9-bit
```

然後取得：

```text
Datasheet
Application Note
Existing RTL
Coding Style
ADR
Verification
Lessons Learned
```

---

# 十、Knowledge Engine v4

我建議 Knowledge Engine 重新設計成：

```text
7. KNOWLEDGE ENGINE

 ┌────────────────────────────────────┐
 │ Knowledge Registry                 │
 │                                    │
 │ Wiki                               │
 │ Spec                               │
 │ ADR                                │
 │ Coding Style                      │
 │ Rule                               │
 │ Memory                             │
 │ FAQ                                │
 └────────────────┬───────────────────┘
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
 Light Discovery       Deep Retrieval
       │                     │
       └──────────┬──────────┘
                  ▼
        Knowledge Understanding
                  │
                  ▼
           Evidence Package
```

---

# 十一、Evidence Engine v4

這個 Engine 在 v4 的重要性會比以前更高。

所有重要決策都必須能回答：

> **Why?**

例如：

```text
Decision:
3-wire 9-bit SPI

Evidence:
EV-0001

Source:
NT51365Z Datasheet

Section:
7.2

Reason:
Device supports 3-wire mode.
```

因此：

```text
Evidence
   ↓
Context
   ↓
ADR
   ↓
Spec
   ↓
Implementation
```

形成完整 Traceability。

---

# 十二、Context / ADR / Spec / Ticket 四層

這四個東西不要混在一起。

```text
                    Knowledge
                        │
                        ▼
                 ┌────────────┐
                 │ CONTEXT.md  │
                 │ What we know│
                 └──────┬─────┘
                        ▼
                 ┌────────────┐
                 │  ADR.md     │
                 │ Why decide  │
                 └──────┬─────┘
                        ▼
                 ┌────────────┐
                 │  SPEC.md    │
                 │ What build  │
                 └──────┬─────┘
                        ▼
                 ┌────────────┐
                 │  TICKET     │
                 │ How execute │
                 └────────────┘
```

所以：

### CONTEXT.md

回答：

> 我們現在知道什麼？

### ADR.md

回答：

> 為什麼這樣決定？

### SPEC.md

回答：

> 最終要實作什麼？

### Ticket

回答：

> 要執行哪些工作？

---

# 十三、Matt Pocock Skills 在 v4 的定位

這裡我要正式定義。

| Skill     | v4 定位                               |
| --------- | ----------------------------------- |
| grill     | **Mandatory Workflow Gate**         |
| to-spec   | **Mandatory Workflow Stage**        |
| to-ticket | **Mandatory Workflow Stage**        |
| implement | **Mandatory Execution Skill**       |
| TDD       | **Mandatory Coding Policy / Skill** |

它們不是：

```text
Plugin
```

而是：

```text
Workflow-Native Skill
```

---

# 十四、Reasoning Plugin 則保留可插拔

這個區分非常重要。

```text
Workflow-Native
────────────────

Grill
to-spec
to-ticket
implement
TDD
```

不可由 LLM 任意跳過。

而：

```text
Reasoning Plugin
────────────────

ReAct
Reflection
Plan & Execute
DU EA
RTL Reasoning
Multi-Agent Reasoning
```

可以替換。

所以：

```text
Workflow
     │
     ├── Mandatory Skills
     │
     │    ├── Grill
     │    ├── to-spec
     │    ├── to-ticket
     │    ├── implement
     │    └── TDD
     │
     └── Reasoning Plugins
          ├── ReAct
          ├── Reflection
          ├── Plan
          └── RTL Reasoning
```

---

# 十五、Implement 階段正式 Fan-out

到了：

```text
IMPLEMENT
```

才開始拆 Agent。

例如：

```text
                  IMPLEMENT
                      │
             ┌────────┼─────────┐
             ▼        ▼         ▼
         RTL Agent  Test Agent  Doc Agent
             │        │         │
             ▼        ▼         ▼
          RTL Code   Test      Update
                      │
                      ▼
                    TDD
```

這裡主 Workflow 不自己寫全部 Code。

---

# 十六、TDD 也由 Workflow 強制

如果 Ticket：

```text
requires_code = true
```

那：

```text
IMPLEMENT
    ↓
TDD
```

不能：

```text
IMPLEMENT
    ↓
Code
    ↓
Done
```

而必須：

```text
Test
 ↓
RED
 ↓
Implementation
 ↓
GREEN
 ↓
Refactor
 ↓
GREEN
```

---

# 十七、不能自己開發自己審

這條我會直接列為 v4 Architecture Principle。

```text
Main Workflow
      │
      ▼
Execution
      │
      ├──── Agent A → Code
      │
      ├──── Agent B → Test
      │
      └──── Agent C → Documentation
      │
      ▼
Independent Validation
      │
      ├──── Compile
      ├──── Lint
      ├──── Simulation
      ├──── Coverage
      └──── Test
      │
      ▼
Independent Review
      │
      ├──── RTL Review
      ├──── Spec Review
      ├──── Coding Style
      └──── Evidence Review
      │
      ▼
Judge
```

**寫 Code 的 Agent 不負責最終 Review。**

---

# 十八、260K Context 的設計

這一點對你的架構非常重要。

不要：

```text
Main Agent
+
所有 Wiki
+
所有 Code
+
所有 SubAgent
+
所有 Validation
+
所有 Review
```

塞進 260K。

而是：

```text
Main Workflow
       │
       ├── Context Package
       │
       ├── Evidence Package
       │
       ├── Ticket
       │
       └── Subagent Result
```

Subagent 只拿：

```text
Task
+
Relevant Context
+
Relevant Evidence
+
Relevant Files
```

完成後回傳：

```text
Result
+
Evidence
+
Changed Files
+
Test Result
```

主 Workflow 不需要保留整個 Subagent conversation。

---

# 十九、Subagent 的角色

v4 不需要一開始就拆成十幾個 Agent。

第一版建議只有：

```text
1. Main Orchestrator
2. Implementation Agent
3. Test Agent
4. Validation Agent
5. Review Agent
6. Judge / Repair Agent
```

其中：

```text
Implementation
Test
Review
```

必須是**互相隔離的角色**。

這已經可以實現：

> 不能自己開發自己審。

---

# 二十、Validation → Repair Loop

這是 v4 比 v3 再進一步的地方。

```text
Validation
    │
    ▼
FAIL
    │
    ▼
Evidence Engine
    │
    ▼
Root Cause Analyzer
    │
    ▼
Repair Orchestrator
```

Root Cause：

```text
Requirement
Knowledge
Context
ADR
Spec
Ticket
Implementation
Test
Tool
Environment
```

然後決定回哪裡。

例如：

```text
Requirement
     ↓
Grill
```

```text
Knowledge
     ↓
Deep Retrieval
```

```text
Spec
     ↓
to-spec
```

```text
Ticket
     ↓
to-ticket
```

```text
Code
     ↓
implement
```

```text
Test
     ↓
TDD
```

---

# 二十一、ReAct 在 v4 的正確位置

不是：

```text
ReAct
 ↓
控制整個 Agent
```

而是：

```text
State
 ↓
Evidence
 ↓
ReAct
 ↓
Action
 ↓
State Transition
```

所以：

> **State Machine 是骨架，ReAct 是肌肉。**

例如：

```text
VALIDATION_FAIL
       ↓
Evidence
       ↓
ReAct
       ↓
Root Cause
       ↓
Repair
       ↓
Validation
```

這樣 ReAct 不會失控。

---

# 二十二、完整 v4 State Machine

我建議正式定義成：

```text
S00 RECEIVE
 │
 ▼
S01 INTENT_UNDERSTANDING
 │
 ▼
S02 LIGHT_DISCOVERY
 │
 ▼
S03 GRILLING
 │
 ├── CLEAR ───────────────────────────┐
 │                                    │
 └── AMBIGUOUS                        │
        │                             │
        ▼                             │
S04 WAIT_USER                         │
        │                             │
        ▼                             │
S05 USER_CONFIRMED ───────────────────┘
 │
 ▼
S06 DEEP_KNOWLEDGE_RETRIEVAL
 │
 ▼
S07 KNOWLEDGE_UNDERSTANDING
 │
 ▼
S08 CONTEXT_BUILD
 │
 ▼
S09 ADR_BUILD
 │
 ▼
S10 TO_SPEC
 │
 ▼
S11 TO_TICKET
 │
 ▼
S12 PLANNING
 │
 ▼
S13 IMPLEMENT_GATE
 │
 ├── NO CODE → S18
 │
 ▼
S14 TDD
 │
 ▼
S15 FAN_OUT_EXECUTION
 │
 ▼
S16 VALIDATION
 │
 ▼
S17 REVIEW
 │
 ▼
S18 JUDGE
 │
 ├──────── PASS ──────────► S19 COMPLETE
 │
 └──────── FAIL
              │
              ▼
        S20 ROOT_CAUSE
              │
              ▼
        S21 REPAIR_ORCHESTRATOR
              │
              ├── Requirement → S03
              ├── Knowledge   → S06
              ├── Context     → S08
              ├── ADR         → S09
              ├── Spec        → S10
              ├── Ticket      → S11
              ├── Code        → S13
              └── Test        → S14
```

這個就是我建議你實際寫進 TypeScript 的 **v4 State Machine Contract**。

---

# 二十三、完整 Engine 分層

最終我會把 Forge v4 分成這 6 層。

```text
┌──────────────────────────────────────────────┐
│ LAYER 1：INTERFACE                          │
│ PI TUI / CLI / REST / Web / IDE              │
└───────────────────────┬──────────────────────┘
                        ▼
┌──────────────────────────────────────────────┐
│ LAYER 2：ORCHESTRATION                      │
│ Workflow Orchestrator                        │
│ State Machine                                │
│ Skill Dispatcher                             │
│ Pause / Resume                               │
│ Fan-out / Fan-in                             │
└───────────────────────┬──────────────────────┘
                        ▼
┌──────────────────────────────────────────────┐
│ LAYER 3：INTELLIGENCE                       │
│ Intent                                      │
│ Grill                                        │
│ Knowledge Understanding                      │
│ Planning                                     │
│ ReAct / Reflection                           │
│ Root Cause Analysis                          │
└───────────────────────┬──────────────────────┘
                        ▼
┌──────────────────────────────────────────────┐
│ LAYER 4：KNOWLEDGE & EVIDENCE               │
│ Light Discovery                              │
│ Deep Retrieval                               │
│ Wiki / Code Graph / ADR / Rules              │
│ Evidence / Citation / Sufficiency             │
│ Context / ADR / Spec                         │
└───────────────────────┬──────────────────────┘
                        ▼
┌──────────────────────────────────────────────┐
│ LAYER 5：EXECUTION                          │
│ implement                                    │
│ TDD                                          │
│ Subagents                                    │
│ Validation                                   │
│ Review                                       │
│ Repair                                       │
└───────────────────────┬──────────────────────┘
                        ▼
┌──────────────────────────────────────────────┐
│ LAYER 6：INFRASTRUCTURE                     │
│ Tool Runtime                                 │
│ Artifact Store                               │
│ LLM Adapter                                  │
│ Event Bus                                    │
│ Session / Memory                             │
│ Observability                                │
│ Governance                                   │
└──────────────────────────────────────────────┘
```

---

# 二十四、PI 0.83.0 上怎麼落地

這點我會特別建議：

## **預設不 Fork PI Core。**

Forge 應該是：

```text
PI 0.83.0
     │
     ▼
Forge Package
     │
     ├── Extensions
     ├── Skills
     ├── Tools
     ├── UI
     └── Workflow Runtime
```

PI 官方目前的架構也是讓 workflow-specific behavior 透過 Extensions / Skills / Packages 擴充，而不是修改 core；Extension 可以提供 custom tools、事件處理與 UI。只有使用者明確核准、且由 ADR-0012／Plan A 限定的 display-only 最小 core 例外可修改 coding-agent core；其他 core 變更仍禁止，亦不 fork PI。([GitHub][1])

本輪唯一支援基線是 coding-agent `0.83.0`，repo commit `321bbe69e909de9551906967629908a99167d11e`（`321bbe6`），branch `main`。方案 C 是窄化的 core 例外：只在 coding-agent ExtensionAPI／session 路徑加入 display-only custom message contract；不 fork PI、不改 `packages/agent/src/harness/*`，也不保證跨 package 共用 JSONL。

而且 PI Package 本身可以透過 `package.json` 的 `pi` manifest 掛載 extensions、skills、prompts、themes。([GitHub][2])

---

# 二十五、建議的 Forge Package 結構

從乾淨 PI 0.83.0 開始，我會直接建立：

```text
forge/
│
├── package.json
├── tsconfig.json
│
├── extensions/
│   │
│   └── forge-runtime.ts
│
├── src/
│   │
│   ├── workflow/
│   │   ├── state-machine.ts
│   │   ├── orchestrator.ts
│   │   ├── transition.ts
│   │   ├── lifecycle.ts
│   │   └── pause-manager.ts
│   │
│   ├── intent/
│   │   └── intent-engine.ts
│   │
│   ├── discovery/
│   │   ├── discovery-engine.ts
│   │   ├── wiki-discovery.ts
│   │   ├── code-discovery.ts
│   │   └── graph-discovery.ts
│   │
│   ├── grill/
│   │   ├── grill-runner.ts
│   │   └── grill-schema.ts
│   │
│   ├── knowledge/
│   │   ├── retrieval-engine.ts
│   │   ├── knowledge-understanding.ts
│   │   └── context-builder.ts
│   │
│   ├── evidence/
│   │   ├── evidence-engine.ts
│   │   ├── citation.ts
│   │   └── sufficiency.ts
│   │
│   ├── decision/
│   │   ├── adr-builder.ts
│   │   ├── spec-runner.ts
│   │   └── ticket-runner.ts
│   │
│   ├── execution/
│   │   ├── implementation.ts
│   │   ├── tdd.ts
│   │   ├── fanout.ts
│   │   └── fanin.ts
│   │
│   ├── validation/
│   │   ├── validator.ts
│   │   ├── reviewer.ts
│   │   └── judge.ts
│   │
│   ├── repair/
│   │   ├── root-cause.ts
│   │   └── repair-orchestrator.ts
│   │
│   ├── agents/
│   │   ├── agent-runner.ts
│   │   ├── implementation-agent.ts
│   │   ├── test-agent.ts
│   │   ├── validation-agent.ts
│   │   └── review-agent.ts
│   │
│   ├── tools/
│   │   ├── forge-discover.ts
│   │   ├── forge-evidence.ts
│   │   └── forge-state.ts
│   │
│   └── adapters/
│       ├── pi-adapter.ts
│       ├── llm-adapter.ts
│       ├── wiki-adapter.ts
│       └── codegraph-adapter.ts
│
├── skills/
│   ├── grill/
│   │   └── SKILL.md
│   ├── to-spec/
│   │   └── SKILL.md
│   ├── to-ticket/
│   │   └── SKILL.md
│   ├── implement/
│   │   └── SKILL.md
│   └── tdd/
│       └── SKILL.md
│
├── schemas/
│   ├── intent.schema.json
│   ├── grill.schema.json
│   ├── evidence.schema.json
│   ├── context.schema.json
│   ├── adr.schema.json
│   ├── spec.schema.json
│   └── ticket.schema.json
│
└── tests/
    ├── workflow/
    ├── discovery/
    ├── grill/
    ├── state-machine/
    ├── repair/
    └── integration/
```

---

# 二十六、這個架構最大的優勢

你現在實際跑出來的：

```text
Intent
 ↓
Grill
 ↓
「我建議 3-wire」
 ↓
Knowledge
 ↓
Tool path error
```

v4 會變成：

```text
User
 ↓
Intent
 ↓
LIGHT DISCOVERY
 ↓
Grill
 ↓
「存在 3-wire / 4-wire ambiguity」
 ↓
WAIT_USER
 ↓
User: 3-wire 9-bit
 ↓
DEEP KNOWLEDGE
 ↓
Evidence
 ↓
CONTEXT
 ↓
ADR
 ↓
to-spec
 ↓
to-ticket
 ↓
implement
 ↓
TDD
 ↓
Fan-out
 ↓
Validation
 ↓
Review
 ↓
Judge
```

如果最後出現：

```text
compile error
```

不是：

```text
LLM:
再試一次
```

而是：

```text
Validation
 ↓
Evidence
 ↓
Root Cause
 ↓
Implementation Error
 ↓
Repair
 ↓
Implement
 ↓
TDD
 ↓
Validation
```

如果發現：

```text
Requirement ambiguous
```

則：

```text
Root Cause
 ↓
Grill
 ↓
WAIT_USER
```

如果發現：

```text
Spec incorrect
```

則：

```text
Root Cause
 ↓
to-spec
 ↓
Ticket
 ↓
Implement
```

這才真正形成你要的 **Closed-loop Engineering Agent**。

---

# 二十七、v4 的 11 條正式 Architecture Decision

我建議你把這 11 條直接寫進正式的 ADR 文件集。

### ADR-001：Workflow Sovereignty

**Workflow 擁有 State Transition 的最終控制權，LLM 不得自行跳過 Mandatory Stage。**

---

### ADR-002：Two-Stage Knowledge Retrieval

所有工程任務採：

```text
Intent
→ Light Discovery
→ Grill
→ Deep Retrieval
```

Light Discovery 供 Grill 建立背景；Deep Retrieval 與 Knowledge Understanding 用於整理、驗證後續實作所需證據，不在這兩個階段開始實作。

---

### ADR-003：Mandatory Grill Gate

每個 Engineering Task 必須經過 Grill。

---

### ADR-004：Human Decision Boundary

Grill 可以提出 Recommendation，但：

```text
Recommendation ≠ Decision
```

任何會影響設計的 ambiguity 必須進入 `WAIT_USER`。

---

### ADR-005：Evidence-Driven Engineering

所有重大設計決策必須具有 Evidence。

```text
Evidence → Context → ADR → Spec → Code
```

---

### ADR-006：Workflow-Native Skills

以下 Skill 為 Mandatory：

```text
Grill
to-spec
to-ticket
implement
TDD
```

使用者不需要手動呼叫。

---

### ADR-007：TDD Enforcement

任何 Code implementation 都必須經過 TDD。

---

### ADR-008：Independent Review

Implementation Agent 不得擔任其自身最終 Reviewer。

---

### ADR-009：Evidence-Driven Repair

Validation / Review Fail 必須：

```text
Evidence
→ Root Cause
→ Targeted Repair
```

不得無條件 Retry。

---

### ADR-010：PI as Runtime, Forge as Workflow

Forge 不 Fork PI Core。

```text
PI = Agent Runtime

Forge = Engineering Workflow Runtime
```

PI 官方目前也維持這種「core minimal、透過 extension/skills/package 擴充」的方向。([GitHub][1])

---

### ADR-011：Grill Completion Terminal Boundary

成功 `forge_grill_complete` 使用既有 `AgentToolResult.terminate: true` 封口當前代理回合；`NEEDS_CONFIRMATION` 使用獨立 display-only custom message 進入 `WAIT_USER`，`READY_FOR_DEEP` 進入既有深度知識分流。完整決策見 `docs/adr/ADR-0011-grill-completion-terminal-boundary.md` 與 `docs/adr/ADR-0012-display-only-custom-message.md`。

---

# 最終的 v4 核心圖

如果把整個架構濃縮成一張圖，我會把它定義成：

```text
                         ┌──────────────┐
                         │     USER     │
                         └──────┬───────┘
                                ▼
                    ┌──────────────────────┐
                    │  INTENT UNDERSTAND   │
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │  LIGHT DISCOVERY     │
                    │  deterministic       │
                    └──────────┬───────────┘
                               ▼
                    ┌──────────────────────┐
                    │       GRILL          │
                    │   Mandatory Skill    │
                    └──────────┬───────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
                AMBIGUOUS               CLEAR
                    │                     │
                    ▼                     │
              ┌───────────┐              │
              │ WAIT USER │              │
              └─────┬─────┘              │
                    │                    │
                    ▼                    │
             USER CONFIRM               │
                    │                    │
                    └─────────┬──────────┘
                              ▼
                    ┌──────────────────────┐
                    │  DEEP KNOWLEDGE      │
                    │  + EVIDENCE          │
                    └──────────┬───────────┘
                               ▼
                         CONTEXT.md
                               ▼
                           ADR.md
                               ▼
                           to-spec
                               ▼
                          to-ticket
                               ▼
                          PLANNING
                               ▼
                          IMPLEMENT
                               ▼
                             TDD
                               ▼
                     ┌───────────────────┐
                     │     FAN-OUT       │
                     │                   │
                     │ Code / Test /     │
                     │ Validation / Docs │
                     └────────┬──────────┘
                              ▼
                         VALIDATION
                              ▼
                           REVIEW
                              ▼
                            JUDGE
                         ┌────┴────┐
                         ▼         ▼
                       PASS       FAIL
                         │         │
                         ▼         ▼
                     COMPLETE   ROOT CAUSE
                                   │
                                   ▼
                              REPAIR LOOP
                                   │
                         ┌─────────┼─────────┐
                         ▼         ▼         ▼
                       Grill    to-spec   Implement
                         │         │         │
                         └─────────┴─────────┘
                                   │
                                   ▼
                              VALIDATION
```

## 我會把這版定義為真正的 **Forge Runtime v4**

### 完成生命週期補充（2026-08-19）

`forge_grill_complete` 成功接受後，必須封口目前的代理回合，並依既有狀態分流：`NEEDS_CONFIRMATION` 進入 `WAIT_USER`、`READY_FOR_DEEP` 進入深度知識並穩定結束在 `KNOWLEDGE_UNDERSTANDING`。顯示抑制只能控制可見輸出，不能代替成功完成的終止邊界；display-only 是獨立的 PI core contract，負責「仍可見且可持久化、但不進 context 且不觸發 turn」。正常分流、完成遺漏復原、重試／取消／切換與穩定結束政策維持原決策。

### 最終實作同步（2026-08-20）

- Plan A 已實作完成，使用者已授權 `pi-main`；不執行 Plan B。
- `displayOnly` 為 public delivery union；streaming 不 steer/followUp、不 trigger turn，但仍 append/event/persist。`excludeFromContext` 經 provider conversion、compaction rehydrate、branch summarization rehydrate、session-file round-trip；不修改 agent harness wire。public `CustomMessage` 與 `CustomAgentMessages.custom` 維持 HEAD，marker 僅在 internal intersection。
- Forge 僅在 successful `NEEDS_CONFIRMATION` 傳 display-only WAIT_USER state message，tool result `terminate=true`；其他 state delivery 不擴張。READY 仍自動進 Deep，不要求 idle。
- 人類回答固定為 `WAIT_USER → USER_CONFIRMED → GRILL`；UI/command 先 resume、重用 `pendingReplayInvocation`，再送完整 followUp invocation；direct human input 用 `transform`，避免 nested `emitInput`。
- 已知風險：queued steer、extension API fire-and-forget lifecycle、Node `DEP0190` warning、PI `packages/ai` 六個 baseline errors；這些不改變本架構契約。

而且和之前 v3 最大的差別可以濃縮成四句話：

> **v3：Workflow 自動調用 Skill。**

> **v4：Workflow 不只自動調用 Skill，還直接控制 State、Discovery、Pause、Fan-out 與 Repair。**

> **v3：Knowledge First。**

> **v4：Two-Stage Knowledge First：Light Discovery → Grill → Deep Knowledge。**

最重要的是，這個 v4 **非常適合從乾淨的 PI 0.83.0 開始做**：不要把 Forge 做成一堆 Prompt；預設不要修改 PI core，而是把 PI 當底層 Agent Runtime，再在其上建立一個 **Forge Workflow Runtime Extension/Package**。唯一例外是使用者核准且由 ADR-0012／Plan A 限定的 display-only 最小 core 變更，其他 core 變更仍禁止。PI 本身提供 Extension、Skill、Package、SDK 等擴充點；目前官方 coding-agent package 也就是透過這些機制來保持核心精簡。([GitHub][1])

另外，PI 的官方文件目前可查到的 `coding-agent` 主線 package 版本顯示為 **0.82.1**，所以如果你手上的基線確定是 **0.83.0**，我會把「0.83.0」視為你的實際開發基線，而不是假設 GitHub 主線目前已經對應 0.83.0。([GitHub][4])

**下一步最適合直接做的不是再修改架構，而是把這份 v4 轉成一份可以交給 Coding Agent 執行的 `CONTEXT.md + ADR.md + Phase 0~N Implementation Plan`，然後從乾淨 PI 0.83.0 開始逐階段實作。**

### 2026-08-27 Deep stale-result loop 窄化 amendment

本 amendment 只處理「過期的 Deep Retrieval 完成結果已忽略。」反覆循環，其他流程與 Deep semantic contract 維持不變。初始 Deep stage panel 使用 `displayOnly`，只讓訊息可見且可持久化，不參與 agent-loop；input handler 只預載本回合 Deep tools，不提前消費 pending identity；matching user `message_start` 才消費 identity；pending 期間 Deep tool_call fail-closed。工具預載與 delivery 授權分離，避免合法 identity 到達時工具尚未註冊。

這個窄化 amendment 不改 Grill completion、WAIT_USER、cancel/retry/switch、relevance、state transition、snapshot、合法 Deep 後續、其他 Deep delivery 或 `pi-main/`。自動化已完成：正式 RED 1 fail、GREEN 1 pass、extension 117/117、PI integration 10/10、完整 `npm test` 212/212、`npm run check` exit 0。真實 PI v0.83.0 僅完成啟動 smoke check，尚未完成原始情境人工驗收。

### 2026-09-05 零候選探索性路由封版同步

- 本案修改範圍：`forge-runtime/extensions/forge-runtime.ts`、`forge-runtime/tests/extensions/forge-runtime-extension.test.ts`、`forge-runtime/tests/extensions/pi-grill-interactive.test.ts`，以及唯一衍生視圖 `forge-intent-context-flow.html`；不修改 `pi-main`、Evidence validator、state machine 或 TO_SPEC executor。
- 本案窄例外僅限空 `matches`、runtime 固定探索 opt-in marker 與既有 `isApproval` 明確肯定同時成立時，由 `WAIT_USER` 直進既有 Deep 並建立 exploratory `Spec Gap`。一般 `NEEDS_CONFIRMATION` 仍必須在使用者回答後進下一輪 Grill；有候選流程維持既有 Light→Grill→Deep，拒絕／模糊回答維持 `WAIT_USER`。

