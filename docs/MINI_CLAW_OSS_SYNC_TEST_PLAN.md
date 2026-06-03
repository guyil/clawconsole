# Mini-Claw 对齐 OpenClaw Bot：OSS 同步与本地缓存测试方案

> Version: 1.0  
> Last Updated: 2026-05-13  
> Scope: clawconsole OSS direct push + platform metadata/webhook + mini-claw cache/search/runtime integration

## 1. 测试目标

本测试方案覆盖 “OpenClaw bot 的 persona、memory、skills 同步到 OSS，并触发 yuwen_ai_microapp_platform 更新本地缓存” 的完整链路。核心验收目标如下：

1. OSS 成为权威 blob 源，OpenClaw agent 的 raw memory、skill 文件夹、vector sqlite 快照和 meta 均按约定路径写入。
2. clawconsole 能以 agent 为粒度完成稳定、可重复、增量的 OSS direct push，并能触发平台 `/openclaw/sync-completed` webhook。
3. 平台只维护 Hub 元数据，不再生成或依赖 `index.json`、`index.md`、`core_digest.md`、`memory_snapshot`、`memory_index`。
4. mini-claw 在 chat 请求带 `agent_key` 时能按 hash 同步本地缓存，使用 sqlite-vec/FTS 搜索 memory，并按需读取 raw memory 和 skill 文件。
5. rollout 期间新老路径可双写、可灰度、可回滚，失败时有明确降级行为和可观测信号。

## 2. 范围与非范围

### 2.1 范围内

- clawconsole:
  - `distill-push` OSS 客户端、OSS path helper、push orchestrator、HTTP routes。
  - machine alias 配置与 `agent_key = oc-<machine_alias>-<agent_id>` 生成。
  - sqlite `wal_checkpoint(TRUNCATE)` + `VACUUM INTO` 快照流程。
  - raw memory 基于 sqlite `files` 表的上传、删除、差量行为。
  - skill 文件夹遍历、manifest 生成、上传、聚合 hash。
  - vector sqlite 与 `memory.sqlite.meta.json` 上传。
  - webhook 请求体、失败处理、重试/幂等边界。
- platform:
  - DB schema migration。
  - webhook 接收入口与 `agent_hub_agents` 元数据更新。
  - `agent_skill_oss_service.py` 对 OSS skill 的读、列举、提升共享。
  - mini-claw routes 注入 `agent_key`、`vector_meta`，不注入旧 memory snapshot/index。
- mini-claw:
  - sqlite-vec 依赖加载。
  - agent 本地缓存目录、hash 比对、按需下载。
  - `search_memory`、`read_agent_memory`、`list_agent_skills`、`read_skill` 工具。
  - system prompt 中 memory/skill 暴露方式调整。
  - vector/OSS 不可用时的降级。
- 跨系统:
  - OSS 路径契约、manifest/meta schema 契约。
  - 安全、权限、并发、性能、可观测性、回滚。

### 2.2 非范围内

- 对 embedding 模型质量做主观评测。
- OSS SDK 本身的供应商兼容性认证。
- OpenClaw 原生 memory/skill 写入逻辑重构。
- 大规模 litestream/分库增量方案实现测试；本期只测试 sqlite 整文件搬运和 hash 短路。

## 3. 测试前置确认事项

这些问题不阻塞测试方案编写，但进入测试执行前需要确认：

| 编号 | 待确认项 | 默认测试假设 |
| --- | --- | --- |
| Q1 | 平台仓库名最终是 `yuwen_ai_microapp_platform` 还是 `yuwen_ai_develop_platform` | 以实际部署服务的 `/openclaw/sync-completed` 接口为准 |
| Q2 | OSS 测试 bucket/prefix 是否独立于生产 | 使用独立 prefix，例如 `test/knowledge_hub/v1/...` |
| Q3 | webhook 鉴权头名称和 token 来源 | 使用 `Authorization: Bearer <MINICLAW_DISTILL_SERVICE_TOKEN>` |
| Q4 | OpenClaw sqlite `files` 表字段是否固定为 `path/hash/size` | 若字段变更，clawconsole 需要兼容查询测试 |
| Q5 | embedding model/dim 的权威来源 | 第一版以 clawconsole env 写入 meta，mini-claw 按 meta 调用 |
| Q6 | machine alias 唯一性由哪个系统最终保证 | clawconsole DB 唯一约束 + 平台侧重复 `agent_key` 拒绝或告警 |

## 4. 质量门槛

### 4.1 功能门槛

