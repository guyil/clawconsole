import { useState } from "react";

const COLORS = {
  bg: "#0F1117",
  sidebar: "#151720",
  card: "#1A1D2B",
  cardHover: "#1E2235",
  primary: "#6C5CE7",
  primaryLight: "#A29BFE",
  accent: "#FF6B35",
  success: "#00D68F",
  warning: "#FFB800",
  danger: "#FF4757",
  text: "#E4E6EF",
  textMuted: "#7B7F95",
  border: "#2A2D3E",
  inputBg: "#12141E",
};

const NAV_ITEMS = [
  { id: "dashboard", label: "仪表盘", icon: "◉" },
  { id: "bots", label: "Bot 管理", icon: "◈" },
  { id: "skills", label: "Skills 中心", icon: "⬡" },
  { id: "workflow", label: "工作流", icon: "◇" },
  { id: "tasks", label: "任务中心", icon: "▣" },
  { id: "data", label: "数据接口", icon: "⬢" },
  { id: "docs", label: "文档中心", icon: "▤" },
  { id: "settings", label: "系统设置", icon: "⚙" },
];

const BOTS = [
  { name: "客服助手", status: "running", sessions: 142, tasks: 38, skills: 12, channel: "飞书", dept: "客服部" },
  { name: "营销分析师", status: "running", sessions: 67, tasks: 15, skills: 8, channel: "Slack", dept: "市场部" },
  { name: "研发助手", status: "running", sessions: 203, tasks: 56, skills: 22, channel: "Discord", dept: "技术部" },
  { name: "HR 小蜜", status: "paused", sessions: 0, tasks: 3, skills: 6, channel: "企业微信", dept: "人事部" },
  { name: "数据报表", status: "running", sessions: 31, tasks: 89, skills: 10, channel: "钉钉", dept: "运营部" },
  { name: "合规审核", status: "error", sessions: 0, tasks: 2, skills: 5, channel: "Telegram", dept: "法务部" },
];

const SKILLS_LIST = [
  { name: "gmail-reader", cat: "通信", status: "已审核", installs: 234, security: "安全" },
  { name: "notion-sync", cat: "效率", status: "已审核", installs: 187, security: "安全" },
  { name: "web-scraper", cat: "数据", status: "审核中", installs: 0, security: "待检测" },
  { name: "calendar-mgr", cat: "效率", status: "已审核", installs: 312, security: "安全" },
  { name: "sentry-monitor", cat: "DevOps", status: "已审核", installs: 89, security: "安全" },
  { name: "custom-report", cat: "报表", status: "已审核", installs: 156, security: "安全" },
  { name: "slack-bot", cat: "通信", status: "已拒绝", installs: 0, security: "风险" },
  { name: "feishu-webhook", cat: "通信", status: "已审核", installs: 201, security: "安全" },
];

const TASKS = [
  { name: "生成周报摘要", bot: "营销分析师", status: "completed", time: "14:23" },
  { name: "处理客户工单 #4521", bot: "客服助手", status: "running", time: "14:31" },
  { name: "代码审查 PR #892", bot: "研发助手", status: "running", time: "14:28" },
  { name: "新员工入职材料生成", bot: "HR 小蜜", status: "pending", time: "--" },
  { name: "竞品数据采集", bot: "数据报表", status: "completed", time: "13:45" },
  { name: "合规文件检查", bot: "合规审核", status: "failed", time: "14:02" },
  { name: "客户满意度分析", bot: "客服助手", status: "completed", time: "12:30" },
  { name: "SEO 关键词报告", bot: "营销分析师", status: "pending", time: "--" },
];

const INTERFACES = [
  { name: "飞书 Open API", type: "OAuth2", status: "connected", calls: "1.2k/day" },
  { name: "企业微信 API", type: "Token", status: "connected", calls: "890/day" },
  { name: "Notion API", type: "Bearer", status: "connected", calls: "456/day" },
  { name: "Jira Cloud", type: "OAuth2", status: "expired", calls: "0/day" },
  { name: "GitHub API", type: "PAT", status: "connected", calls: "2.3k/day" },
  { name: "Sentry API", type: "DSN", status: "connected", calls: "340/day" },
];

