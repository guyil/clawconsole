# EvoClaw (ECA) — 自进化模块使用指南

> Version: 1.0 | Last Updated: 2026-03-28

## 目录

1. [什么是 EvoClaw](#1-什么是-evoclaw)
2. [核心原理](#2-核心原理)
3. [触发方式](#3-触发方式)
4. [进化流水线](#4-进化流水线)
5. [输出产物](#5-输出产物)
6. [进化控制机制](#6-进化控制机制)
7. [前端管理界面](#7-前端管理界面)
8. [配置参数](#8-配置参数)
9. [REST API](#9-rest-api)
10. [常见问题](#10-常见问题)

---

## 1. 什么是 EvoClaw

EvoClaw（全称 evoClawAssociation，简称 ECA）是 ClawConsole 的自进化模块。它通过分析 Bot 的历史对话记录，自动提取用户反馈信号，将其蒸馏为行为规则和案例，写回 Bot 的配置文件中，实现 **prompt 级别的强化学习闭环**。

### 与传统 RL 微调的区别

| 特性 | 权重级 RL（如 OpenClaw-RL） | EvoClaw（Prompt 级） |
|------|---------------------------|---------------------|
| 学习载体 | 模型权重 | Markdown 配置文件 |
| 硬件需求 | GPU 集群 | 零额外硬件 |
| 生效速度 | 训练完成后部署 | 即时写入、下次推理生效 |
| 可解释性 | 黑盒 | 每条规则人类可读可编辑 |
| 底座要求 | 需要可微调的模型 | 任何模型，包括 API 模型 |
| 能学到的 | 显性+隐性知识 | 显性知识（规则、流程、偏好） |

### 适合学习的内容

- 领域知识规范（如法律条款引用惯例）
- 行为约束（如不给出绝对数字，给出范围）
- 工作流程（如先查询惯例再给建议）
- 输出格式偏好（如优先引用法规原文）
- 工具使用规则（如何时调用搜索、何时直接回答）

### 不适合学习的内容

- 语言风格的微妙调整
- 推理路径的隐式优化
- 需要权重级变化的隐性能力

---

## 2. 核心原理

EvoClaw 借鉴了 OpenClaw-RL 论文的两条信号通道，但将学习结果写入 md 文件而非模型权重：

### 信号通道 1：评价性信号 → 行为规则

对应论文中的 Binary RL。当用户对 Bot 的回复表现出不满（重新提问、明确否定、放弃话题），系统会：

1. **Judge 模型**分析失败模式
2. **蒸馏**为一条简洁的行为规则
3. **写入**对应配置文件的 ECA 管理区域（如 SOUL.md）
4. Bot 下次推理时读到该规则，等效于"RL 降低了某种行为模式的概率"

### 信号通道 2：指令性信号 → 案例库

对应论文中的 OPD（Online Policy Distillation）。当用户提供具体的纠正方向（"你应该先做X"），系统会：

1. **Judge 模型**提取纠正 Hint
2. **生成**结构化的正确回答案例
3. **部署**为 `skills/evo-cases/SKILL.md`
4. Bot 遇到类似场景时加载该案例，等效于 OPD 的"增强上下文"

```
用户交互
    ↓
Bot 输出回复
    ↓
用户后续反馈
    ↓
┌─────────────────────────────┐
│  信号分类器 (LLM Judge)      │
│  - 评价性: 正/负/中性        │
│  - 指令性: 提取 Hint         │
└──────┬──────────┬───────────┘
       ↓          ↓
   负反馈       有 Hint
       ↓          ↓
  规则提炼     案例生成
       ↓          ↓
  SOUL.md     skills/evo-cases/
  TOOLS.md    SKILL.md
  AGENTS.md
       ↓          ↓
  冲突检测     相似案例合并
       ↓          ↓
  规则压缩     案例库裁剪
       ↓          ↓
└─── SyncEngine 推送到远程节点 ─┘
```

---

## 3. 触发方式

EvoClaw 支持三种触发方式：

### 3.1 定时任务（推荐）

系统内置 BullMQ 定时任务，默认每 24 小时自动运行一次。仅当目标 Agent 自上次进化以来累积了足够多的新会话（默认 ≥ 5 个）时才会实际执行。

无需手动操作，适合生产环境持续进化。

### 3.2 Console Assistant 指令

在 ClawConsole 的 AI 助手对话框中：

```
用户：帮我进化 Bot pm
用户：/evo pm
用户：evolve bot pm
```

助手会调用 `trigger_evolution` 平台 Skill，立即启动进化流程并返回结果摘要。

### 3.3 手动触发（界面按钮）

在 Bot 详情页的「自进化」标签页中，点击 **立即进化** 按钮。适合开发调试或观察单次进化效果。

### 3.4 REST API

```bash
curl -X POST http://localhost:3000/api/agents/{agentId}/evo/trigger \
  -H 'Content-Type: application/json' \
  -d '{"machineId": "your-machine-uuid"}'
```

---

## 4. 进化流水线

每次进化运行经历六个阶段，系统会实时更新运行状态：

### 阶段 1：信号采集 (`collecting`)

从 `session_messages` 表中查询自上次完成进化以来的所有对话，构建对话三元组：

```
(用户消息, Bot回复, 用户后续反馈)
```

只有包含至少 2 轮用户消息的会话才会被分析（需要后续反馈来评估质量）。

### 阶段 2：信号分类 (`classifying`)

LLM Judge 逐个分析每个对话三元组，输出分类结果：

| 信号类型 | 含义 | 示例 |
|---------|------|------|
| `evaluative` + `negative` | 用户不满意 Bot 回复 | "这不对"、重新提问、放弃话题 |
| `evaluative` + `positive` | 用户满意 | "谢谢"、自然展开后续问题 |
| `instructive` | 用户提供纠正方向 | "你应该先查一下行业惯例" |
| `none` | 无关反馈 | 话题转换、问候语 |

### 阶段 3：规则蒸馏 (`distilling`)

- **负面评价信号** → 批量提交给 LLM，识别反复出现的失败模式，蒸馏为行为规则
- **指令性信号** → 逐个生成结构化案例

每条规则自动分配到最合适的目标文件：
- **SOUL.md**：通用行为约束、沟通风格、决策方式
- **TOOLS.md**：工具使用模式、参数指南
- **AGENTS.md**：多 Agent 协作规则

### 阶段 4：进化控制

对新生成的规则/案例执行质量控制（详见第 6 节）。

### 阶段 5：写入应用 (`applying`)

将所有活跃规则写入对应配置文件的 ECA 管理区域，生成案例 Skill 文件，通过 SyncEngine 推送到远程节点。

### 阶段 6：完成 (`completed`)

生成运行摘要，记录统计数据。

---

## 5. 输出产物

### 5.1 配置文件中的 ECA 管理区域

EvoClaw 使用 HTML 注释标记来管理配置文件中的专属区域，不会影响用户手动编写的内容：

```markdown
# 你手动编写的 Soul 内容

这里是你定义的 Bot 人格...

<!-- ECA:BEGIN -->
## Auto-evolved Behavior Constraints

- 给出赔偿金额建议时，必须先引用行业惯例数据作为锚点
- 不要直接给出绝对数字，给出惯例范围 + 当前条款偏离程度

## Auto-evolved Preferences

- 法律问题优先引用法规原文，而非口语化解释
<!-- ECA:END -->

# 你手动编写的其他内容（不受影响）
```

**关键特性**：
- `<!-- ECA:BEGIN -->` 和 `<!-- ECA:END -->` 之间的内容完全由 EvoClaw 管理
- 标记外的用户内容永远不会被修改
- 每次进化运行会重新生成整个 ECA 区域（基于所有活跃规则）

### 5.2 案例技能文件

案例库以 OpenClaw Skill 的标准格式部署到 `skills/evo-cases/SKILL.md`：

```markdown
---
name: evo-cases
description: Auto-evolved case library from user interaction feedback
version: "2026-03-28"
tags: [evo, cases, auto-evolved]
---

# Evolved Case Library

## Case: 供应商合同赔偿上限审查
**Scenario**: 审查供应商合同中的赔偿上限条款
**Correct Approach**: 先查询同类合同赔偿上限惯例 → 给出惯例范围（通常6-12个月服务费）→ 指出当前条款偏离点
**Avoid**: 直接建议调整为合同总额100%
```

Bot 在推理时会自动加载该 Skill，遇到类似场景时参考案例中的正确做法。

---

## 6. 进化控制机制

与权重训练有 KL 散度惩罚防止模型跑偏不同，md 文件进化需要额外的质量控制机制：

### 6.1 规则冲突检测

新规则写入前，LLM 会检查是否与同一目标文件的已有规则矛盾：

- **无冲突** → 直接写入
- **可合并** → 将新旧规则合并为一条更完整的规则
- **替代** → 新规则取代旧规则（旧规则标记为 `superseded`）

### 6.2 规则压缩

当某个配置文件的活跃规则超过上限（默认 15 条），触发 LLM 压缩：

- 将多条细碎规则合并为少量高层原则
- 被合并的旧规则标记为 `merged`
- 等效于 RL 中"权重逐渐稳定"的过程

### 6.3 规则衰减

两种情况会导致规则被自动废弃：

1. **从未触发**：规则创建后经过 N 次进化运行（默认 10 次）仍然从未被关联到新的对话信号
2. **净负反馈**：规则应用后，负面反馈次数超过正面反馈次数（至少 3 次反馈样本）

这模拟了 RL 中"旧策略被新策略覆盖"的效果。

---

## 7. 前端管理界面

在 Bot 详情页中，点击「自进化」标签页即可进入 EvoClaw 管理界面。

### 概览卡片

顶部展示四个统计卡片：
- **活跃规则**：当前生效的行为规则总数
- **案例库**：当前活跃的案例数量
- **上次进化**：最近一次完成进化的时间
- **立即进化**：手动触发按钮

### 规则管理

- 按目标文件分组显示所有活跃规则
- 每条规则显示：类型图标、内容、置信度、触发次数、正/负反馈计数
- 鼠标悬停显示废弃按钮，可手动移除不合适的规则

### 案例管理

- 列表显示所有活跃案例
- 点击展开查看详情（正确做法、应避免事项、用户纠正内容）
- 显示相关次数（被后续进化关联到的次数）
- 可手动移除案例

### 运行历史

- 时间线展示所有进化运行记录
- 每条记录显示：状态、触发类型、时间、摘要
- 详细统计：分析的会话数、发现的信号数、生成的规则/案例数

---

## 8. 配置参数

在 `.env` 文件中设置以下环境变量：

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `EVO_CLAW_INTERVAL_S` | `86400` | 定时进化间隔（秒），默认 24 小时 |
| `EVO_CLAW_MIN_SESSIONS` | `5` | 触发进化所需的最少新会话数 |
| `EVO_CLAW_MAX_RULES_PER_FILE` | `15` | 单个配置文件的最大活跃规则数，超出触发压缩 |
| `EVO_CLAW_DECAY_THRESHOLD_RUNS` | `10` | 规则未被触发的容忍进化轮数，超出自动废弃 |
| `EVO_CLAW_JUDGE_MODEL` | `claude-sonnet-4-20250514` | Judge/Distiller 使用的 LLM 模型 |

### 调参建议

- **高频交互场景**（如客服 Bot）：降低 `EVO_CLAW_INTERVAL_S` 至 `43200`（12 小时），降低 `EVO_CLAW_MIN_SESSIONS` 至 `3`
- **低频专业场景**（如法律审查 Bot）：保持默认或增大 `EVO_CLAW_MIN_SESSIONS` 至 `10`，确保有足够样本
- **规则稳定性优先**：增大 `EVO_CLAW_DECAY_THRESHOLD_RUNS` 至 `20`，规则不会太快被废弃
- **上下文窗口紧张**：降低 `EVO_CLAW_MAX_RULES_PER_FILE` 至 `10`，更积极地压缩规则

---

## 9. REST API

### 触发进化

```
POST /api/agents/:agentId/evo/trigger
Body: { "machineId": "uuid" }
Response: 202 { id, status, triggerType, ... }
```

### 查询运行历史

```
GET /api/agents/:agentId/evo/runs?machineId=xxx&limit=20
Response: [{ id, status, sessionsAnalyzed, signalsFound, rulesGenerated, casesGenerated, summary, ... }]
```

### 查询运行详情（含信号）

```
GET /api/agents/:agentId/evo/runs/:runId
Response: { ...run, signals: [{ signalType, polarity, rawContent, hint, ... }] }
```

### 查询活跃规则

```
GET /api/agents/:agentId/evo/rules?machineId=xxx&status=active&targetFile=SOUL.md
Response: [{ id, ruleKey, ruleType, content, targetFile, confidenceScore, triggerCount, ... }]
```

### 编辑规则

```
PATCH /api/agents/:agentId/evo/rules/:ruleId
Body: { "content": "更新后的规则文本", "status": "deprecated" }
```

### 废弃规则

```
DELETE /api/agents/:agentId/evo/rules/:ruleId
```

### 查询案例库

```
GET /api/agents/:agentId/evo/cases?machineId=xxx&status=active
Response: [{ id, caseKey, scenario, correctApproach, relevanceCount, ... }]
```

### 移除案例

```
DELETE /api/agents/:agentId/evo/cases/:caseId
```

---

## 10. 常见问题

### Q: EvoClaw 会修改我手动编写的配置内容吗？

不会。EvoClaw 只管理 `<!-- ECA:BEGIN -->` 和 `<!-- ECA:END -->` 标记之间的内容。标记外的所有内容会被完整保留。

### Q: 如果对自动生成的规则不满意怎么办？

可以在前端界面中手动废弃（点击删除图标），或通过 API 将其状态设为 `deprecated`。废弃的规则不会出现在下次生成的 ECA 区域中。

### Q: 进化运行消耗多少 LLM Token？

取决于分析的会话数量。典型的一次运行（分析 10 个会话、产出 3-5 个信号）大约消耗 10K-30K token。Judge 分类是主要消耗点（每个对话三元组约 2K token）。

### Q: 多个 Agent 共享同一节点时，进化是否互相影响？

不会。每个 Agent 的规则和案例都通过 `machine_id` + `agent_id` 隔离，写入各自的 workspace 目录（如 `workspace-pm/SOUL.md`）。

### Q: 进化运行失败了怎么办？

失败的运行会记录在运行历史中，状态为 `failed`，并附带错误信息。不会对现有配置文件产生任何修改。可以排查错误后重新触发。

### Q: 案例 Skill 文件会无限增长吗？

不会。案例库受以下机制约束：
- 相似案例会自动合并
- 案例可被手动移除
- 未来版本将支持基于相关性的自动裁剪

### Q: 可以关闭定时自动进化吗？

可以。将 `EVO_CLAW_INTERVAL_S` 设置为一个很大的值（如 `999999999`），或将 `EVO_CLAW_MIN_SESSIONS` 设置为一个不可能达到的数字，即可实质性禁用定时进化。仍然可以通过手动按钮或 `/evo` 指令按需触发。

---

## 数据库表结构

EvoClaw 使用 4 张表记录进化过程：

| 表名 | 用途 |
|------|------|
| `evo_runs` | 进化运行审计日志，记录每次运行的状态和统计 |
| `evo_signals` | 原始提取的信号，保留对话片段用于审计和重处理 |
| `evo_rules` | 行为规则及其生命周期元数据（触发次数、反馈计数、衰减状态） |
| `evo_cases` | 案例库条目及其关联度追踪 |

运行迁移以创建这些表：

```bash
npx knex migrate:latest
```

---

## 架构决策记录

1. **ECA 独立于 OpenClaw Bot**：ECA 是 ClawConsole 平台模块，不修改 OpenClaw 运行时代码。它通过文件同步间接影响 Bot 行为。
2. **规则写入 config 文件而非独立文件**：OpenClaw 运行时只加载预定义的 persona 文件集（SOUL.md、IDENTITY.md 等），独立的 `EVO-RULES.md` 不会被 Bot 读取。因此规则直接写入已有的 config 文件中。
3. **案例库部署为 Skill**：利用 OpenClaw 原生的 Skill 加载机制，案例库作为 `skills/evo-cases/SKILL.md` 部署，无需修改运行时。
4. **触发器实现为 Platform Skill**：`/evo` 指令通过 Console Assistant 的 Platform Skill 机制实现，而非 OpenClaw Bot 的 Skill。
