# PRD: Bot 创建与节点选择

> Version: 1.0 | Date: 2026-03-06
> Author: Product Design
> Status: Draft

---

## 1. 需求背景

### 1.1 现状问题

当前 ClawConsole 的 Bot 管理页面（`/bots`）仅支持**查看**已有 Bot，Bot 的创建完全依赖在远程节点上手动操作 OpenClaw CLI，然后通过 "发现（Discover）" 功能拉取到 Console。

这带来几个核心问题：

| 问题 | 影响 |
|------|------|
| 创建 Bot 必须 SSH 到目标机器 | 违背 "全程不碰命令行" 的产品定位 |
| 无法在 Console 中选择目标节点 | 新用户不知道 Bot 该部署在哪台机器上 |
| Channel 配置散落在 `openclaw.json` | 配置门槛高，必须了解 JSON 结构 |
| 无法一站式完成 "创建 Bot + 绑定渠道" | 需要多个步骤、多个工具配合 |

### 1.2 目标

让用户在 Bot 管理页面通过**可视化向导**完成：
1. 选择部署节点
2. 定义 Bot 基本信息
3. 配置消息渠道（Channel）
4. 绑定渠道与 Bot
5. 一键同步到远程节点

---

## 2. 可行性分析

### 2.1 技术可行性

| 维度 | 评估 | 说明 |
|------|------|------|
| **后端 API** | **已具备基础** | `POST /api/machines/:machineId/agents` 已实现 Agent 创建；Sync Engine 支持 Push |
| **openclaw.json 生成** | **已具备** | `openclaw-json.generator.ts` 可将 DB 数据序列化为 openclaw.json |
| **文件同步** | **已具备** | Sync Engine 的 Warm 模式可推送 openclaw.json + workspace 文件并重启 Gateway |
| **Channel 模型** | **需新增** | 当前 DB 无 `channels` 表，Channel 信息仅存在于 openclaw.json 原始 JSON 中 |
| **Binding 模型** | **需新增** | 同上，Binding 信息仅在 openclaw.json 中，无独立数据结构 |
| **前端组件** | **需新增** | 当前 BotsPage 无创建入口，需新增创建向导组件 |

### 2.2 数据模型可行性

当前 `openclaw.json` 中的核心结构：

```json5
{
  "agents": {
    "list": [
      { "id": "pm", "default": false, "name": "PM Agent", "workspace": "workspace-pm" }
    ]
  },
  "channels": {
    "feishu-1": { "type": "feishu", "appId": "...", "appSecret": "..." },
    "slack-1": { "type": "slack", "botToken": "..." }
  },
  "bindings": [
    { "agentId": "pm", "match": { "channel": "feishu-1", "peer": { "kind": "group", "id": "..." } } }
  ]
}
```

**结论**：创建 Bot 本质上是在 `openclaw.json` 中新增 `agents.list` 条目 + 创建 `workspace-{id}/` 目录及初始文件。Channel 配置是在 `channels` 字段新增/选择条目。Binding 是在 `bindings` 数组新增条目。所有这些都可通过现有的文件同步机制推送到远端。

### 2.3 风险评估

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| 多人同时创建 Bot 导致 openclaw.json 冲突 | 中 | Pull-Before-Push 协议已处理此场景 |
| Channel 凭证安全 | 中 | 复用现有 Credential Vault 加密存储 |
| 远程节点不在线 | 低 | 创建操作先入 DB，同步失败后可重试 |
| Bot ID 命名冲突 | 低 | 前端校验 + 后端唯一约束 |

---

## 3. 用户交互路径设计

### 3.1 入口

在 Bot 管理页面（`/bots`）右上角新增 **"+ 新建 Bot"** 按钮，点击后打开**分步创建向导（Wizard Modal）**。

### 3.2 创建向导流程

```
Step 1: 选择节点          Step 2: Bot 基本信息       Step 3: 配置 Channel       Step 4: 确认并创建
┌─────────────────┐     ┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│                 │     │                 │      │                 │      │                 │
│  [节点列表]      │ ──► │  Bot ID         │ ──►  │  选择/新建渠道   │ ──►  │  配置预览        │
│  在线状态        │     │  名称           │      │  渠道类型        │      │  文件变更摘要     │
│  已有Bot数量     │     │  描述           │      │  Binding 设置    │      │  同步确认        │
│  资源占用        │     │  是否默认        │      │                 │      │                 │
│                 │     │                 │      │                 │      │                 │
└─────────────────┘     └─────────────────┘      └─────────────────┘      └─────────────────┘
```

---

### 3.3 Step 1: 选择部署节点

**页面布局**：卡片网格，展示所有已注册节点

每张节点卡片显示：
- 节点名称 + Tailscale hostname
- 在线状态（StatusDot）
- OpenClaw 版本
- 已有 Agent 数量
- 最近健康检查时间