- P0 测试用例 100% 通过。
- P1 测试用例通过率不低于 95%，剩余项必须有明确风险接受人和修复计划。
- 任一 agent 重复执行 OSS push 3 次后，OSS 对象内容 hash 和平台元数据保持稳定。
- 旧 distill-bundle fallback 路径在灰度期仍可执行，不被新流程破坏。

### 4.2 数据正确性门槛

- `memory.sqlite.meta.json.sha256` 与 OSS 上 `vector/memory.sqlite` 实际 SHA-256 完全一致。
- skill `manifest.json.files[*].sha256` 与 OSS 上实际文件内容一致。
- raw memory 删除、改名、修改、新增均与 sqlite `files` 表最终状态一致。
- 平台 `agent_hub_agents.vector_meta.sha256` 等于 webhook 带来的 vector sha。
- mini-claw 本地缓存 `manifest.local.json` 与 OSS meta/manifest hash 对齐。

### 4.3 性能门槛

| 场景 | 目标 |
| --- | --- |
| 100 个 raw memory 文件首次上传 | <= 60s，失败可定位到文件级日志 |
| 100 个 raw memory 文件二次无变化 push | <= 首次 40%，不得重复下载 vector 以外无变化内容 |
| 200 MB sqlite 上传 | 不通过 stdout/base64，使用二进制流/SFTP，单次 <= 5min |
| mini-claw vector hash 命中 | chat 前缓存检查 <= 300ms |
| mini-claw vector hash 不命中，50 MB sqlite 下载 | <= 30s，下载后只读打开成功 |
| `search_memory(k=8)` | p95 <= 2s，不含外部 embedding API 慢调用 |

### 4.4 可靠性门槛

- 任一步失败不得产生“平台认为已同步但 OSS 内容不完整”的成功状态。
- webhook 失败时 clawconsole 返回失败或明确 `webhookSkipped/webhookFailed` 状态，便于重试。
- mini-claw 遇到 OSS/vector/embedding 失败时降级路径可用，并记录结构化 warning。

## 5. 测试环境

### 5.1 本地单元测试环境

- Node.js >= 20。
- clawconsole backend: Vitest。
- 平台 backend: pytest + alembic/SQLAlchemy 测试库。
- mini-claw: pytest，sqlite-vec wheel，临时 cache home。
- OSS 使用 mock client 或 MinIO/本地对象存储替身。
- webhook 使用 FastAPI/Fastify test client 或 mock HTTP server。

### 5.2 集成测试环境

- 1 台 OpenClaw 源机或容器化 SSH fixture。
- 1 个测试 OSS bucket/prefix。
- 1 个平台测试实例。
- 1 个 mini-claw 测试实例。
- 测试 agent:
  - `agent_id = pm-test`
  - `machine.alias = claw-test-1`
  - 3 个 raw memory 文件，含新增/修改/删除场景。
  - 2 个 skill 文件夹，一个完整 `SKILL.md + scripts + references`，一个缺失/异常用于负例。
  - sqlite 包含 sqlite-vec 表、FTS5 表、`files` 表。

### 5.3 预生产灰度环境

- 使用真实 Aliyun OSS。
- 1 到 3 个真实 OpenClaw agent 双写。
- mini-claw 先启用 FTS-only，再启用 embedding + sqlite-vec。
- 新旧 distill 输出同时保留 7 天，便于比对。

## 6. 测试数据设计

### 6.1 Agent 维度

| 数据集 | 描述 | 覆盖点 |
| --- | --- | --- |
| A1 基础 agent | persona + 3 raw + 1 skill + 10 chunks | happy path |
| A2 大 memory agent | 1000 raw + 200 MB sqlite + 5 skills | 性能和流式上传 |
| A3 中文路径 agent | raw/skill 文件含中文、空格、符号 | path encoding/escaping |
| A4 空 skill agent | 无 skill 或 skill 无 `SKILL.md` | 跳过/manifest 空集 |
| A5 空 memory agent | sqlite 存在但 `files` 表为空 | 空 raw + vector 上传 |
| A6 损坏 sqlite agent | sqlite 无法打开或缺表 | 失败处理 |
| A7 alias 冲突 agent | 两台机器同 alias 或旧 UUID 前缀相同 | 唯一性和冲突保护 |

### 6.2 文件维度

- raw memory:
  - Markdown、纯文本、JSON、二进制误入文件。
  - 文件名含空格、`#`、`%`、中文。
  - 深层路径 `projects/a/b/c.md`。
  - 删除后 sqlite `files` 表不再出现。
- skills:
  - 标准 `SKILL.md` frontmatter。
  - 缺失 `description`。
  - `scripts/*.py`、`references/*.md`、嵌套目录。
  - 大文件和空文件。