function StatusDot({ status }) {
  const colors = { running: COLORS.success, paused: COLORS.warning, error: COLORS.danger, connected: COLORS.success, expired: COLORS.danger };
  return (
    <span style={{
      display: "inline-block", width: 8, height: 8, borderRadius: "50%",
      backgroundColor: colors[status] || COLORS.textMuted,
      boxShadow: status === "running" || status === "connected" ? `0 0 8px ${colors[status]}40` : "none",
      animation: status === "running" ? "pulse 2s infinite" : "none",
    }} />
  );
}

function StatCard({ label, value, change, color }) {
  return (
    <div style={{
      background: COLORS.card, borderRadius: 12, padding: "20px 24px",
      border: `1px solid ${COLORS.border}`, flex: 1, minWidth: 160,
    }}>
      <div style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || COLORS.text, letterSpacing: -1 }}>{value}</div>
      {change && <div style={{ fontSize: 12, color: change > 0 ? COLORS.success : COLORS.danger, marginTop: 4 }}>
        {change > 0 ? "↑" : "↓"} {Math.abs(change)}% vs 昨日
      </div>}
    </div>
  );
}

function DashboardPage() {
  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
        <StatCard label="活跃 Bot" value="5" change={12} color={COLORS.success} />
        <StatCard label="今日任务" value="89" change={23} color={COLORS.primaryLight} />
        <StatCard label="Skills 总数" value="63" change={5} />
        <StatCard label="接口调用" value="5.2k" change={-3} color={COLORS.warning} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div style={{ background: COLORS.card, borderRadius: 12, padding: 24, border: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.text, marginBottom: 16 }}>Bot 状态概览</div>
          {BOTS.map((bot, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "10px 0", borderBottom: i < BOTS.length - 1 ? `1px solid ${COLORS.border}` : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <StatusDot status={bot.status} />
                <span style={{ color: COLORS.text, fontSize: 14 }}>{bot.name}</span>
                <span style={{ color: COLORS.textMuted, fontSize: 12 }}>{bot.dept}</span>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 12, color: COLORS.textMuted }}>
                <span>{bot.sessions} 会话</span>
                <span>{bot.tasks} 任务</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ background: COLORS.card, borderRadius: 12, padding: 24, border: `1px solid ${COLORS.border}` }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.text, marginBottom: 16 }}>实时任务流</div>
          {TASKS.slice(0, 6).map((task, i) => {
            const statusMap = { completed: { label: "已完成", color: COLORS.success }, running: { label: "执行中", color: COLORS.primary }, pending: { label: "待执行", color: COLORS.warning }, failed: { label: "失败", color: COLORS.danger } };
            const s = statusMap[task.status];
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "10px 0", borderBottom: i < 5 ? `1px solid ${COLORS.border}` : "none",
              }}>
                <div>
                  <div style={{ color: COLORS.text, fontSize: 14 }}>{task.name}</div>
                  <div style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>{task.bot} · {task.time}</div>
                </div>
                <span style={{
                  fontSize: 11, padding: "3px 10px", borderRadius: 12,
                  background: `${s.color}15`, color: s.color, fontWeight: 500,
                }}>{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BotsPage() {
  const [selected, setSelected] = useState(null);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: COLORS.textMuted }}>共 {BOTS.length} 个 Bot 实例</div>
        <button style={{
          background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryLight})`,
          color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px",
          cursor: "pointer", fontWeight: 600, fontSize: 14,
        }}>+ 新建 Bot</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {BOTS.map((bot, i) => (
          <div key={i} onClick={() => setSelected(i === selected ? null : i)} style={{
            background: selected === i ? COLORS.cardHover : COLORS.card,
            borderRadius: 14, padding: 20, cursor: "pointer",
            border: `1px solid ${selected === i ? COLORS.primary : COLORS.border}`,
            transition: "all 0.2s",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: `linear-gradient(135deg, ${COLORS.primary}40, ${COLORS.accent}40)`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 16,
                }}>🦞</div>
                <div>
                  <div style={{ color: COLORS.text, fontWeight: 600, fontSize: 15 }}>{bot.name}</div>
                  <div style={{ color: COLORS.textMuted, fontSize: 12 }}>{bot.dept}</div>
                </div>
              </div>
              <StatusDot status={bot.status} />
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {[
                { label: "渠道", value: bot.channel },
                { label: "Skills", value: bot.skills },
                { label: "会话", value: bot.sessions },
                { label: "任务", value: bot.tasks },
              ].map((s, j) => (
                <div key={j} style={{ flex: 1, minWidth: 60, textAlign: "center", padding: "8px 0", background: COLORS.inputBg, borderRadius: 8 }}>
                  <div style={{ color: COLORS.textMuted, fontSize: 11 }}>{s.label}</div>
                  <div style={{ color: COLORS.text, fontWeight: 600, fontSize: 14, marginTop: 2 }}>{s.value}</div>
                </div>
              ))}
            </div>
            {selected === i && (
              <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                {["配置 Skills", "编辑人设", "查看日志", "暂停"].map((action, j) => (
                  <button key={j} style={{
                    flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 12, cursor: "pointer",
                    background: j === 0 ? COLORS.primary : "transparent",
                    color: j === 0 ? "#fff" : COLORS.textMuted,
                    border: j === 0 ? "none" : `1px solid ${COLORS.border}`,
                  }}>{action}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillsPage() {
  const [filter, setFilter] = useState("all");
  const cats = ["all", "通信", "效率", "数据", "DevOps", "报表"];
  const filtered = filter === "all" ? SKILLS_LIST : SKILLS_LIST.filter(s => s.cat === filter);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {cats.map(c => (
          <button key={c} onClick={() => setFilter(c)} style={{
            padding: "6px 16px", borderRadius: 20, fontSize: 13, cursor: "pointer",
            background: filter === c ? COLORS.primary : COLORS.card,
            color: filter === c ? "#fff" : COLORS.textMuted,
            border: `1px solid ${filter === c ? COLORS.primary : COLORS.border}`,
          }}>{c === "all" ? "全部" : c}</button>
        ))}
      </div>
      <div style={{ background: COLORS.card, borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.5fr", padding: "12px 20px", background: COLORS.inputBg }}>
          {["Skill 名称", "分类", "状态", "安装数", "安全", "操作"].map(h => (
            <span key={h} style={{ color: COLORS.textMuted, fontSize: 12, fontWeight: 600 }}>{h}</span>
          ))}
        </div>
        {filtered.map((skill, i) => {
          const statusColors = { "已审核": COLORS.success, "审核中": COLORS.warning, "已拒绝": COLORS.danger };
          const secColors = { "安全": COLORS.success, "待检测": COLORS.warning, "风险": COLORS.danger };
          return (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.5fr", padding: "14px 20px",
              borderBottom: `1px solid ${COLORS.border}`, alignItems: "center",
            }}>
              <span style={{ color: COLORS.text, fontWeight: 500, fontSize: 14 }}>⬡ {skill.name}</span>
              <span style={{ color: COLORS.textMuted, fontSize: 13 }}>{skill.cat}</span>
              <span style={{ color: statusColors[skill.status], fontSize: 13 }}>{skill.status}</span>
              <span style={{ color: COLORS.textMuted, fontSize: 13 }}>{skill.installs}</span>
              <span style={{
                fontSize: 11, padding: "2px 10px", borderRadius: 10, display: "inline-block", width: "fit-content",
                background: `${secColors[skill.security]}15`, color: secColors[skill.security],
              }}>{skill.security}</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button style={{
                  padding: "4px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                  background: skill.status === "已审核" ? COLORS.primary : "transparent",
                  color: skill.status === "已审核" ? "#fff" : COLORS.textMuted,
                  border: skill.status === "已审核" ? "none" : `1px solid ${COLORS.border}`,
                }}>{skill.status === "已审核" ? "分发" : "审核"}</button>
                <button style={{
                  padding: "4px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                  background: "transparent", color: COLORS.textMuted, border: `1px solid ${COLORS.border}`,
                }}>详情</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowPage() {
  const nodes = [
    { id: 1, label: "Webhook 触发", type: "trigger", x: 60, y: 80 },
    { id: 2, label: "LLM 内容分析", type: "llm", x: 280, y: 80 },
    { id: 3, label: "条件判断", type: "condition", x: 480, y: 80 },
    { id: 4, label: "发送飞书通知", type: "action", x: 660, y: 20 },
    { id: 5, label: "创建工单", type: "action", x: 660, y: 140 },
  ];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 8 }}>
          {["客服自动回复流", "内容审核流", "数据报表生成流"].map((name, i) => (
            <button key={i} style={{
              padding: "6px 16px", borderRadius: 8, fontSize: 13, cursor: "pointer",
              background: i === 0 ? COLORS.primary : COLORS.card,
              color: i === 0 ? "#fff" : COLORS.textMuted,
              border: `1px solid ${i === 0 ? COLORS.primary : COLORS.border}`,
            }}>{name}</button>
          ))}
        </div>
        <button style={{
          background: COLORS.success, color: "#fff", border: "none",
          borderRadius: 8, padding: "8px 20px", cursor: "pointer", fontWeight: 600, fontSize: 13,
        }}>▶ 模拟运行</button>
      </div>
      <div style={{
        background: COLORS.card, borderRadius: 14, border: `1px solid ${COLORS.border}`,
        padding: 30, minHeight: 260, position: "relative", overflow: "hidden",
      }}>
        <div style={{
          position: "absolute", inset: 0, opacity: 0.03,
          backgroundImage: `radial-gradient(${COLORS.textMuted} 1px, transparent 1px)`,
          backgroundSize: "20px 20px",
        }} />
        <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill={COLORS.primary} opacity="0.6" />
            </marker>
          </defs>
          <line x1="220" y1="106" x2="278" y2="106" stroke={COLORS.primary} strokeWidth="2" opacity="0.4" markerEnd="url(#arrow)" />
          <line x1="420" y1="106" x2="478" y2="106" stroke={COLORS.primary} strokeWidth="2" opacity="0.4" markerEnd="url(#arrow)" />
          <line x1="580" y1="92" x2="658" y2="52" stroke={COLORS.success} strokeWidth="2" opacity="0.4" markerEnd="url(#arrow)" />
          <line x1="580" y1="118" x2="658" y2="162" stroke={COLORS.warning} strokeWidth="2" opacity="0.4" markerEnd="url(#arrow)" />
        </svg>
        {nodes.map(n => {
          const typeStyles = {
            trigger: { bg: `${COLORS.accent}20`, border: COLORS.accent, icon: "⚡" },
            llm: { bg: `${COLORS.primary}20`, border: COLORS.primary, icon: "🧠" },
            condition: { bg: `${COLORS.warning}20`, border: COLORS.warning, icon: "◇" },
            action: { bg: `${COLORS.success}20`, border: COLORS.success, icon: "→" },
          };
          const st = typeStyles[n.type];
          return (
            <div key={n.id} style={{
              position: "absolute", left: n.x, top: n.y,
              background: st.bg, border: `1.5px solid ${st.border}`,
              borderRadius: 10, padding: "10px 16px", minWidth: 130,
              cursor: "grab", zIndex: 1,
            }}>
              <span style={{ fontSize: 14, marginRight: 6 }}>{st.icon}</span>
              <span style={{ color: COLORS.text, fontSize: 13, fontWeight: 500 }}>{n.label}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
        {["⚡ 触发器", "🧠 LLM 处理", "◇ 条件分支", "→ 动作", "⏸ 人工审批", "⟳ 循环"].map((n, i) => (
          <div key={i} style={{
            background: COLORS.card, border: `1px dashed ${COLORS.border}`,
            borderRadius: 8, padding: "8px 16px", fontSize: 13, color: COLORS.textMuted, cursor: "grab",
          }}>{n}</div>
        ))}
      </div>
    </div>
  );
}

function TasksPage() {
  const [tab, setTab] = useState("all");
  const tabs = [
    { id: "all", label: "全部", count: TASKS.length },
    { id: "running", label: "执行中", count: TASKS.filter(t => t.status === "running").length },
    { id: "completed", label: "已完成", count: TASKS.filter(t => t.status === "completed").length },
    { id: "failed", label: "异常", count: TASKS.filter(t => t.status === "failed").length },
  ];
  const filtered = tab === "all" ? TASKS : TASKS.filter(t => t.status === tab);
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 20, background: COLORS.card, borderRadius: 10, padding: 4, width: "fit-content" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "8px 18px", borderRadius: 8, fontSize: 13, cursor: "pointer", border: "none",
            background: tab === t.id ? COLORS.primary : "transparent",
            color: tab === t.id ? "#fff" : COLORS.textMuted, fontWeight: tab === t.id ? 600 : 400,
          }}>{t.label} ({t.count})</button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map((task, i) => {
          const statusMap = {
            completed: { label: "✓ 已完成", color: COLORS.success, bg: `${COLORS.success}10` },
            running: { label: "● 执行中", color: COLORS.primary, bg: `${COLORS.primary}10` },
            pending: { label: "○ 待执行", color: COLORS.warning, bg: `${COLORS.warning}10` },
            failed: { label: "✕ 失败", color: COLORS.danger, bg: `${COLORS.danger}10` },
          };
          const s = statusMap[task.status];
          return (
            <div key={i} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              background: COLORS.card, borderRadius: 10, padding: "14px 20px",
              border: `1px solid ${COLORS.border}`, cursor: "pointer",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ color: s.color, fontSize: 14 }}>{s.label.charAt(0)}</span>
                <div>
                  <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 500 }}>{task.name}</div>
                  <div style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>{task.bot}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ color: COLORS.textMuted, fontSize: 12 }}>{task.time}</span>
                <span style={{
                  fontSize: 12, padding: "3px 12px", borderRadius: 12,
                  background: s.bg, color: s.color, fontWeight: 500,
                }}>{s.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DataPage() {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: COLORS.textMuted }}>共 {INTERFACES.length} 个接口</div>
        <button style={{
          background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.primaryLight})`,
          color: "#fff", border: "none", borderRadius: 8, padding: "8px 20px",
          cursor: "pointer", fontWeight: 600, fontSize: 14,
        }}>+ 新建接口</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {INTERFACES.map((iface, i) => (
          <div key={i} style={{
            background: COLORS.card, borderRadius: 14, padding: 20,
            border: `1px solid ${COLORS.border}`,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ color: COLORS.text, fontWeight: 600, fontSize: 15 }}>{iface.name}</span>
              <StatusDot status={iface.status} />
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1, padding: "8px 12px", background: COLORS.inputBg, borderRadius: 8, textAlign: "center" }}>
                <div style={{ color: COLORS.textMuted, fontSize: 11 }}>类型</div>
                <div style={{ color: COLORS.primaryLight, fontSize: 13, fontWeight: 500, marginTop: 2 }}>{iface.type}</div>
              </div>
              <div style={{ flex: 1, padding: "8px 12px", background: COLORS.inputBg, borderRadius: 8, textAlign: "center" }}>
                <div style={{ color: COLORS.textMuted, fontSize: 11 }}>调用量</div>
                <div style={{ color: COLORS.text, fontSize: 13, fontWeight: 500, marginTop: 2 }}>{iface.calls}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
              <button style={{
                flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 12,
                cursor: "pointer", background: "transparent",
                color: COLORS.textMuted, border: `1px solid ${COLORS.border}`,
              }}>测试连接</button>
              <button style={{
                flex: 1, padding: "6px 0", borderRadius: 6, fontSize: 12,
                cursor: "pointer", background: "transparent",
                color: COLORS.textMuted, border: `1px solid ${COLORS.border}`,
              }}>配置</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocsPage() {
  const docs = [
    { name: "Q1 营销周报汇总.pdf", bot: "营销分析师", time: "2 小时前", size: "2.4MB" },
    { name: "客户满意度分析报告.docx", bot: "客服助手", time: "5 小时前", size: "1.8MB" },
    { name: "竞品技术对比分析.md", bot: "研发助手", time: "1 天前", size: "890KB" },
    { name: "新员工手册草稿.docx", bot: "HR 小蜜", time: "2 天前", size: "3.2MB" },
    { name: "数据库性能报告.html", bot: "数据报表", time: "3 天前", size: "1.1MB" },
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <StatCard label="本周文档" value="23" color={COLORS.primaryLight} />
        <StatCard label="待审核" value="5" color={COLORS.warning} />
        <StatCard label="总存储" value="1.2GB" />
      </div>
      <div style={{ background: COLORS.card, borderRadius: 12, border: `1px solid ${COLORS.border}`, overflow: "hidden" }}>
        {docs.map((doc, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "14px 20px", borderBottom: i < docs.length - 1 ? `1px solid ${COLORS.border}` : "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 20 }}>📄</span>
              <div>
                <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 500 }}>{doc.name}</div>
                <div style={{ color: COLORS.textMuted, fontSize: 12, marginTop: 2 }}>由 {doc.bot} 生成 · {doc.time}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <span style={{ color: COLORS.textMuted, fontSize: 12 }}>{doc.size}</span>
              <button style={{
                padding: "4px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer",
                background: "transparent", color: COLORS.primaryLight, border: `1px solid ${COLORS.primary}40`,
              }}>查看</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const PAGE_MAP = {
  dashboard: DashboardPage,
  bots: BotsPage,
  skills: SkillsPage,
  workflow: WorkflowPage,
  tasks: TasksPage,
  data: DataPage,
  docs: DocsPage,
};

const PAGE_TITLES = {
  dashboard: "仪表盘",
  bots: "Bot 管理",
  skills: "Skills 中心",
  workflow: "工作流编排",
  tasks: "任务中心",
  data: "数据接口配置",
  docs: "文档中心",
  settings: "系统设置",
};

export default function ClawConsole() {
  const [page, setPage] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const PageComponent = PAGE_MAP[page] || DashboardPage;

  return (
    <div style={{ display: "flex", height: "100vh", background: COLORS.bg, fontFamily: "'SF Pro Display', -apple-system, sans-serif", overflow: "hidden" }}>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-thumb { background: ${COLORS.border}; border-radius: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
      `}</style>
      
      {/* Sidebar */}
      <div style={{
        width: collapsed ? 64 : 220, background: COLORS.sidebar,
        borderRight: `1px solid ${COLORS.border}`, display: "flex", flexDirection: "column",
        transition: "width 0.25s ease", flexShrink: 0,
      }}>
        <div style={{
          padding: collapsed ? "20px 12px" : "20px 20px",
          borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
        }}>
          {!collapsed && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>🦞</span>
              <span style={{ color: COLORS.text, fontWeight: 700, fontSize: 16, letterSpacing: -0.5 }}>ClawConsole</span>
            </div>
          )}
          {collapsed && <span style={{ fontSize: 22 }}>🦞</span>}
          <button onClick={() => setCollapsed(!collapsed)} style={{
            background: "transparent", border: "none", color: COLORS.textMuted,
            cursor: "pointer", fontSize: 16, display: collapsed ? "none" : "block",
          }}>◀</button>
        </div>
        <nav style={{ flex: 1, padding: "12px 8px" }}>
          {NAV_ITEMS.map(item => (
            <button key={item.id} onClick={() => setPage(item.id)} style={{
              display: "flex", alignItems: "center", gap: 12, width: "100%",
              padding: collapsed ? "12px 0" : "10px 14px", borderRadius: 8, border: "none",
              background: page === item.id ? `${COLORS.primary}20` : "transparent",
              color: page === item.id ? COLORS.primaryLight : COLORS.textMuted,
              cursor: "pointer", fontSize: 14, fontWeight: page === item.id ? 600 : 400,
              justifyContent: collapsed ? "center" : "flex-start",
              marginBottom: 2, transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 16, width: 20, textAlign: "center" }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        {!collapsed && (
          <div style={{ padding: "16px 20px", borderTop: `1px solid ${COLORS.border}`, fontSize: 11, color: COLORS.textMuted }}>
            OpenClaw Enterprise v1.0
          </div>
        )}
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <header style={{
          padding: "16px 28px", borderBottom: `1px solid ${COLORS.border}`,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          background: COLORS.sidebar,
        }}>
          <div>
            <h1 style={{ color: COLORS.text, fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>
              {PAGE_TITLES[page]}
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{
              padding: "6px 14px", borderRadius: 8, background: `${COLORS.success}15`,
              color: COLORS.success, fontSize: 12, fontWeight: 500,
            }}>● Gateway 在线</div>
            <div style={{
              width: 34, height: 34, borderRadius: "50%",
              background: `linear-gradient(135deg, ${COLORS.primary}, ${COLORS.accent})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 13, fontWeight: 600,
            }}>A</div>
          </div>
        </header>
        <main style={{ flex: 1, overflow: "auto", padding: 28 }}>
          <PageComponent />
        </main>
      </div>
    </div>
  );
}