**交互规则**：
- 仅**在线（online）**节点可选择，离线节点置灰并显示 Tooltip "节点离线，无法部署"
- 单选模式，选中后卡片高亮
- 支持搜索/筛选节点（按名称、标签）
- 如果无任何在线节点，显示提示："无可用节点，请先在节点管理中注册并确保节点在线"

**选中节点后触发**：
- 后台调用 `GET /api/machines/:machineId` 获取该节点详情及已有 Agent 列表
- 用于 Step 2 中校验 Bot ID 是否重复

---

### 3.4 Step 2: Bot 基本信息

**表单字段**：

| 字段 | 类型 | 必填 | 校验规则 | 说明 |
|------|------|------|---------|------|
| Bot ID | Input | 是 | `^[a-z][a-z0-9_-]{1,49}$` + 不与已有 Agent 重复 | 系统标识符，如 `customer_support` |
| 名称 | Input | 否 | 最大 100 字符 | 显示名称，如 "客服助手" |
| 描述 | Textarea | 否 | 最大 500 字符 | Bot 用途描述 |
| 设为默认 | Toggle | 否 | 每节点最多一个默认 Agent | 是否作为该节点的默认 Agent |

**自动生成**：
- Workspace 路径：`workspace-{botId}`（只读展示，不可编辑）

**交互细节**：
- Bot ID 输入时实时校验：格式 + 是否与已有 Agent 重复
- 若勾选 "设为默认"，且节点已有默认 Agent，弹出确认提示

---

### 3.5 Step 3: 配置 Channel（可选步骤）

**两个子模式**：

#### 模式 A：选择已有 Channel
- 列出该节点 `openclaw.json` 中已配置的 channels
- 用户勾选要绑定的 channel
- 对每个选中的 channel 配置 Binding：
  - Binding 类型：`group`（群聊）、`user`（私聊）、`any`（全部）
  - Peer ID（群聊/用户 ID，可选）

#### 模式 B：新建 Channel
- 选择渠道类型：`feishu`、`slack`、`discord`、`dingtalk`、`wechat_work`、`telegram`、`webhook`
- 根据选择的类型，动态展示对应配置项：
  - **飞书**：App ID、App Secret
  - **Slack**：Bot Token、Signing Secret
  - **Discord**：Bot Token
  - **钉钉**：App Key、App Secret
  - **企业微信**：Corp ID、Agent ID、Secret
  - **Telegram**：Bot Token
  - **Webhook**：URL、Secret
- Channel ID（自动生成或手动指定）
- 凭证自动加入 Credential Vault

#### 可跳过逻辑
- 用户可选择 "稍后配置"，跳过此步骤
- 创建后可在 Bot 详情页单独配置

---

### 3.6 Step 4: 确认并创建

**预览展示**：

```
┌─────────────────────────────────────────────────┐
│  创建预览                                        │
├─────────────────────────────────────────────────┤
│                                                  │
│  目标节点：  CS Bot Server (cs-bot.tailnet)       │
│  Bot ID：   customer_support                     │
│  名称：     客服助手                              │
│  Workspace：workspace-customer_support           │
│                                                  │
│  将创建/修改以下文件：                             │
│  ├─ openclaw.json          [修改] 新增 agent 条目  │
│  ├─ workspace-customer_support/                   │
│  │  ├─ SOUL.md             [新建] 默认人设模板     │
│  │  ├─ README.md           [新建] Bot 说明         │
│  │  └─ skills/             [新建] 空目录           │
│  └─ (bindings)             [修改] 新增渠道绑定     │
│                                                  │
│  同步模式：Warm（需重启 Gateway）                  │
│                                                  │
│     [取消]                    [创建并同步]         │
│                                                  │
└─────────────────────────────────────────────────┘
```

**"创建并同步" 执行流程**：
1. 调用 `POST /api/machines/:machineId/agents` 创建 Agent 记录
2. 在 DB 中生成初始 workspace 文件（SOUL.md 模板、README.md）
3. 更新 `openclaw.json` 的 `agents.list`、`channels`、`bindings`
4. 标记所有变更文件为 `local_dirty = true`
5. 触发 Sync Push（Warm 模式，因涉及 openclaw.json）
6. 通过 WebSocket 展示实时同步进度
7. 同步完成后跳转到 Bot 详情页

**错误处理**：
- 同步失败：保留 DB 记录，Bot 状态置为 `draft`，提示用户重试同步
- 网络断连：显示进度条暂停状态，重连后可重试

---

## 4. 信息架构变更

### 4.1 新增数据库表（建议）

目前不建议新增 `channels` 和 `bindings` 独立表。原因：
- Channel/Binding 配置与 `openclaw.json` 强绑定，独立表会引入双源不一致风险
- 当前阶段建议仍以 `openclaw.json` 文件为 single source of truth
- Console 在创建/修改时直接操作 `managed_files` 中 `openclaw.json` 的内容