- sqlite:
  - WAL 模式有未 checkpoint 数据。
  - FTS5 可查但 vec0 不可用。
  - vec0 可查但 embedding 维度不匹配。

## 7. 测试分层

## 7.1 clawconsole 单元测试

### 7.1.1 OSS path helper

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| CC-U-001 | P0 | `agentPrefix("oc-claw-test-1-pm")` | 返回 `knowledge_hub/v1/scopes/agent/oc-claw-test-1-pm` |
| CC-U-002 | P0 | `agentMemoryRawKey` 处理前导 `/` | 不产生重复 `/` |
| CC-U-003 | P0 | `agentSkillFileKey` 对 `skill_key` URL encode | 特殊字符不会污染 OSS 层级 |
| CC-U-004 | P0 | `agentVectorMetaKey` | 路径为 `.../vector/memory.sqlite.meta.json` |
| CC-U-005 | P1 | `joinKey` 忽略空值和多余斜杠 | 输出稳定 |

### 7.1.2 Agent key 与 machine alias

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| CC-U-010 | P0 | alias 存在 | `oc-<alias>-<agent_id>` |
| CC-U-011 | P0 | alias 含大写、空格、中文符号 | slug 后只含 `[a-z0-9_-]` |
| CC-U-012 | P0 | alias 缺失 | 回退 UUID first segment，并记录 warning |
| CC-U-013 | P1 | 超长 alias + agent_id | 最终长度不超过 64 |
| CC-U-014 | P0 | DB migration 对 alias 加唯一索引 | 重复 alias 插入失败 |

### 7.1.3 OSS client

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| CC-U-020 | P0 | env 缺失 | `OssClient.fromEnv()` 返回 null，不影响服务启动 |
| CC-U-021 | P0 | `fullKey` 应用部署 prefix | key 正确拼接 |
| CC-U-022 | P0 | `toRelativeKey` 移除部署 prefix | 用于删除旧 raw key 正确 |
| CC-U-023 | P1 | `getBuffer` 404 | 返回 null |
| CC-U-024 | P1 | `delete` 404 | 不抛错 |
| CC-U-025 | P1 | `listAllKeys` 分页 | 多页对象全部返回 |

### 7.1.4 Distill push orchestrator

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| CC-U-030 | P0 | machine 不存在 | 抛 `machine not found`，不触发 OSS/webhook |
| CC-U-031 | P0 | agent 不存在或不属于 machine | 抛错，不触发 OSS/webhook |
| CC-U-032 | P0 | OSS env 未配置 | 抛配置错误 |
| CC-U-033 | P0 | sqlite snapshot 命令失败 | push 整体失败，不上传后续对象 |
| CC-U-034 | P0 | `files` 表解析 tab 分隔输出 | path/hash/size 正确 |
| CC-U-035 | P0 | raw 上传从 sqlite `files` 表驱动 | 只上传表中出现的文件 |
| CC-U-036 | P0 | OSS 上 stale raw 删除 | 表中不存在的 raw 被 delete |
| CC-U-037 | P1 | raw 远端文件缺失 | 记录 warning，继续其他文件 |
| CC-U-038 | P0 | skill 目录含 `SKILL.md` | 上传所有文件并写 manifest |
| CC-U-039 | P1 | skill 目录为空 | 跳过 |
| CC-U-040 | P0 | vector sqlite 下载后上传 | meta sha/size 与文件一致 |
| CC-U-041 | P0 | webhook body | 包含 `agent_key/vector_meta/skill_manifest_sha256/source_machine_alias` |
| CC-U-042 | P0 | webhook 返回 500 | push 返回失败或标记失败，不吞掉 |
| CC-U-043 | P1 | cleanup remote snapshot 失败 | 只 warning，不改变已成功结果 |
| CC-U-044 | P1 | local tmp sqlite 清理 | 成功和失败路径均清理 |

### 7.1.5 HTTP routes

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| CC-U-050 | P0 | `/api/distill/push-to-oss/single` body 缺字段 | 400 |
| CC-U-051 | P0 | single push 成功 | `{ok:true, agentKey, vectorSha256}` |
| CC-U-052 | P0 | single push 失败 | 500 + error message |
| CC-U-053 | P0 | machine push machine 不存在 | 404 |
| CC-U-054 | P1 | machine push 未传 agentIds | 推送所有非 draft agent |
| CC-U-055 | P1 | machine push 部分失败 | results 逐 agent 标记 ok/error |

## 7.2 clawconsole 集成测试

