# Workflow Configuration Design — Product Specification

> Version: 1.0 | Author: Product Team | Date: 2026-03-06
> Status: Draft

## Table of Contents

1. [Background & Motivation](#1-background--motivation)
2. [Product Goals](#2-product-goals)
3. [Core Concepts](#3-core-concepts)
4. [Workflow Data Model](#4-workflow-data-model)
5. [Node Types](#5-node-types)
6. [Workflow Editor UX](#6-workflow-editor-ux)
7. [Workflow Execution with Lobster](#7-workflow-execution-with-lobster)
8. [Human Review Node](#8-human-review-node)
9. [API Design](#9-api-design)
10. [Database Schema](#10-database-schema)
11. [File Sync Integration](#11-file-sync-integration)
12. [Frontend Components](#12-frontend-components)
13. [Permission & Role Model](#13-permission--role-model)
14. [Versioning & Lifecycle](#14-versioning--lifecycle)
15. [Observability & Monitoring](#15-observability--monitoring)
16. [Rollout Plan](#16-rollout-plan)

---

## 1. Background & Motivation

### Problem Statement

ClawConsole 当前管理的 OpenClaw Agent 执行模型是**单一 Skill 触发式**——一个 Agent 接收到消息后，根据 Skill 匹配执行单个任务。但企业场景中，许多业务流程是**多步骤、有依赖、需要人类审核**的复合任务链：

- **内容发布流水线**: AI 生成草稿 → 主管审核 → SEO 优化 Skill → 最终审批 → 发布
- **客户工单处理**: 意图分类 Skill → 自动回复 / 升级人工 → 满意度收集
- **代码部署流程**: 代码审查 Skill → 安全扫描 Skill → 技术负责人审批 → 部署 Skill
- **数据处理管道**: 数据清洗 Skill → 数据分析 Skill → 报告生成 Skill → 管理层审阅

当前的单 Skill 模型无法表达这些复合流程。我们需要引入 **Workflow（工作流）** 概念，让用户在 ClawConsole 中可视化配置多步骤流程，通过 OpenClaw 的 **Lobster 引擎**执行。

### Why Now

- Lobster workflow 引擎已在 OpenClaw 核心中实现，具备节点编排和状态管理能力
- 企业客户反复要求"可审批的自动化流程"
- 当前 Skill 审批（approve/reject）仅针对 Skill 上架本身，不覆盖运行时流程编排

---

## 2. Product Goals

| Goal | Metric | Target |
|------|--------|--------|
| **用户能在 Console 中可视化构建 Workflow** | Workflow 创建成功率 | > 90% 无需文档 |
| **Workflow 可混合编排 Skill 节点和人工审核节点** | 支持的节点类型数 | ≥ 2 类（v1） |
| **Workflow 定义可同步到 OpenClaw Lobster 引擎** | 同步成功率 | > 99% |
| **人工审核节点可暂停执行等待审批** | 审核响应延迟 P50 | < 5min |
| **Workflow 执行状态可实时观测** | 状态更新延迟 | < 2s |

### Non-Goals (v1)

- 循环节点（loop/while）——v2 考虑
- 跨机器编排（单 Workflow 仅在单台 Machine 上执行）
- Workflow 模板市场——v2 考虑
- 实时协同编辑 Workflow

---

## 3. Core Concepts

### 3.1 Concept Map

```
┌─────────────────────────────────────────────────────────────┐
│                    ClawConsole (管理面)                       │
│                                                              │
│  ┌──────────────┐    ┌──────────────────────────────────┐    │
│  │ Workflow      │    │ Workflow Editor (React Flow)     │    │
│  │ Catalog       │───▶│ - Drag & Drop 节点              │    │
│  │ (DB)          │    │ - 连线定义执行路径               │    │
│  └──────┬───────┘    │ - 配置每个节点参数               │    │
│         │            └──────────────────────────────────┘    │
│         │ generate                                           │
│         ▼                                                    │
│  ┌──────────────┐                                            │
│  │ workflow.yaml │◄── Lobster 引擎可解析的工作流定义文件     │
│  └──────┬───────┘                                            │
│         │ sync (push)                                        │
└─────────┼────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│              Remote Machine (执行面)                          │
│                                                              │
│  ~/.openclaw/                                                │
│  ├── workflows/                    ◄── NEW: 工作流目录       │
│  │   ├── content-pipeline.yaml                               │
│  │   ├── ticket-handler.yaml                                 │
│  │   └── deploy-flow.yaml                                    │
│  ├── openclaw.json                 ◄── 注册 workflow 绑定    │
│  ├── skills/                       ◄── Skill 节点引用这里    │
│  └── workspace-{id}/                                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────────┐│
│  │              Lobster Workflow Engine                      ││
│  │  - 解析 workflow.yaml                                    ││
│  │  - 按照 DAG 顺序执行节点                                 ││
│  │  - Skill 节点: 调用对应 Skill                            ││
│  │  - Review 节点: 暂停等待审批 → 通知 Console              ││
│  │  - 条件分支: 根据上一步输出决定路径                      ││
│  └──────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Glossary

| Term | Definition |
|------|-----------|
| **Workflow** | 由多个 Node（节点）和 Edge（连线）组成的有向无环图（DAG），定义一个业务流程 |
| **Node** | Workflow 中的一个执行单元，可以是 Skill 节点、人工审核节点或条件分支节点 |
| **Edge** | 两个 Node 之间的连线，定义执行顺序和数据流向 |
| **Skill Node** | 调用一个已注册的 Skill 的自动化节点 |
| **Review Node** | 暂停 Workflow 执行，等待指定审核人通过/拒绝的人工节点 |
| **Condition Node** | 根据前序节点的输出结果决定后续分支路径的节点 |
| **Workflow Run** | 一次 Workflow 的具体执行实例 |
| **Lobster** | OpenClaw 的 Workflow 引擎，负责在远程机器上解析和执行 workflow.yaml |

---

## 4. Workflow Data Model

### 4.1 Workflow Definition Structure

一个完整的 Workflow 定义包含以下层级：

```
Workflow
├── metadata (name, description, version, trigger)
├── variables (workflow 级别的变量声明)
├── nodes[]
│   ├── SkillNode
│   │   ├── skillRef (引用 skills_catalog 中的 skill)
│   │   ├── inputMapping (上游输出 → 当前输入的映射)
│   │   └── outputKey (当前输出的变量名)
│   ├── ReviewNode
│   │   ├── reviewers[] (审核人列表)
│   │   ├── policy (all | any | count)
│   │   ├── timeout (超时策略)
│   │   └── escalation (超时后升级规则)
│   └── ConditionNode
│       ├── expression (条件表达式)
│       └── branches[] (条件分支)
└── edges[]
    ├── source → target
    └── condition? (条件表达式，用于条件分支)
```

### 4.2 Workflow YAML Format (Lobster Engine)

workflow.yaml 是 ClawConsole 生成并同步到远程机器的文件，由 Lobster 引擎解析执行：

```yaml
# ~/.openclaw/workflows/content-pipeline.yaml
apiVersion: lobster/v1
kind: Workflow
metadata:
  name: content-pipeline
  description: "AI 内容生成与审核发布流水线"
  version: "1.0.0"

trigger:
  type: message          # message | schedule | webhook | manual
  channel: feishu        # 触发来源频道
  pattern: "/publish *"  # 消息匹配模式

variables:
  topic: "{{ trigger.message }}"  # 从触发消息中提取
  quality_threshold: 0.8

nodes:
  - id: draft
    type: skill
    name: "生成草稿"
    skillRef: content-writer
    input:
      topic: "{{ variables.topic }}"
      style: "professional"
    output: draft_result

  - id: seo_optimize
    type: skill
    name: "SEO 优化"
    skillRef: seo-optimizer
    input:
      content: "{{ nodes.draft.output.content }}"
      keywords: "{{ nodes.draft.output.suggested_keywords }}"
    output: seo_result

  - id: manager_review
    type: review
    name: "主管审核"
    reviewers:
      - role: content_manager
    policy: any             # any: 任一审核人通过即可
    timeout: 2h
    escalation:
      action: notify        # notify | auto_approve | abort
      target:
        - role: admin
    payload:
      title: "内容审核: {{ variables.topic }}"
      content: "{{ nodes.seo_optimize.output.content }}"
      diff_from: "{{ nodes.draft.output.content }}"

  - id: quality_gate
    type: condition
    name: "质量检查"
    expression: "{{ nodes.seo_optimize.output.score >= variables.quality_threshold }}"
    branches:
      - condition: "true"
        target: publish
      - condition: "false"
        target: revision_needed

  - id: revision_needed
    type: skill
    name: "内容修订"
    skillRef: content-reviser
    input:
      content: "{{ nodes.seo_optimize.output.content }}"
      feedback: "{{ nodes.manager_review.output.comments }}"
    output: revision_result

  - id: publish
    type: skill
    name: "发布内容"
    skillRef: content-publisher
    input:
      content: "{{ nodes.seo_optimize.output.content }}"
      platform: "all"
    output: publish_result

edges:
  - source: draft
    target: seo_optimize

  - source: seo_optimize
    target: manager_review

  - source: manager_review
    target: quality_gate
    condition: "{{ edge.review_decision == 'approved' }}"

  - source: manager_review
    target: revision_needed
    condition: "{{ edge.review_decision == 'rejected' }}"

  - source: quality_gate
    target: publish     # via branches defined in condition node

  - source: revision_needed
    target: manager_review  # 修订后再次审核
```

### 4.3 Data Flow Between Nodes

节点之间通过 `output` → `input` 映射传递数据：

```
┌──────────┐  draft_result    ┌──────────────┐  seo_result    ┌───────────────┐
│  Draft    │────────────────▶│  SEO Optimize │───────────────▶│ Manager Review│
│  (Skill)  │  { content,     │  (Skill)      │  { content,    │ (Review)      │
│           │    keywords }   │               │    score }     │               │
└──────────┘                  └──────────────┘                 └───────┬───────┘
                                                                       │
                                                          approved / rejected
                                                                       │
                                                    ┌──────────────────┼──────┐
                                                    ▼                         ▼
                                           ┌──────────────┐         ┌─────────────┐
                                           │  Publish      │         │  Revision    │
                                           │  (Skill)      │         │  (Skill)     │
                                           └──────────────┘         └─────────────┘
```

---

## 5. Node Types

### 5.1 Skill Node

自动化执行节点，引用 Skills Catalog 中已审批通过的 Skill。

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | Y | 节点唯一标识 |
| `type` | `"skill"` | Y | 固定值 |
| `name` | string | Y | 节点显示名称 |
| `skillRef` | string | Y | 引用的 skill_key，必须是 `review_status=approved` 的 Skill |
| `input` | object | N | 输入参数映射，支持 `{{ }}` 模板表达式引用上游输出 |
| `output` | string | Y | 输出变量名，存储该节点的执行结果 |
| `timeout` | duration | N | 执行超时时间，默认 5m |
| `retryPolicy` | object | N | 失败重试策略 `{ maxRetries, backoff }` |
| `onError` | enum | N | 错误处理: `abort` (默认), `skip`, `fallback` |

**Constraints:**
- `skillRef` 必须引用已 approved 的 Skill
- Skill 所依赖的 `requiresBins` 和 `requiresEnv` 必须在目标 Machine 上可用
- 一个 Workflow 中可以多次引用同一个 Skill（不同参数）

### 5.2 Review Node (人工审核节点)

暂停 Workflow 执行，发送审核请求，等待人工决策。

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | Y | 节点唯一标识 |
| `type` | `"review"` | Y | 固定值 |
| `name` | string | Y | 节点显示名称 |
| `reviewers` | ReviewerRef[] | Y | 审核人，支持按 `userId` 或 `role` 指定 |
| `policy` | enum | Y | 审批策略: `any` / `all` / `count(N)` |
| `timeout` | duration | N | 等待超时，默认无限制 |
| `escalation` | object | N | 超时升级策略 |
| `payload` | object | N | 展示给审核人的内容，支持模板表达式 |

**审批策略 (Policy):**

| Policy | Behavior |
|--------|----------|
| `any` | 任意一个审核人通过即可继续 |
| `all` | 所有审核人都必须通过 |
| `count(N)` | 至少 N 个审核人通过 |

**超时升级 (Escalation):**

```yaml
escalation:
  action: notify      # notify | auto_approve | auto_reject | abort
  target:
    - role: admin     # 通知/升级的目标
  message: "审核超时，请尽快处理"
```

**Review Node 输出:**

```typescript
interface ReviewOutput {
  decision: 'approved' | 'rejected';
  reviewedBy: string[];           // 审核人列表
  comments: string | null;        // 审核意见
  reviewedAt: string;             // ISO timestamp
  metadata: Record<string, any>;  // 自定义元数据
}
```

### 5.3 Condition Node (条件分支节点)

根据表达式结果决定后续执行路径。

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `id` | string | Y | 节点唯一标识 |
| `type` | `"condition"` | Y | 固定值 |
| `name` | string | Y | 节点显示名称 |
| `expression` | string | Y | 条件表达式，支持 `{{ }}` 模板 |
| `branches` | Branch[] | Y | 分支定义 `{ condition, target }` |
| `default` | string | N | 无匹配时的默认目标节点 |

**Expression 支持:**
- 比较: `==`, `!=`, `>`, `<`, `>=`, `<=`
- 逻辑: `&&`, `||`, `!`
- 空值检查: `{{ value != null }}`
- 字符串包含: `{{ value contains "keyword" }}`

---

## 6. Workflow Editor UX

### 6.1 Editor Layout

基于 React Flow 构建可视化 Workflow 编辑器：

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◀ Workflows / content-pipeline                        [Save] [Deploy]│
├──────────┬───────────────────────────────────────────────┬───────────┤
│          │                                               │           │
│ Node     │            Canvas (React Flow)                │  Node     │
│ Palette  │                                               │  Config   │
│          │    ┌─────┐      ┌─────┐      ┌─────┐        │  Panel    │
│ ┌──────┐ │    │Draft│─────▶│ SEO │─────▶│Review│        │           │
│ │⚡Skill│ │    │     │      │     │      │     │        │  ┌──────┐ │
│ └──────┘ │    └─────┘      └─────┘      └──┬──┘        │  │Name  │ │
│ ┌──────┐ │                                  │           │  │      │ │
│ │👤Review│ │                          ┌──────┴──────┐    │  │Skill │ │
│ └──────┘ │                          ▼              ▼    │  │Ref   │ │
│ ┌──────┐ │                   ┌──────────┐  ┌────────┐  │  │      │ │
│ │🔀Branch│ │                   │ Publish  │  │Revision│  │  │Input │ │
│ └──────┘ │                   └──────────┘  └────────┘  │  │Map   │ │
│          │                                              │  └──────┘ │
│          │                                              │           │
├──────────┴───────────────────────────────────────────────┴───────────┤
│ Execution Log  │  Variables  │  Validation                          │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 User Journey

**创建 Workflow:**

```
1. 用户进入 Workflows 页面
2. 点击 "New Workflow" → 输入名称、描述
3. 选择目标 Agent（决定可用的 Skills）
4. 进入 Workflow Editor
5. 从左侧 Node Palette 拖拽节点到 Canvas
6. 点击节点，在右侧 Config Panel 配置参数
7. 拖拽连线定义执行顺序
8. 配置 Trigger（消息触发/定时/手动）
9. 点击 Validate 检查合法性
10. 点击 Save 保存到数据库
11. 点击 Deploy 同步到远程机器
```

**审核 Workflow Run:**

```
1. Lobster 引擎执行到 Review Node → 暂停
2. Lobster 通过 webhook/file 通知 ClawConsole
3. ClawConsole 生成审核通知（站内 + 外部频道）
4. 审核人在 Console 中看到待审核列表
5. 审核人查看上下文信息（前序节点输出、payload）
6. 审核人做出决策: Approve / Reject + 评论
7. ClawConsole 将决策同步回 Lobster
8. Lobster 继续执行后续节点
```

### 6.3 Node Visual Design

| Node Type | Color | Icon | Shape |
|-----------|-------|------|-------|
| Skill | Blue (#3B82F6) | ⚡ Lightning | Rounded rectangle |
| Review | Amber (#F59E0B) | 👤 Person | Rounded rectangle with pause indicator |
| Condition | Purple (#8B5CF6) | 🔀 Diamond | Diamond shape |
| Start | Green (#10B981) | ▶ Play | Circle |
| End | Gray (#6B7280) | ⏹ Stop | Circle |

---

## 7. Workflow Execution with Lobster

### 7.1 Execution Model

```
ClawConsole                          Remote Machine (Lobster)
    │                                       │
    │   1. Deploy workflow.yaml             │
    │──────────────────────────────────────▶│
    │                                       │
    │   2. Trigger event (message/cron)     │
    │                                       │◀── User/System
    │                                       │
    │   3. Lobster creates Workflow Run     │
    │      and begins executing DAG         │
    │                                       │
    │   4. Execute Skill Node               │
    │                                       │──▶ Skill execution
    │                                       │◀── Skill result
    │                                       │
    │   5. Hit Review Node → Pause          │
    │◀──────────────────────────────────────│ (via webhook / review-pending file)
    │                                       │
    │   6. Notify reviewers                 │
    │──▶ Console UI / Feishu / Slack        │
    │                                       │
    │   7. Reviewer submits decision        │
    │──────────────────────────────────────▶│ (via API → review-response file)
    │                                       │
    │   8. Lobster resumes execution        │
    │                                       │──▶ Next node
    │                                       │
    │   9. Workflow completes               │
    │◀──────────────────────────────────────│ (run status update)
    │                                       │
```

### 7.2 Lobster Communication Protocol

ClawConsole 与 Lobster 引擎通过**文件系统**通信（保持 OpenClaw 的 file-driven 哲学）：

```
~/.openclaw/
├── workflows/                           # Workflow 定义 (Console → Lobster)
│   ├── content-pipeline.yaml
│   └── ticket-handler.yaml
│
├── workflow-runs/                       # Workflow 执行状态 (Lobster → Console)
│   └── {run-id}/
│       ├── status.json                  # 整体运行状态
│       ├── nodes/
│       │   ├── draft.output.json        # 各节点输出
│       │   ├── seo_optimize.output.json
│       │   └── manager_review.pending.json  # Review 等待中
│       └── logs/
│           └── execution.log            # 执行日志
│
├── workflow-reviews/                    # 审核交互 (双向)
│   └── {run-id}/
│       ├── {node-id}.request.json       # Lobster 写入: 审核请求
│       └── {node-id}.response.json      # Console 写入: 审核决策
```

**File Classification 补充:**

| Path Pattern | Category | Direction |
|-------------|----------|-----------|
| `workflows/*.yaml` | Console-Managed (A) | Push |
| `workflow-runs/**` | Runtime-Observable (B) | Pull |
| `workflow-reviews/*.request.json` | Runtime-Observable (B) | Pull |
| `workflow-reviews/*.response.json` | Console-Managed (A) | Push |

### 7.3 Status File Format

```json
// ~/.openclaw/workflow-runs/{run-id}/status.json
{
  "runId": "run_abc123",
  "workflowName": "content-pipeline",
  "workflowVersion": "1.0.0",
  "status": "paused",           // pending | running | paused | completed | failed | aborted
  "trigger": {
    "type": "message",
    "channel": "feishu",
    "messageId": "msg_xyz",
    "timestamp": "2026-03-06T10:30:00Z"
  },
  "currentNodes": ["manager_review"],
  "completedNodes": ["draft", "seo_optimize"],
  "failedNodes": [],
  "startedAt": "2026-03-06T10:30:00Z",
  "updatedAt": "2026-03-06T10:31:15Z",
  "variables": {
    "topic": "Q1 Marketing Report"
  }
}
```

### 7.4 Review Request File Format

```json
// ~/.openclaw/workflow-reviews/{run-id}/{node-id}.request.json
{
  "runId": "run_abc123",
  "nodeId": "manager_review",
  "nodeName": "主管审核",
  "requestedAt": "2026-03-06T10:31:15Z",
  "timeout": "2h",
  "reviewers": [
    { "role": "content_manager" }
  ],
  "policy": "any",
  "payload": {
    "title": "内容审核: Q1 Marketing Report",
    "content": "... generated content ...",
    "diff_from": "... original draft ..."
  }
}
```

---

## 8. Human Review Node

### 8.1 Review Lifecycle

```
                    ┌──────────────┐
                    │  Review Node │
                    │  Triggered   │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
               ┌────│   Pending    │────┐
               │    └──────┬───────┘    │
               │           │            │
         timeout           │            │
               │    ┌──────▼───────┐    │
               │    │  In Review   │    │
               │    │ (审核人打开)  │    │
               │    └──────┬───────┘    │
               │           │            │
               │    ┌──────┴──────┐     │
               │    ▼             ▼     │
        ┌──────▼───────┐ ┌───────────┐  │
        │  Escalated   │ │ Approved  │  │
        │ (超时升级)    │ │           │  │
        └──────────────┘ └───────────┘  │
                                        │
                                 ┌──────▼───────┐
                                 │  Rejected    │
                                 └──────────────┘
```

### 8.2 Notification Strategy

| Channel | Mechanism | Priority |
|---------|-----------|----------|
| Console 站内通知 | WebSocket push → Bell icon | Default |
| Feishu/Lark | OpenClaw 消息通道回发 | 如果 trigger 来自 Feishu |
| Slack | Webhook integration | 可选配置 |
| Email | SMTP | 可选配置 |

### 8.3 Review UI

审核人在 ClawConsole 中的审核界面：

```
┌──────────────────────────────────────────────────────────────┐
│ 🔔 Pending Reviews (3)                                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ 📋 内容审核: Q1 Marketing Report                          │ │
│ │ Workflow: content-pipeline  │  Node: 主管审核             │ │
│ │ Requested: 2 minutes ago   │  Timeout: 1h 58m remaining  │ │
│ ├──────────────────────────────────────────────────────────┤ │
│ │                                                          │ │
│ │ ┌─ Context ───────────────────────────────────────────┐  │ │
│ │ │ Previous nodes:                                      │  │ │
│ │ │   ✅ 生成草稿 (content-writer) — completed 1m ago    │  │ │
│ │ │   ✅ SEO 优化 (seo-optimizer) — completed 30s ago    │  │ │
│ │ │      SEO Score: 0.85                                 │  │ │
│ │ └─────────────────────────────────────────────────────┘  │ │
│ │                                                          │ │
│ │ ┌─ Content to Review ─────────────────────────────────┐  │ │
│ │ │                                                      │  │ │
│ │ │  [Markdown rendered content with diff highlights]    │  │ │
│ │ │                                                      │  │ │
│ │ └─────────────────────────────────────────────────────┘  │ │
│ │                                                          │ │
│ │ ┌─ Decision ──────────────────────────────────────────┐  │ │
│ │ │ Comments: [________________________]                 │  │ │
│ │ │                                                      │  │ │
│ │ │          [❌ Reject]          [✅ Approve]            │  │ │
│ │ └─────────────────────────────────────────────────────┘  │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. API Design

### 9.1 Workflow CRUD

```
POST   /api/workflows                    # 创建 Workflow
GET    /api/workflows                    # 列表（支持筛选）
GET    /api/workflows/:workflowId        # 获取详情
PUT    /api/workflows/:workflowId        # 更新定义
DELETE /api/workflows/:workflowId        # 删除
POST   /api/workflows/:workflowId/validate   # 校验 DAG 合法性
POST   /api/workflows/:workflowId/deploy     # 同步到远程机器
```

### 9.2 Workflow Runs

```
GET    /api/workflows/:workflowId/runs           # 列出执行记录
GET    /api/workflow-runs/:runId                  # 获取执行详情
POST   /api/workflow-runs/:runId/abort            # 中止执行
GET    /api/workflow-runs/:runId/nodes/:nodeId    # 获取节点输出
```

### 9.3 Review

```
GET    /api/reviews/pending                       # 当前用户待审核列表
GET    /api/reviews/:runId/:nodeId                # 获取审核详情
POST   /api/reviews/:runId/:nodeId/decide         # 提交审核决策
```

### 9.4 Key Request/Response Examples

**创建 Workflow:**
```json
POST /api/workflows
{
  "name": "content-pipeline",
  "description": "AI 内容生成与审核发布流水线",
  "agentId": "agent_pm",
  "machineId": "machine_01",
  "trigger": {
    "type": "message",
    "channel": "feishu",
    "pattern": "/publish *"
  },
  "nodes": [ /* ... node definitions ... */ ],
  "edges": [ /* ... edge definitions ... */ ]
}

Response 201:
{
  "id": "wf_abc123",
  "name": "content-pipeline",
  "status": "draft",          // draft | active | disabled | archived
  "version": "1.0.0",
  "createdAt": "2026-03-06T10:00:00Z"
}
```

**提交审核决策:**
```json
POST /api/reviews/run_abc123/manager_review/decide
{
  "decision": "approved",
  "comments": "内容质量达标，可以发布",
  "reviewedBy": "user_zhangsan"
}

Response 200:
{
  "success": true,
  "workflowRun": {
    "runId": "run_abc123",
    "status": "running",       // 恢复执行
    "resumedNode": "quality_gate"
  }
}
```

### 9.5 Validate Endpoint

Validate 接口在保存和部署前检查 Workflow 的合法性：

```json
POST /api/workflows/wf_abc123/validate

Response 200:
{
  "valid": false,
  "errors": [
    {
      "type": "ORPHAN_NODE",
      "nodeId": "unused_skill",
      "message": "Node 'unused_skill' is not connected to any edge"
    },
    {
      "type": "CYCLE_DETECTED",
      "path": ["review → revision → review"],
      "message": "Circular dependency detected (use max_iterations to allow loops)"
    },
    {
      "type": "MISSING_SKILL",
      "nodeId": "seo_optimize",
      "skillRef": "seo-optimizer",
      "message": "Referenced skill 'seo-optimizer' not found or not approved"
    }
  ],
  "warnings": [
    {
      "type": "NO_TIMEOUT",
      "nodeId": "manager_review",
      "message": "Review node has no timeout configured"
    }
  ]
}
```

---

## 10. Database Schema

### 10.1 New Tables

```sql
-- Workflow 定义表
CREATE TABLE workflows (
  id            VARCHAR(36) PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  machine_id    VARCHAR(36) NOT NULL,
  agent_id      VARCHAR(255),             -- NULL = machine-level workflow
  status        ENUM('draft', 'active', 'disabled', 'archived') DEFAULT 'draft',
  version       VARCHAR(50) DEFAULT '1.0.0',
  trigger_config JSON NOT NULL,            -- { type, channel, pattern, cron }
  nodes_json    JSON NOT NULL,             -- 完整的节点定义数组
  edges_json    JSON NOT NULL,             -- 完整的边定义数组
  variables_json JSON,                     -- workflow 级变量
  canvas_state  JSON,                      -- React Flow canvas 位置/缩放状态
  created_by    VARCHAR(255) NOT NULL,
  updated_by    VARCHAR(255),
  deployed_at   DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (machine_id) REFERENCES machines(id),
  INDEX idx_status (status),
  INDEX idx_machine (machine_id),
  INDEX idx_agent (agent_id)
);

-- Workflow 版本快照
CREATE TABLE workflow_versions (
  id            VARCHAR(36) PRIMARY KEY,
  workflow_id   VARCHAR(36) NOT NULL,
  version       VARCHAR(50) NOT NULL,
  snapshot_json JSON NOT NULL,             -- 完整 workflow 定义快照
  change_log    TEXT,
  created_by    VARCHAR(255) NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (workflow_id) REFERENCES workflows(id),
  UNIQUE INDEX idx_workflow_version (workflow_id, version)
);

-- Workflow 执行记录（从远程机器拉取同步）
CREATE TABLE workflow_runs (
  id            VARCHAR(36) PRIMARY KEY,
  workflow_id   VARCHAR(36) NOT NULL,
  run_id        VARCHAR(255) NOT NULL,     -- Lobster 生成的 run ID
  machine_id    VARCHAR(36) NOT NULL,
  status        ENUM('pending', 'running', 'paused', 'completed', 'failed', 'aborted')
                DEFAULT 'pending',
  trigger_info  JSON,                      -- 触发信息
  current_nodes JSON,                      -- 当前执行到的节点
  variables     JSON,                      -- 运行时变量值
  started_at    DATETIME,
  completed_at  DATETIME,
  error_message TEXT,
  synced_at     DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (workflow_id) REFERENCES workflows(id),
  FOREIGN KEY (machine_id) REFERENCES machines(id),
  UNIQUE INDEX idx_run_id (run_id),
  INDEX idx_status (status),
  INDEX idx_workflow (workflow_id)
);

-- Workflow 节点执行输出（从远程机器拉取同步）
CREATE TABLE workflow_run_nodes (
  id            VARCHAR(36) PRIMARY KEY,
  run_id        VARCHAR(36) NOT NULL,      -- FK → workflow_runs.id
  node_id       VARCHAR(255) NOT NULL,
  node_type     ENUM('skill', 'review', 'condition') NOT NULL,
  status        ENUM('pending', 'running', 'completed', 'failed', 'skipped', 'waiting_review')
                DEFAULT 'pending',
  input_json    JSON,
  output_json   JSON,
  started_at    DATETIME,
  completed_at  DATETIME,
  error_message TEXT,

  FOREIGN KEY (run_id) REFERENCES workflow_runs(id),
  UNIQUE INDEX idx_run_node (run_id, node_id)
);

-- 审核记录
CREATE TABLE workflow_reviews (
  id            VARCHAR(36) PRIMARY KEY,
  run_id        VARCHAR(36) NOT NULL,
  node_id       VARCHAR(255) NOT NULL,
  status        ENUM('pending', 'approved', 'rejected', 'escalated', 'expired')
                DEFAULT 'pending',
  reviewers     JSON NOT NULL,             -- 指定的审核人列表
  policy        VARCHAR(50) NOT NULL,      -- any | all | count(N)
  payload       JSON,                      -- 展示给审核人的内容
  timeout_at    DATETIME,
  decision      ENUM('approved', 'rejected'),
  decided_by    VARCHAR(255),
  comments      TEXT,
  decided_at    DATETIME,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (run_id) REFERENCES workflow_runs(id),
  UNIQUE INDEX idx_run_node_review (run_id, node_id),
  INDEX idx_status (status),
  INDEX idx_decided_by (decided_by)
);
```

### 10.2 Entity Relationship

```
workflows (1) ──── (N) workflow_versions
workflows (1) ──── (N) workflow_runs
workflow_runs (1) ──── (N) workflow_run_nodes
workflow_runs (1) ──── (N) workflow_reviews
workflows (N) ──── (1) machines
workflows (N) ──── (1) agents (optional)
```

---

## 11. File Sync Integration

### 11.1 New File Patterns

在 File Classification System 中新增以下规则：

```typescript
// Category A: Console-Managed (Push)
const WORKFLOW_PUSH_PATTERNS = [
  'workflows/*.yaml',                    // Workflow 定义文件
  'workflow-reviews/*/*.response.json',  // 审核决策响应
];

// Category B: Runtime-Observable (Pull)
const WORKFLOW_PULL_PATTERNS = [
  'workflow-runs/**/status.json',        // 执行状态
  'workflow-runs/**/nodes/*.output.json', // 节点输出
  'workflow-runs/**/logs/*',             // 执行日志
  'workflow-reviews/*/*.request.json',   // 审核请求
];
```

### 11.2 Generator: Workflow YAML

新增 `workflow-files.generator.ts`，将数据库中的 Workflow 定义转换为 Lobster 可解析的 YAML 文件：

```typescript
// generators/workflow-files.generator.ts
interface WorkflowGeneratorInput {
  workflow: WorkflowRecord;       // DB record
  skills: SkillCatalogEntry[];    // Referenced skills
}

function generateWorkflowYaml(input: WorkflowGeneratorInput): string {
  // 1. Convert DB JSON to Lobster YAML format
  // 2. Resolve skill references
  // 3. Validate template expressions
  // 4. Output YAML string
}
```

### 11.3 Sync Mode Impact

| Changed File | Sync Mode |
|-------------|-----------|
| `workflows/*.yaml` | **Warm** (需要 Lobster 重新加载) |
| `workflow-reviews/*.response.json` | **Hot** (Lobster 实时监听) |

### 11.4 Deploy Flow

```
用户点击 Deploy
    │
    ▼
validate Workflow (DAG check)
    │
    ▼
generateWorkflowYaml()
    │
    ▼
Pull-Before-Push Protocol
    │
    ▼
Push workflow.yaml to remote
    │
    ▼
Update openclaw.json (register workflow binding)
    │
    ▼
Warm sync (restart gateway for Lobster reload)
    │
    ▼
Verify deployment
    │
    ▼
Update workflow.status = 'active', workflow.deployed_at
```

---

## 12. Frontend Components

### 12.1 New Pages

| Route | Component | Description |
|-------|-----------|-------------|
| `/workflows` | `WorkflowListPage` | Workflow 列表，支持状态筛选/搜索 |
| `/workflows/new` | `WorkflowEditorPage` | 创建新 Workflow |
| `/workflows/:id` | `WorkflowEditorPage` | 编辑已有 Workflow |
| `/workflows/:id/runs` | `WorkflowRunsPage` | 执行记录列表 |
| `/workflows/:id/runs/:runId` | `WorkflowRunDetailPage` | 执行详情（DAG 可视化） |
| `/reviews` | `ReviewInboxPage` | 审核收件箱 |

### 12.2 New Components

```
frontend/src/
├── pages/
│   ├── WorkflowListPage.tsx
│   ├── WorkflowEditorPage.tsx
│   ├── WorkflowRunsPage.tsx
│   ├── WorkflowRunDetailPage.tsx
│   └── ReviewInboxPage.tsx
│
├── components/
│   └── workflow/
│       ├── WorkflowCanvas.tsx          # React Flow 画布封装
│       ├── NodePalette.tsx             # 左侧节点拖拽面板
│       ├── NodeConfigPanel.tsx         # 右侧节点配置面板
│       ├── SkillNodeConfig.tsx         # Skill 节点配置
│       ├── ReviewNodeConfig.tsx        # Review 节点配置
│       ├── ConditionNodeConfig.tsx     # Condition 节点配置
│       ├── SkillNode.tsx               # 自定义 React Flow Skill 节点
│       ├── ReviewNode.tsx              # 自定义 React Flow Review 节点
│       ├── ConditionNode.tsx           # 自定义 React Flow Condition 节点
│       ├── WorkflowToolbar.tsx         # 画布工具栏 (zoom, fit, undo/redo)
│       ├── WorkflowValidation.tsx      # 校验结果展示
│       ├── VariableEditor.tsx          # 变量编辑器
│       ├── TemplateExprInput.tsx       # {{ }} 模板表达式输入组件
│       ├── RunTimeline.tsx             # 执行时间线（节点状态可视化）
│       ├── ReviewCard.tsx              # 审核卡片
│       └── ReviewDecisionForm.tsx      # 审核决策表单
│
├── stores/
│   └── workflowStore.ts               # Zustand store for workflow editor
│
└── hooks/
    ├── useWorkflow.ts                 # Workflow CRUD hooks
    ├── useWorkflowRuns.ts             # 执行记录 hooks
    └── useReviews.ts                  # 审核相关 hooks
```

### 12.3 Dependencies

```json
{
  "@xyflow/react": "^12.x",    // React Flow for DAG editor
  "yaml": "^2.x",              // YAML serialization (preview)
  "elkjs": "^0.9.x"            // Auto-layout algorithm for DAG
}
```

---

## 13. Permission & Role Model

### 13.1 Workflow Permissions

| Permission | Description | Default Roles |
|-----------|-------------|---------------|
| `workflow:create` | 创建新 Workflow | admin, editor |
| `workflow:edit` | 编辑 Workflow 定义 | admin, editor |
| `workflow:deploy` | 部署 Workflow 到远程机器 | admin |
| `workflow:delete` | 删除 Workflow | admin |
| `workflow:view` | 查看 Workflow 定义和执行记录 | admin, editor, viewer |
| `workflow:run:abort` | 中止运行中的 Workflow | admin |
| `review:decide` | 提交审核决策 | admin, reviewer |
| `review:view` | 查看审核详情 | admin, reviewer, viewer |

### 13.2 Review Role Assignment

Review Node 中的 `reviewers` 可以通过以下方式指定：

```yaml
reviewers:
  - userId: "user_zhangsan"           # 指定用户
  - role: "content_manager"           # 指定角色（所有该角色用户可审核）
  - group: "marketing_team"           # 指定用户组
```

---

## 14. Versioning & Lifecycle

### 14.1 Workflow Lifecycle

```
     ┌─────┐    save     ┌────────┐   deploy   ┌────────┐
     │ NEW │────────────▶│ DRAFT  │───────────▶│ ACTIVE │
     └─────┘             └────┬───┘            └────┬───┘
                              │                     │
                              │ edit                │ disable
                              │                     ▼
                              │              ┌──────────┐
                              └──────────────│ DISABLED  │
                                             └─────┬────┘
                                                   │ archive
                                                   ▼
                                             ┌──────────┐
                                             │ ARCHIVED  │
                                             └──────────┘
```

### 14.2 Version Management

- 每次 **Deploy** 自动创建版本快照 (`workflow_versions`)
- 版本号自动递增: `1.0.0` → `1.0.1` → `1.1.0` (用户可手动调整)
- 支持回滚到历史版本
- 运行中的 Workflow Run 使用部署时的版本，不受后续编辑影响

---

## 15. Observability & Monitoring

### 15.1 Dashboard Metrics

| Metric | Source | Update Frequency |
|--------|--------|-----------------|
| Active Workflows count | DB `workflows` | Real-time |
| Running / Paused Runs | DB `workflow_runs` + remote sync | Every 30s |
| Pending Reviews | DB `workflow_reviews` | Real-time (WebSocket) |
| Avg. review response time | DB `workflow_reviews` | Aggregated hourly |
| Node success / failure rate | DB `workflow_run_nodes` | Aggregated hourly |
| Workflow completion rate | DB `workflow_runs` | Aggregated daily |

### 15.2 Background Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| `workflow-run-sync` | Every 30s | Pull `workflow-runs/` status from remote machines |
| `review-request-sync` | Every 15s | Pull `workflow-reviews/*.request.json` for new review requests |
| `review-timeout-check` | Every 60s | Check for expired reviews, trigger escalation |
| `workflow-run-cleanup` | Daily | Archive completed runs older than 30 days |

---

## 16. Rollout Plan

### Phase 1: Foundation (Week 1-3)

- [ ] Database migration: 创建 4 张新表
- [ ] Backend: Workflow CRUD API + Validate endpoint
- [ ] Backend: Workflow YAML generator
- [ ] Backend: File classification 规则更新
- [ ] Frontend: WorkflowListPage (列表 CRUD)

### Phase 2: Visual Editor (Week 4-6)

- [ ] Frontend: React Flow 画布集成
- [ ] Frontend: 3 种 Node 类型的自定义渲染
- [ ] Frontend: Node Palette + Config Panel
- [ ] Frontend: Edge 连线和条件配置
- [ ] Frontend: DAG 验证和错误提示
- [ ] Frontend: Canvas 状态持久化

### Phase 3: Deploy & Execution (Week 7-9)

- [ ] Backend: Deploy flow (generate YAML + sync + openclaw.json update)
- [ ] Backend: Workflow Run sync job (pull run status)
- [ ] Frontend: WorkflowRunsPage + RunDetailPage
- [ ] Frontend: 执行状态 DAG 可视化（节点高亮进度）
- [ ] Integration test: 端到端 deploy → trigger → execute → complete

### Phase 4: Human Review (Week 10-12)

- [ ] Backend: Review request sync job
- [ ] Backend: Review decision API + response file push
- [ ] Backend: Timeout & escalation logic
- [ ] Frontend: ReviewInboxPage
- [ ] Frontend: ReviewCard + ReviewDecisionForm
- [ ] Frontend: 通知系统集成 (WebSocket + 外部通道)
- [ ] E2E test: 完整审核流程

### Phase 5: Polish & GA (Week 13-14)

- [ ] Workflow versioning and rollback
- [ ] Permission enforcement
- [ ] Dashboard metrics integration
- [ ] Documentation and user guide
- [ ] Performance optimization (large DAG rendering)
- [ ] GA release

---

## Appendix A: openclaw.json Workflow Binding

在 `openclaw.json` 中注册 Workflow 与 Agent/Channel 的绑定关系：

```json5
{
  "workflows": {
    "enabled": true,
    "definitions": [
      {
        "name": "content-pipeline",
        "file": "workflows/content-pipeline.yaml",
        "agent": "pm",
        "status": "active"
      },
      {
        "name": "ticket-handler",
        "file": "workflows/ticket-handler.yaml",
        "agent": "support",
        "status": "active"
      }
    ]
  }
}
```

## Appendix B: Template Expression Syntax

Workflow 中的模板表达式使用 `{{ }}` 语法：

| Expression | Description | Example |
|-----------|-------------|---------|
| `{{ trigger.message }}` | 触发消息内容 | "请发布 Q1 报告" |
| `{{ variables.xxx }}` | Workflow 变量 | `{{ variables.topic }}` |
| `{{ nodes.{id}.output.xxx }}` | 节点输出引用 | `{{ nodes.draft.output.content }}` |
| `{{ edge.review_decision }}` | Review 节点决策 | "approved" / "rejected" |
| `{{ env.xxx }}` | 环境变量 | `{{ env.API_KEY }}` |

## Appendix C: Error Handling Matrix

| Scenario | Node Behavior | Workflow Behavior | User Action |
|----------|--------------|-------------------|-------------|
| Skill execution timeout | Node → `failed` | Depends on `onError` | Retry / Skip / Abort |
| Skill not found (uninstalled) | Node → `failed` | Workflow → `failed` | Reinstall skill, redeploy |
| Review timeout (no escalation) | Node → `expired` | Workflow → `failed` | Manual restart |
| Review timeout (with escalation) | Escalation triggered | Workflow stays `paused` | Escalated reviewer decides |
| Machine offline during run | Run stalls | Detected via health check | Wait for machine recovery |
| Workflow YAML sync failure | — | Deploy → `failed` | Retry deploy |
| Condition expression error | Node → `failed` | Workflow → `failed` | Fix expression, redeploy |