### 4.2 Agent 表扩展

在现有 `agents` 表上新增字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `channel_summary` | JSON | 缓存该 Agent 绑定的 Channel 摘要（反规范化，用于列表展示） |
| `created_by` | VARCHAR(100) | 创建者标识 |
| `creation_source` | ENUM('discovered', 'manual') | 创建来源 |

### 4.3 API 新增/修改

| 方法 | 路径 | 说明 | 状态 |
|------|------|------|------|
| `POST` | `/api/machines/:machineId/agents` | 扩展：支持传入初始 channel 配置和 binding | 修改 |
| `GET` | `/api/machines/:machineId/channels` | 新增：获取该节点已配置的 channels 列表 | 新增 |
| `POST` | `/api/machines/:machineId/agents/:agentId/deploy` | 新增：生成文件 + 触发 Warm Sync | 新增 |

---

## 5. 前端组件设计

### 5.1 新增组件

```
frontend/src/components/bots/
├── CreateBotWizard.tsx          # 创建向导主容器（Modal）
├── steps/
│   ├── NodeSelectionStep.tsx    # Step 1: 节点选择
│   ├── BotInfoStep.tsx          # Step 2: 基本信息表单
│   ├── ChannelConfigStep.tsx    # Step 3: 渠道配置
│   └── ConfirmStep.tsx          # Step 4: 确认预览
├── NodeCard.tsx                 # 节点选择卡片
└── ChannelForm.tsx              # 渠道配置动态表单
```

### 5.2 修改组件

| 组件 | 修改内容 |
|------|---------|
| `BotsPage.tsx` | 新增 "创建 Bot" 按钮，接入 CreateBotWizard |
| `BotCard.tsx`（BotsPage 内） | 新增 Channel 标签展示 |
| `BotDetailPage.tsx` | 新增 "渠道配置" Tab |

### 5.3 新增 Hooks

```
frontend/src/hooks/
├── useCreateBot.ts             # Bot 创建 mutation
└── useChannels.ts              # 节点 Channel 查询
```

---

## 6. 交互流程图

```
用户点击 "+ 新建 Bot"
        │
        ▼
┌── Step 1: 选择节点 ──┐
│  加载在线节点列表       │
│  用户选中一个节点       │
│  [下一步]              │
└────────┬──────────────┘
         │
         ▼
┌── Step 2: Bot 信息 ──┐
│  输入 Bot ID          │
│  实时校验 ID 唯一性    │
│  填写名称/描述         │
│  [上一步] [下一步]     │
└────────┬──────────────┘
         │
         ▼
┌── Step 3: Channel ───┐
│  模式A: 选择已有      │───► 勾选 + 配置 Binding
│  模式B: 新建渠道      │───► 填写渠道配置
│  [跳过] [上一步] [下一步]│
└────────┬──────────────┘
         │
         ▼
┌── Step 4: 确认 ──────┐
│  预览全部配置          │
│  展示文件变更列表      │
│  [上一步] [创建并同步]  │
└────────┬──────────────┘
         │
         ▼
   ┌─── 创建中 ──────┐
   │  1. 创建 DB 记录  │
   │  2. 生成文件      │
   │  3. Push Sync    │
   │  4. WebSocket进度 │
   └────────┬─────────┘
            │
      ┌─────┴─────┐
      ▼           ▼
  [成功]       [失败]
   │              │
   ▼              ▼
 跳转至        保持Draft
 Bot详情页     提示重试
```

---

## 7. 里程碑规划

### Phase 1 — MVP（2 周）
- Step 1 + Step 2：节点选择 + Bot 基本信息创建
- 创建后自动生成默认 SOUL.md 模板 + 触发 Warm Sync
- Bot 状态流转：`draft` → `syncing` → `online`

### Phase 2 — Channel 配置（1 周）
- Step 3：已有 Channel 选择 + Binding 配置
- Bot 详情页新增 "渠道" Tab

### Phase 3 — Channel 创建（1 周）
- Step 3 扩展：新建 Channel + 凭证自动加密存储
- 支持主流渠道类型模板

### Phase 4 — 增强（后续）
- Bot 模板：预设常见 Bot 类型（客服、营销、研发助手）
- 批量创建：一次创建多个 Bot 到多个节点
- Bot 克隆：从已有 Bot 复制配置到新节点

---

## 8. 成功指标

| 指标 | 目标 |
|------|------|
| Bot 创建完成率 | > 90%（进入向导后成功创建的比例）|
| 平均创建耗时 | < 2 分钟（从点击 "新建" 到同步完成）|
| 用户求助率 | < 5%（创建过程中需要查看文档或求助的比例）|
| 同步成功率 | > 95%（创建后首次同步成功率）|