| ID | 优先级 | 用例 | 步骤 | 断言 |
| --- | --- | --- | --- | --- |
| CC-I-001 | P0 | 首次完整 push | 准备 SSH fixture + sqlite + raw + skills，调用 single route | OSS 有 raw/skills/vector/meta，webhook 收到一次 |
| CC-I-002 | P0 | WAL checkpoint 有效 | sqlite WAL 中写入未 checkpoint chunk 后 push | snapshot 含最新数据 |
| CC-I-003 | P0 | raw 增量删除 | 首次 push 后删除 sqlite `files` 一行再 push | OSS stale raw 被删除 |
| CC-I-004 | P1 | skill manifest 变更 | 修改 `SKILL.md` description 再 push | manifest sha 变化，平台收到新 sha |
| CC-I-005 | P1 | 大 sqlite | 生成 200 MB sqlite fixture | 通过 SFTP 二进制下载，不出现 stdout/base64 截断 |
| CC-I-006 | P0 | alias agent_key | machine alias = `claw-prod-1` | OSS key 使用 `oc-claw-prod-1-<agent_id>` |
| CC-I-007 | P1 | webhook 网络超时 | mock server 超时 | push 状态可重试，OSS 已上传内容不重复损坏 |
| CC-I-008 | P1 | OSS list 失败 | mock `listAllKeys` 抛错 | 继续覆盖上传，不执行误删除 |

## 7.3 平台单元测试

### 7.3.1 DB migration

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| PF-U-001 | P0 | `skills` 新增 owner 作用域列 | migration 后列存在 |
| PF-U-002 | P0 | skills 唯一约束 | `(owner_scope, owner_key, skill_key)` 唯一，全局同名允许 |
| PF-U-003 | P0 | old OpenClaw skill 反查归属 | 可回填到 agent owner |
| PF-U-004 | P1 | 找不到归属 skill | 标记 `owner_scope=shared` |
| PF-U-005 | P0 | `agent_hub_agents` 新增 vector/meta 列 | migration 后读写 JSON 成功 |
| PF-U-006 | P0 | rollback | schema 可回滚到旧版本，不丢旧列 |

### 7.3.2 Webhook metadata service

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| PF-U-010 | P0 | valid sync completed | 更新 `vector_meta/skill_manifest_sha256/source_machine_alias/updated_at` |
| PF-U-011 | P0 | agent_key 不存在 | 创建或返回明确 404，按产品决策固定 |
| PF-U-012 | P0 | vector sha 缺失 | 400，不更新半状态 |
| PF-U-013 | P0 | token 无效 | 401/403 |
| PF-U-014 | P0 | 不调用 rebuild TOC/digest | mock 旧函数断言未调用 |
| PF-U-015 | P1 | repeated webhook same sha | 幂等，updated_at 行为符合约定 |
| PF-U-016 | P1 | old distill-bundle fallback | 可执行且不 rebuild TOC/digest |

### 7.3.3 `agent_skill_oss_service.py`

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| PF-U-020 | P0 | `read_skill_md` 读取 frontmatter | name/description/tags 解析正确 |
| PF-U-021 | P0 | `list_agent_skills` | 返回 agent scope skills 元数据 |
| PF-U-022 | P0 | `upsert_skill_folder` | manifest 与文件内容 hash 一致 |
| PF-U-023 | P0 | `promote_to_shared` | OSS copy 到 `shared/skills/<skill_key>`，DB owner 更新 |
| PF-U-024 | P1 | shared 已存在同名 | 按策略拒绝、覆盖或版本化，行为固定 |
| PF-U-025 | P1 | skill OSS 不可达 | fallback DB `prompt` 字段 |

### 7.3.4 mini-claw routes 注入

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| PF-U-030 | P0 | req 带 `agent_key` | configurable 有 `agent_key/vector_meta` |
| PF-U-031 | P0 | req 带 `agent_key` | configurable 不含 `memory_snapshot/memory_index` |
| PF-U-032 | P0 | hub agent 不存在 | 使用默认 prompt 或返回明确错误 |
| PF-U-033 | P1 | eager skill keys | 保持全文注入向后兼容 |

## 7.4 mini-claw 单元测试

