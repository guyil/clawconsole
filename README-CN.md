# ClawConsole — OpenClaw 企业管理平台

> **你的 AI Bot 分散在 10 台服务器上，每次改个配置要 SSH 10 次？**
>
> ClawConsole 让你在一个界面里管好所有 Bot —— 配置秒级下发，技能一键分发，密钥零落盘传输，全程不碰命令行。

ClawConsole 是 [OpenClaw](https://github.com/openclaw/openclaw) 生态的**企业级控制台**。当你的 AI Agent 从 1 个扩展到 10 个、部署从 1 台机器扩展到 N 台，ClawConsole 就是那个让管理复杂度归零的中枢 —— 通过 Tailscale 零信任网络连接所有节点，将分散的 Bot 集群变成一盘清晰可控的棋局。

---

## 为什么需要 ClawConsole？

| 没有 ClawConsole | 有了 ClawConsole |
|---|---|
| 改一个 Bot 人设，SSH 上去 vim 编辑，改错了没备份 | Web 界面在线编辑，自动版本管理，一键同步到远程 |
| 新写了个技能，要逐台机器手动复制 SKILL.md | 技能目录集中审核，通过后一键分发到 50 台机器 |
| API Key 明文存在服务器上，离职交接靠口头 | AES-256 加密保管，SSH 管道直传，全程不落盘 |
| 某台机器 Bot 挂了，第二天用户投诉才发现 | 60 秒健康巡检，状态异常实时推送到仪表盘 |
| 想知道 Bot 今天聊了什么，要翻日志文件 | 会话透视面板，实时查看每个 Agent 的对话记录 |
| 新技能上线前不确定有没有安全风险 | 内置安全扫描 + Playground 沙盒测试，上线前验证 |

---

## 核心能力

### 1. 多机集群，一屏掌控

> **场景**：你在北京、上海、深圳各有一台服务器跑 OpenClaw Bot，服务客服、营销、研发三个部门。

- 打开 ClawConsole 仪表盘，所有机器的在线状态、Agent 数量、最近同步结果一目了然
- 新机器加入 Tailscale 网络后自动发现，点击"注册"即可纳入管理
- 每 60 秒自动执行四层健康检查（网络连通 → SSH 可达 → OpenClaw 版本 → Gateway 状态），任何异常立即告警
- **所有通信走 Tailscale WireGuard 隧道，无需开放公网端口**，安全团队签字通过

### 2. 智能同步，告别手动部署

> **场景**：运营团队在 Console 上调整了客服 Bot 的回复话术，需要更新到 3 台生产机器上。

- 在 Web 界面修改 Bot 人设文件，点击"同步"
- 同步引擎自动执行 **Pull-Before-Push**：先拉取远程最新状态，SHA-256 指纹比对后再推送变更
- 如果其他同事刚刚在远程机器上改了同一个文件，系统会**智能判断冲突类型**并给出解决建议
- 三级同步模式自适应场景：
  - **Hot**：只改了一个配置文件？秒级 SCP 直传，无需重启
  - **Warm**：批量文件变更？rsync 增量同步 + 自动重启 Gateway
  - **Cold**：大版本升级？全量同步 + 依赖更新，一步到位
- 万一网络抖动导致某个文件传输失败？**自动重试队列**在后台默默帮你搞定（最多 3 次）

### 3. 技能商店，从开发到上线全覆盖

> **场景**：研发团队写了一个"Jira 工单自动处理"技能，需要安全审核后分发给研发部门的 5 个 Agent。

- **导入**：支持 GitHub URL、ClawHub 社区页面、直接粘贴 SKILL.md 三种方式
- **审核**：内置安全扫描引擎，自动检测 Shell 注入、eval 执行、敏感路径遍历、环境变量泄露等 6 类风险
- **沙盒测试 (Playground)**：上线前在隔离沙盒中测试技能表现
  - 基于 Claude + LangGraph 的 ReAct Agent，支持多轮对话和工具调用
  - 沙盒内可读写文件、搜索内容、抓取网页，但**路径穿越防护确保不会越权**
  - SSE 流式输出，实时看到 AI 的每一步思考和工具调用过程
  - 内置 Code Review、Data Analysis、DevOps Assistant 等模板，30 秒开始测试
- **分发**：审核通过后一键批量部署到指定机器和 Agent，告别逐台复制
- **版本管理**：每次变更自动创建版本快照，随时回滚到任意历史版本

### 4. 密钥管家，安全到偏执

> **场景**：公司的飞书 API Token、OpenAI API Key、数据库密码分散在各台服务器上，安全审计总是头疼。

- 所有凭证在数据库中以 **AES-256-GCM** 加密存储，即使数据库泄露也无法直接读取
- 同步到远程机器时，凭证通过 **SSH 管道直写目标文件**（`chmod 0600`），全程不生成临时文件，不落盘中间态
- 一次操作将同一组凭证同步到多台目标机器，确保所有节点使用最新密钥
- 人员离职？在 Console 上统一轮换密钥，30 秒内所有机器全部生效

### 5. 实时监控，Bot 的一切尽在掌握

> **场景**：CEO 问"我们的 AI 客服今天处理了多少对话？有没有出错？"，你需要 10 秒内给出答案。

- **仪表盘**：在线机器数、活跃 Agent、技能安装量、同步历史趋势，打开就有数据
- **会话透视**：点进任意 Agent，实时查看当前活跃会话和完整历史对话记录
- **日志中枢**：定时从所有机器采集 Gateway 日志、命令执行记录、配置变更审计
- **实时推送**：基于 WebSocket 事件总线，同步进度、机器掉线、Agent 异常等关键事件在发生的瞬间推送到你的屏幕上

### 6. 文件驱动，优雅解耦

> **设计哲学**：ClawConsole 不是一个"远程控制器"，而是一个"文件管家"。

OpenClaw 的一切 —— 配置、人设、技能、凭证 —— 都以文件形态存在于每台机器的 `~/.openclaw/` 目录中。ClawConsole 管理的是这些文件的**中心化存储与双向同步**，而不是直接操控 Bot 的运行时进程。

这意味着：
- **松耦合**：ClawConsole 挂了，Bot 照常运行；Bot 挂了，ClawConsole 数据不丢
- **可审计**：每一次文件变更都有记录，谁在什么时候改了什么一目了然
- **易扩展**：新增节点只需加入 Tailscale 网络，Console 自动发现并同步配置

---

## 适用场景

| 场景 | 怎么用 |
|------|--------|
| **多部门 Bot 管理** | 客服、营销、研发各有专属 Bot，统一在 Console 中管理配置和技能 |
| **跨地域节点部署** | 多地机房 / 多云环境下的 Bot 集中管控，Tailscale 打通网络 |
| **技能市场运营** | 从 ClawHub / GitHub 导入技能，安全审核后分发到企业内部 Agent |
| **安全合规要求** | 密钥加密存储 + 无落盘传输 + 操作审计日志，满足等保要求 |
| **Bot 运维自动化** | 健康巡检 + 自动同步 + 失败重试，减少 90% 的手动运维操作 |
| **AI 技能研发测试** | Playground 沙盒中开发和测试新技能，验证安全后再上线 |

---

## 架构总览

```
        ┌────────────────────────────────────────┐
        │            ClawConsole 前端              │
        │     React 19 · Vite · TailwindCSS       │
        │  仪表盘 · 机器管理 · 技能商店 · Playground  │
        └───────────────────┬────────────────────┘
                            │ HTTP REST + WebSocket 实时推送
        ┌───────────────────▼────────────────────┐
        │            ClawConsole 后端              │
        │        Fastify 5 · TypeScript           │
        ├─────────────┬──────────────────────────┤
        │ Sync Engine │ LangGraph Agent (Claude)  │
        │ BullMQ Jobs │ Credential Vault (AES)    │
        │ File Parser │ Skill Catalog + Scanner   │
        ├─────────────┴──────────────────────────┤
        │      MySQL 8      │      Redis 7        │
        │  配置 · 文件 · 凭证  │  缓存 · 队列 · 事件  │
        └───────────────────┬────────────────────┘
                            │ SSH over Tailscale (WireGuard)
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
       ┌──────────┐  ┌──────────┐  ┌──────────┐
       │  北京节点  │  │  上海节点  │  │  深圳节点  │
       │ 客服 Bot  │  │ 营销 Bot  │  │ 研发 Bot  │
       │~/.openclaw│  │~/.openclaw│  │~/.openclaw│
       └──────────┘  └──────────┘  └──────────┘
```

---

## 项目结构

```
clawconsole/
├── docs/                          # 项目文档
│   ├── ARCHITECTURE.md           # 系统架构总览
│   ├── DATABASE.md               # 数据库 Schema 设计
│   ├── SYNC-ENGINE.md            # 同步引擎详解
│   ├── FILE-CLASSIFICATION.md    # 文件分类规则
│   ├── API-REFERENCE.md          # API 接口文档
│   └── MODULE-MAP.md             # 模块地图与依赖规则
├── prd/                           # 产品需求文档
├── backend/                       # 后端应用 (Node.js + TypeScript)
│   ├── src/
│   │   ├── server.ts             # 应用入口
│   │   ├── config/               # 配置加载
│   │   ├── shared/               # 共享工具 (DB, Redis, 加密, 日志, 错误)
│   │   ├── transport/            # SSH 连接池 + Tailscale 集成
│   │   ├── parsers/              # OpenClaw 文件解析器
│   │   ├── modules/              # 业务模块
│   │   │   ├── machines/         # 机器管理
│   │   │   ├── agents/           # Agent 管理
│   │   │   ├── files/            # 文件 Blob 存储
│   │   │   ├── sync/             # 同步引擎 (核心)
│   │   │   ├── credentials/      # 凭证加密管理
│   │   │   └── skills/           # 技能目录 + 分发
│   │   ├── jobs/                 # BullMQ 后台任务
│   │   └── websocket/            # WebSocket 实时事件
│   └── tests/                     # 测试文件
└── frontend/                      # 前端应用 (Vite + React + TypeScript)
    └── src/
        ├── api/                   # Axios API 客户端层
        ├── hooks/                 # React Query hooks
        ├── stores/                # Zustand 状态管理 (UI + WebSocket)
        ├── types/                 # TypeScript 类型 (镜像后端)
        ├── components/
        │   ├── layout/            # 布局: Sidebar, Header, AppLayout
        │   ├── ui/                # 通用组件: Button, Card, Modal, DataTable 等
        │   ├── machines/          # 节点管理组件
        │   ├── skills/            # Skills 组件
        │   ├── credentials/       # 凭证组件
        │   └── sync/              # 同步状态组件
        └── pages/                 # 页面: Dashboard, Machines, Skills 等
```

## 前置依赖

- **Node.js** >= 20.0.0
- **MySQL** 8.0+
- **Redis** 7.x
- **Tailscale** (Console 服务器需加入 Tailnet)

## 快速开始

### 1. 安装依赖

```bash
# 后端
cd backend && npm install

# 前端
cd ../frontend && npm install
```

### 2. 配置环境变量

复制示例配置并根据实际情况修改：

```bash
cp .env.example .env
```

主要配置项：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务端口 | 3000 |
| `MYSQL_HOST` | MySQL 地址 | 127.0.0.1 |
| `MYSQL_PORT` | MySQL 端口 | 3306 |
| `MYSQL_USER` | MySQL 用户名 | clawconsole |
| `MYSQL_PASSWORD` | MySQL 密码 | - |
| `MYSQL_DATABASE` | 数据库名 | clawconsole |
| `REDIS_HOST` | Redis 地址 | 127.0.0.1 |
| `REDIS_PORT` | Redis 端口 | 6379 |
| `CREDENTIAL_ENCRYPTION_KEY` | AES-256 加密密钥 (64 位 hex) | - |

### 3. 初始化数据库

确保 MySQL 已运行，然后创建数据库并执行迁移：

```bash
# 创建数据库 (如果还没有)
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS clawconsole CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# 执行数据库迁移 (创建 8 张业务表)
npm run migrate
```

### 4. 启动服务

```bash
# 开发模式 (热重载)
npm run dev

# 或者编译后启动
npm run build
npm start
```

服务启动后：
- HTTP API: `http://localhost:3000/api`
- WebSocket: `ws://localhost:3000/ws`
- 健康检查: `http://localhost:3000/api/health`

### 5. 启动前端

```bash
cd frontend
npm run dev
```

前端开发服务器运行于 `http://localhost:5173`，自动代理 API 请求到后端。

## 可用脚本

### 后端 (`backend/`)

| 命令 | 说明 |
|------|------|
| `npm run dev` | 开发模式启动 (tsx watch 热重载) |
| `npm run build` | TypeScript 编译到 dist/ |
| `npm start` | 生产模式启动 (需先 build) |
| `npm test` | 启动 vitest 监听模式 |
| `npm run test:run` | 运行全部测试 (单次) |
| `npm run lint` | ESLint 代码检查 |
| `npm run migrate` | 执行数据库迁移 |
| `npm run migrate:rollback` | 回滚最近一次迁移 |

### 前端 (`frontend/`)

| 命令 | 说明 |
|------|------|
| `npm run dev` | Vite 开发服务器 (HMR, 代理后端) |
| `npm run build` | TypeScript 检查 + 生产构建 |
| `npm run preview` | 预览生产构建 |
| `npm run lint` | ESLint 代码检查 |

## 生成加密密钥

用于 `CREDENTIAL_ENCRYPTION_KEY`（AES-256-GCM 凭证加密）：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## API 概览

| 模块 | 端点前缀 | 说明 |
|------|----------|------|
| 机器管理 | `/api/machines` | Tailscale 节点 CRUD、健康检查、结构发现 |
| Agent 管理 | `/api/agents` | Agent CRUD、状态追踪 |
| 文件管理 | `/api/files` | 文件 Blob 读写、dirty 标记 |
| 同步引擎 | `/api/machines/:id/sync` | Pull / Push / Full Sync / Plan 预览 |
| 凭证管理 | `/api/credentials` | 加密凭证 CRUD、同步到远程机器 |
| 技能目录 | `/api/skills` | 技能目录 CRUD、审核、Agent 安装/卸载 |
| WebSocket | `/ws` | 实时同步进度、状态变更事件 |

详细 API 文档参见 [docs/API-REFERENCE.md](docs/API-REFERENCE.md)。

## 测试

```bash
cd backend
npm run test:run
```

当前共 102 个单元测试，覆盖：
- 文件分类器 (29 tests)
- 同步模式检测器 (13 tests)
- Diff 引擎 (7 tests)
- 冲突解析器 (8 tests)
- Markdown 前置解析器 (5 tests)
- WebSocket 事件系统 (5 tests)
- 凭证服务 (13 tests)
- 技能服务 (22 tests)

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Node.js 20+ / TypeScript 5 |
| Web 框架 | Fastify 5 |
| 数据库 | MySQL 8 (Knex.js 查询构建器) |
| 缓存/队列 | Redis 7 (ioredis + BullMQ) |
| AI 引擎 | LangGraph + ChatAnthropic (Claude) |
| SSH 通信 | ssh2 (连接池 + SFTP) |
| 网络层 | Tailscale (零信任 WireGuard 隧道) |
| 加密 | AES-256-GCM (凭证加密) |
| 验证 | Zod |
| 日志 | Pino |
| 测试 | Vitest |
| WebSocket | @fastify/websocket + Redis Pub/Sub |
| 前端框架 | React 19 + Vite 7 |
| 前端样式 | TailwindCSS 4 |
| 状态管理 | TanStack Query v5 + Zustand |
| 路由 | React Router 7 |
| HTTP 客户端 | Axios |
| 图标 | Lucide React |

## 文档索引

- [系统架构](docs/ARCHITECTURE.md) — 整体设计与核心流程
- [数据库设计](docs/DATABASE.md) — 8 张表的 Schema 与索引策略
- [同步引擎](docs/SYNC-ENGINE.md) — Pull-Before-Push 协议详解
- [文件分类](docs/FILE-CLASSIFICATION.md) — 文件同步行为规则
- [API 文档](docs/API-REFERENCE.md) — 全部 REST 端点
- [模块地图](docs/MODULE-MAP.md) — 代码结构与依赖规则