### 7.4.1 本地缓存

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| MC-U-001 | P0 | agent cache path | `~/.mini-claw/cache/agents/<agent_key>/...` |
| MC-U-002 | P0 | vector meta sha 命中 | 不下载 sqlite |
| MC-U-003 | P0 | vector meta sha 不命中 | 下载 sqlite，写入 local manifest |
| MC-U-004 | P0 | 下载后 sha 不匹配 | 删除临时文件并报错/降级 |
| MC-U-005 | P1 | 并发两个 chat 同 agent | 单飞下载或锁保护，不写坏缓存 |
| MC-U-006 | P1 | cache 目录不可写 | 返回可观测错误并降级 |
| MC-U-007 | P0 | skill lazy manifest | 初始只拉 manifest，不拉全部 skill 文件 |
| MC-U-008 | P0 | `read_skill` 首次读取 | 下载相对文件并缓存 |
| MC-U-009 | P1 | relative path 越界 `../` | 拒绝访问 |

### 7.4.2 Memory tools

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| MC-U-020 | P0 | `search_memory(query,k=8)` | 返回 path/start_line/end_line/snippet/score |
| MC-U-021 | P0 | vec0 + FTS RRF 合并 | 同一 chunk 去重，score 排序稳定 |
| MC-U-022 | P0 | embedding 维度与 meta 不一致 | 降级或明确错误，不查询 vec0 |
| MC-U-023 | P0 | sqlite-vec extension 缺失 | FTS-only 可用 |
| MC-U-024 | P0 | embedding API 失败 | FTS-only 可用并 warning |
| MC-U-025 | P1 | `k` 超大/非法 | clamp 到安全范围 |
| MC-U-026 | P0 | `read_agent_memory(path)` | 按 path 返回 raw 内容 |
| MC-U-027 | P0 | `read_agent_memory` line range | 只返回指定行范围 |
| MC-U-028 | P1 | unknown path | 返回明确 not found |
| MC-U-029 | P1 | raw OSS 不可达但本地缓存有 | 使用本地缓存 |

### 7.4.3 Skill tools

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| MC-U-040 | P0 | `list_agent_skills()` | 返回 skill_key/name/description/location |
| MC-U-041 | P0 | agent scope skill | location 为 `skills/<skill_key>/SKILL.md` |
| MC-U-042 | P0 | shared skill | 可从 `shared/skills` 读取 |
| MC-U-043 | P0 | `read_skill(skill_key)` | 默认读取 `SKILL.md` |
| MC-U-044 | P0 | `read_skill(skill_key, relative_path)` | 读取 scripts/references 文件 |
| MC-U-045 | P1 | skill OSS 不可达 | fallback DB prompt |

### 7.4.4 System prompt

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| MC-U-060 | P0 | memory prompt | 不再拼接 `Your Memory (Core)` 与 `Memory Index` |
| MC-U-061 | P0 | memory prompt | 包含 `AGENT_MEMORY_PROMPT_ADDON` |
| MC-U-062 | P0 | skill metadata | 输出 `<available_skills>` XML |
| MC-U-063 | P0 | skill 全文 | 非 eager skill 不预加载全文 |
| MC-U-064 | P1 | eager skill | 用户手选 skill 全文仍拼进 system prompt |

## 7.5 跨服务契约测试

| ID | 优先级 | 契约 | 生产者 | 消费者 | 断言 |
| --- | --- | --- | --- | --- | --- |
| CT-001 | P0 | OSS raw path | clawconsole | mini-claw/platform | `knowledge_hub/v1/scopes/agent/<agent_key>/raw/<path>` |
| CT-002 | P0 | OSS skill path | clawconsole/platform | mini-claw | `skills/<skill_key>/SKILL.md` 和 `manifest.json` |
| CT-003 | P0 | vector meta schema | clawconsole | platform/mini-claw | provider/model/dim/sha256/size/source_agent_id/source_machine/snapshot_at |
| CT-004 | P0 | skill manifest schema | clawconsole/platform | platform/mini-claw | owner_scope/owner_key/files/manifest_sha256 |
| CT-005 | P0 | webhook schema | clawconsole | platform | agent_key/vector_meta/skill_manifest_sha256/source_machine_alias |
| CT-006 | P0 | route configurable | platform routes | mini-claw graph | agent_key/vector_meta 存在，旧 memory 字段不存在 |
| CT-007 | P1 | error schema | all services | observability/ops | 失败响应含 machine/agent/key/step |

契约测试建议以 JSON Schema 固化在三个仓库中，CI 中做 producer/consumer 双向校验。

## 7.6 端到端测试

### E2E-001 首次完整同步并可检索

优先级：P0

步骤：
1. 准备 OpenClaw agent `pm-test`，含 persona、raw memory、skills、sqlite vector。
2. 设置 machine alias `claw-test-1`。
3. 调用 clawconsole `POST /api/distill/push-to-oss/single`。
4. 等待平台 webhook 更新 Hub 元数据。
5. 发起 mini-claw chat，请求带 `agent_key=oc-claw-test-1-pm-test`。
6. 调用或触发 `search_memory("测试记忆关键词")`。
7. 调用或触发 `read_skill("contract-review")`。

预期：
- OSS 对象完整。
- 平台 `agent_hub_agents.vector_meta.sha256` 与 OSS meta 一致。
- mini-claw cache 下存在 `vector/memory.sqlite` 和对应 skill cache。
- `search_memory` 返回目标 raw path 和 snippet。
- 模型可按需读取 skill，不依赖旧 digest/index。

### E2E-002 增量修改 raw memory

优先级：P0

步骤：
1. 完成 E2E-001。
2. 修改一个 raw memory 文件并更新 sqlite `files` 表 hash。
3. 删除一个 raw memory 文件并从 sqlite `files` 表移除。
4. 再次执行 clawconsole push。
5. 发起 mini-claw chat。

预期：
- 修改文件在 OSS 上 hash 变化。
- 删除文件从 OSS raw prefix 消失。
- mini-claw hash mismatch 后更新缓存。
- 搜索结果不再返回已删除文件。

### E2E-003 skill lazy load 与 promote shared

优先级：P1

步骤：
1. agent scope 下上传 skill `draft-skill`。
2. mini-claw chat 初始只加载 skill manifest。
3. 调用 `read_skill("draft-skill", "references/a.md")`。
4. 平台 UI 调用 promote shared。
5. 另一个 agent 引用该 shared skill。

预期：
- 初始缓存不包含所有 skill 文件。
- `read_skill` 后目标文件落入本地缓存。
- shared OSS 路径存在完整副本。
- DB owner scope 更新为 `shared`。
- 另一个 agent 可以读取该 shared skill。

### E2E-004 vector 失败降级

优先级：P0

步骤：
1. 删除或破坏 OSS `vector/memory.sqlite`。
2. 保留 raw memory 与可能的 FTS 数据。
3. 发起 mini-claw chat 并调用 `search_memory`。

预期：
- 系统记录 warning。
- 若 FTS 可用，则 FTS-only 返回结果。
- 若 vector 整体不可用且无 FTS，则工具返回明确降级信息，模型仍可通过已知 path 调 `read_agent_memory`。
- chat 请求不因 vector 缺失直接崩溃。

### E2E-005 灰度双写与回滚

优先级：P0

步骤：
1. 开启 clawconsole 双写：老 distill-bundle + 新 OSS direct push。
2. 对同一 agent 连续同步 3 次。
3. mini-claw 在新流程读取。
4. 切回老流程 fallback。

预期：
- 新老流程互不破坏。
- 老流程不再 rebuild TOC/digest 或至少不影响新字段。
- 回滚后用户可继续聊天。
- 平台可通过 feature flag 切换读取源。

## 8. 失败与降级测试矩阵

| 故障点 | 注入方式 | 预期行为 | 优先级 |
| --- | --- | --- | --- |
| OSS credential 缺失 | 清空 env | clawconsole route 返回配置错误 | P0 |
| OSS put 失败 | mock put 抛 500 | push 失败，不发成功 webhook | P0 |
| OSS list 失败 | mock list 抛错 | 不误删，继续上传或失败可控 | P1 |
| SSH snapshot 超时 | mock execute timeout | push 失败，日志含 step | P0 |
| sqlite 缺 `files` 表 | fixture 缺表 | push 失败或 raw 空集策略固定 | P0 |
| 远端 raw 缺失 | sqlite 有记录但文件不存在 | warning，跳过该文件 | P1 |
| webhook 401 | mock auth fail | push 标记失败，可重试 | P0 |
| webhook 500 | mock server error | 不吞掉失败 | P0 |
| mini-claw OSS 下载失败 | mock get 抛错 | 使用本地缓存或 fallback | P0 |
| vector sha mismatch | 返回错误文件 | 删除临时文件，降级 | P0 |
| sqlite-vec load 失败 | 禁用 extension | FTS-only | P0 |
| embedding API 失败 | mock API 500 | FTS-only | P0 |
| skill OSS 不可达 | mock get 抛错 | fallback DB prompt | P1 |
| cache 写入中断 | kill process 或抛异常 | 不留下半文件覆盖正式 sqlite | P1 |

## 9. 安全测试

| ID | 优先级 | 用例 | 断言 |
| --- | --- | --- | --- |
| SEC-001 | P0 | webhook 无 token | 401/403 |
| SEC-002 | P0 | webhook token 错误 | 401/403 |
| SEC-003 | P0 | `read_skill("../secret")` | 拒绝 path traversal |
| SEC-004 | P0 | `read_agent_memory("../../")` | 拒绝 path traversal |
| SEC-005 | P1 | OSS key 注入特殊字符 | key 被 encode/normalize |
| SEC-006 | P1 | logs 不泄露 OSS secret/token | 日志脱敏 |
| SEC-007 | P1 | machine alias 非法字符 | 被校验或 slug，不能逃逸路径 |
| SEC-008 | P1 | shared promote 权限 | 只有授权用户/服务可 promote |

## 10. 性能与容量测试

| ID | 场景 | 数据量 | 指标 |
| --- | --- | --- | --- |
| PERF-001 | 首次 push 小 agent | 10 raw, 1 skill, 5 MB sqlite | <= 30s |
| PERF-002 | 首次 push 大 agent | 1000 raw, 10 skills, 200 MB sqlite | <= 5min |
| PERF-003 | 二次无变化 push | 同 PERF-002 | <= 2min，raw/skill 上传数接近 0，vector 可按策略上传或 hash 短路 |
| PERF-004 | 并发 push 同 machine 5 agents | 每 agent 50 MB sqlite | 无 SSH pool exhaustion |
| PERF-005 | mini-claw cold cache | 50 MB sqlite + 5 skill manifest | <= 30s |
| PERF-006 | mini-claw warm cache | hash 命中 | <= 300ms cache check |
| PERF-007 | `search_memory` | 10k chunks | p95 <= 2s |
| PERF-008 | FTS-only 降级 | 10k chunks | p95 <= 1s |

## 11. 可观测性验收

### 11.1 clawconsole 日志字段

每次 push 至少记录：
- `machineId`
- `machineAlias`
- `sourceAgentId`
- `agentKey`
- `step`
- `rawUploaded/rawSkipped/rawDeleted`
- `skillsUploaded`
- `vectorSha256`
- `skillManifestSha256`
- `durationMs`
- `webhookStatus`

### 11.2 平台日志字段

- `agent_key`
- `vector_sha256`
- `skill_manifest_sha256`
- `source_machine_alias`
- `request_id`
- 是否触发旧 rebuild 函数，期望为 false。

### 11.3 mini-claw 日志字段

- `agent_key`
- `cache_hit/cache_miss`
- `remote_sha/local_sha`
- `download_bytes`
- `sqlite_vec_enabled`
- `fts_only`
- `tool_name`
- `search_latency_ms`
- 降级原因。

### 11.4 指标建议

- `openclaw_distill_push_total{status}`
- `openclaw_distill_push_duration_seconds`
- `openclaw_distill_oss_upload_bytes_total`
- `openclaw_distill_webhook_total{status}`
- `mini_claw_agent_cache_sync_total{status}`
- `mini_claw_memory_search_duration_seconds{mode=vec|fts|hybrid}`
- `mini_claw_skill_read_total{source=cache|oss|db_fallback}`

## 12. CI/CD 策略

### 12.1 每个 PR 必跑

- clawconsole:
  - `npm test`
  - `cd backend && npm run build`
  - `cd backend && npm run test:run`
  - 新增 distill-push unit tests。
- platform:
  - pytest unit tests。
  - alembic migration up/down test。
  - webhook contract test。
- mini-claw:
  - pytest unit tests。
  - sqlite-vec import/load smoke test。
  - tool schema snapshot test。

### 12.2 合并前必跑

- 跨服务 contract tests。
- 本地 MinIO + mock SSH integration。
- E2E-001、E2E-002、E2E-004。

### 12.3 发布前必跑

- 真实 OSS staging E2E 全套。
- PERF-001 到 PERF-006。
- 灰度双写和回滚演练。
- 安全测试 SEC-001 到 SEC-004。

## 13. Rollout 阶段验收

### 阶段 1：平台接收侧

范围：
- DB schema migration。
- `agent_skill_oss_service.py`。
- webhook 只更新 metadata。
- routes 注入修复。

验收：
- PF-U 全部 P0 通过。
- CT-003、CT-005、CT-006 通过。
- 旧 distill-bundle fallback smoke test 通过。
- 明确证明 rebuild TOC/digest 未被新入口调用。

### 阶段 2：clawconsole OSS 直推双写

范围：
- OSS client。
- push orchestrator。
- machine alias。
- webhook 调用。

验收：
- CC-U、CC-I P0 通过。
- E2E-001 在 staging 通过。
- 同一 agent 连续 push 3 次 hash 稳定。
- 关闭 webhook 或 OSS 可得到可重试失败，不产生假成功。

### 阶段 3：mini-claw 本地缓存和工具

范围：
- agent cache。
- sqlite-vec/FTS search。
- skill lazy read。
- prompt 改造。

验收：
- MC-U P0 通过。
- E2E-001、E2E-002、E2E-004 通过。
- 先 FTS-only，再 hybrid search 验证。
- prompt snapshot 中不再出现旧 memory digest/index。

### 阶段 4：数据迁移与下线主流程

范围：
- 回填现有 OpenClaw skills owner。
- 上传历史 skills/raw/vector 到 OSS。
- 老 distill-bundle 从主路径下线。

验收：
- skills owner 回填审计报告无孤儿异常，无法归属项进入 shared。
- 历史 agent 抽样 20% 完整 E2E 通过。
- fallback 开关保留并演练成功。
- 旧 `index.json/index.md/core_digest.md` 遗留产物清理有 dry-run 和实际执行记录。

## 14. 手工验收清单

| 检查项 | 通过标准 |
| --- | --- |
| OSS 浏览器查看 agent scope | raw/skills/vector 三类对象齐全 |
| 平台 Hub 查看 agent | vector meta、source machine alias、skill manifest sha 显示正确 |
| mini-claw 首次打开 agent | cache 目录被创建，日志显示 cache miss + sync success |
| mini-claw 二次打开 agent | 日志显示 cache hit，不重复下载 sqlite |
| 用户提问 memory 内容 | 模型通过 `search_memory` 命中目标，并可 `read_agent_memory` 展开 |
| 用户要求使用 skill | 模型能看到 skill metadata，并按需 `read_skill` |
| OSS 断网 | mini-claw 对 warm cache 可继续运行 |
| webhook 断开 | clawconsole 返回失败，可重新执行 push |

## 15. 风险与专项验证

| 风险 | 影响 | 专项测试 |
| --- | --- | --- |
| sqlite snapshot 不一致 | memory search 返回旧数据或损坏 | WAL 写入后 snapshot 校验 |
| skill manifest hash 算法两端不一致 | 平台和 mini-claw 反复下载 | contract test 固化 canonical JSON/hash |
| alias 冲突 | agent scope 覆盖 | DB unique + 平台重复 agent_key 防护 |
| raw path escaping 不一致 | read memory 找不到文件 | 中文/特殊字符路径 E2E |
| vector 维度不匹配 | vec 查询失败 | meta dim 与 embedding 维度负例 |
| webhook 成功早于 OSS 完整上传 | 平台读取半状态 | webhook 必须最后一步，失败注入测试 |
| cache 半写 | 下次读取损坏 sqlite | tmp file + atomic rename 测试 |
| 旧 prompt 残留 | 模型依赖 digest/index | prompt snapshot test |

## 16. 建议新增自动化测试文件

### clawconsole

- `backend/tests/unit/distill-push/knowledge-hub-paths.test.ts`
- `backend/tests/unit/distill-push/oss-client.test.ts`
- `backend/tests/unit/distill-push/distill-push.service.test.ts`
- `backend/tests/unit/distill-push/distill-push.routes.test.ts`
- `backend/tests/unit/machines/machine-alias.test.ts`
- `backend/tests/integration/distill-push/oss-direct-push.test.ts`

### platform

- `tests/unit/services/test_openclaw_sync_completed.py`
- `tests/unit/services/test_agent_skill_oss_service.py`
- `tests/unit/routes/test_mini_claw_agent_key_configurable.py`
- `tests/migrations/test_skill_owner_scope_migration.py`
- `tests/contracts/test_knowledge_hub_schemas.py`

### mini-claw

- `tests/unit/services/test_agent_cache.py`
- `tests/unit/tools/test_memory_search.py`
- `tests/unit/tools/test_agent_memory_read.py`
- `tests/unit/tools/test_skill_tools.py`
- `tests/unit/test_system_prompt_snapshot.py`
- `tests/e2e/test_agent_oss_cache_runtime.py`

## 17. Definition of Done

该改造可以进入生产灰度的最低完成标准：

1. 所有 P0 单元、集成、契约、E2E 测试通过。
2. staging 使用真实 OSS 完成至少 3 个 agent 的首次同步、增量同步、降级演练。
3. mini-claw 能在 cold cache 和 warm cache 下稳定回答依赖 memory/skill 的问题。
4. 平台和 mini-claw 均不依赖新生成的 TOC/digest。
5. rollback runbook 已演练，旧 distill-bundle fallback 可恢复服务。
6. 监控指标和结构化日志能定位任一失败发生在哪个 agent、哪个 step、哪个 OSS key。

