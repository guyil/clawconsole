# ClawConsole — OpenClaw Enterprise Management Platform

> **Your AI Bots are scattered across 10 servers, and every config change requires SSH-ing 10 times?**
>
> ClawConsole lets you manage all your Bots from a single interface — instant config delivery, one-click skill distribution, zero-disk credential transfer, no command line needed.

ClawConsole is the **enterprise-grade control console** for the [OpenClaw](https://github.com/openclaw/openclaw) ecosystem. When your AI Agents scale from 1 to 10 and deployments expand from 1 machine to N, ClawConsole is the central hub that reduces management complexity to zero — connecting all nodes via Tailscale's zero-trust network and turning a scattered Bot cluster into a clear, controllable operation.

---

## Why ClawConsole?

| Without ClawConsole | With ClawConsole |
|---|---|
| Editing a Bot persona requires SSH + vim, with no backup if you make a mistake | Web-based editor with automatic version control, one-click sync to remote |
| New skill? Manually copy SKILL.md to each machine one by one | Centralized skill catalog with review workflow, one-click distribution to 50 machines |
| API Keys stored in plaintext on servers, handoff relies on word of mouth | AES-256 encrypted storage, direct SSH pipe transfer, never touches disk |
| A Bot crashes on one machine, you only find out from user complaints the next day | 60-second health checks, real-time status alerts pushed to dashboard |
| Want to know what your Bot discussed today? Dig through log files | Session inspector panel with real-time view of every Agent's conversations |
| Unsure if a new skill has security risks before going live | Built-in security scanner + Playground sandbox testing before deployment |

---

## Core Capabilities

### 1. Multi-Machine Cluster, Single-Screen Control

> **Scenario**: You have servers in Beijing, Shanghai, and Shenzhen running OpenClaw Bots for customer service, marketing, and engineering departments.

- Open the ClawConsole dashboard to see online status, Agent count, and recent sync results for all machines at a glance
- New machines are auto-discovered when they join the Tailscale network — click "Register" to bring them under management
- Four-layer health checks run every 60 seconds (network reachability -> SSH access -> OpenClaw version -> Gateway status), with instant alerts on any anomaly
- **All communication travels through Tailscale WireGuard tunnels — no public ports needed**, approved by your security team

### 2. Smart Sync, No More Manual Deployments

> **Scenario**: The operations team adjusted a customer service Bot's response style in the Console and needs to push changes to 3 production machines.

- Edit Bot persona files in the web interface, click "Sync"
- The sync engine automatically performs **Pull-Before-Push**: fetches the latest remote state, compares SHA-256 fingerprints, then pushes changes
- If a colleague just modified the same file on a remote machine, the system **intelligently identifies conflict types** and suggests resolutions
- Three-tier sync modes adapt to the situation:
  - **Hot**: Changed only one config file? Sub-second SCP direct transfer, no restart needed
  - **Warm**: Batch file changes? rsync incremental sync + automatic Gateway restart
  - **Cold**: Major version upgrade? Full sync + dependency update, all in one step
- Network hiccup caused a file transfer to fail? The **automatic retry queue** handles it silently in the background (up to 3 attempts)

### 3. Skill Store, End-to-End from Development to Production

> **Scenario**: The engineering team built a "Jira Ticket Auto-Handler" skill that needs security review before distribution to 5 Agents in the engineering department.

- **Import**: Supports GitHub URL, ClawHub community page, or direct SKILL.md paste
- **Review**: Built-in security scanning engine that auto-detects 6 risk categories including shell injection, eval execution, sensitive path traversal, and environment variable leaks
- **Sandbox Testing (Playground)**: Test skill behavior in an isolated sandbox before going live
  - ReAct Agent powered by Claude + LangGraph with multi-turn conversation and tool calling support
  - Sandbox allows file read/write, content search, and web scraping, with **path traversal protection to prevent privilege escalation**
  - SSE streaming output lets you watch every step of the AI's reasoning and tool invocations in real time
  - Built-in templates for Code Review, Data Analysis, DevOps Assistant, and more — start testing in 30 seconds
- **Distribution**: One-click batch deployment to specified machines and Agents after review approval
- **Version Management**: Automatic version snapshots on every change, rollback to any historical version at any time

### 4. Credential Vault, Paranoid-Level Security

> **Scenario**: Your company's Feishu API Token, OpenAI API Key, and database passwords are scattered across servers, and security audits are always a headache.

- All credentials stored with **AES-256-GCM** encryption in the database — even a database breach won't expose them
- When syncing to remote machines, credentials are **written directly to target files via SSH pipe** (`chmod 0600`), with no temporary files generated and no intermediate state on disk
- A single operation syncs the same set of credentials to multiple target machines, ensuring all nodes use the latest keys
- Employee leaving? Rotate keys from the Console, and all machines update within 30 seconds

### 5. Real-Time Monitoring, Complete Bot Visibility

> **Scenario**: The CEO asks "How many conversations did our AI customer service handle today? Any errors?" — you need an answer in 10 seconds.

- **Dashboard**: Online machine count, active Agents, installed skills, sync history trends — data ready the moment you open it
- **Session Inspector**: Click into any Agent to view active sessions and complete conversation history in real time
- **Log Hub**: Scheduled collection of Gateway logs, command execution records, and config change audits from all machines
- **Real-Time Push**: WebSocket event bus pushes critical events — sync progress, machine disconnections, Agent anomalies — to your screen the instant they happen

### 6. File-Driven, Elegant Decoupling

> **Design Philosophy**: ClawConsole is not a "remote controller" — it's a "file steward."

Everything in OpenClaw — configuration, personas, skills, credentials — exists as files in each machine's `~/.openclaw/` directory. ClawConsole manages the **centralized storage and bidirectional sync** of these files, rather than directly manipulating Bot runtime processes.

This means:
- **Loose Coupling**: If ClawConsole goes down, Bots keep running; if a Bot crashes, ClawConsole data remains intact
- **Auditable**: Every file change is recorded — who changed what, and when, is always clear
- **Easy to Scale**: Adding a new node only requires joining the Tailscale network; Console auto-discovers and syncs configuration

---

## Use Cases

| Scenario | How to Use |
|------|--------|
| **Multi-Department Bot Management** | Customer service, marketing, and engineering each have dedicated Bots, all managed centrally in the Console |
| **Cross-Region Node Deployment** | Centralized Bot management across multiple data centers / multi-cloud environments, connected via Tailscale |
| **Skill Marketplace Operations** | Import skills from ClawHub / GitHub, distribute to internal Agents after security review |
| **Security & Compliance Requirements** | Encrypted credential storage + zero-disk transfer + operation audit logs, meeting compliance standards |
| **Bot Operations Automation** | Health checks + auto-sync + failure retry, reducing 90% of manual operations |
| **AI Skill R&D Testing** | Develop and test new skills in the Playground sandbox, deploy only after security verification |

---

## Architecture Overview

```
        ┌────────────────────────────────────────────┐
        │            ClawConsole Frontend              │
        │       React 19 · Vite · TailwindCSS          │
        │  Dashboard · Machines · Skill Store · Playground│
        └───────────────────┬────────────────────────┘
                            │ HTTP REST + WebSocket Real-Time Push
        ┌───────────────────▼────────────────────────┐
        │            ClawConsole Backend               │
        │         Fastify 5 · TypeScript               │
        ├─────────────┬──────────────────────────────┤
        │ Sync Engine │ LangGraph Agent (Claude)       │
        │ BullMQ Jobs │ Credential Vault (AES)         │
        │ File Parser │ Skill Catalog + Scanner        │
        ├─────────────┴──────────────────────────────┤
        │      MySQL 8        │       Redis 7          │
        │  Config · Files · Creds │ Cache · Queues · Events│
        └───────────────────┬────────────────────────┘
                            │ SSH over Tailscale (WireGuard)
             ┌──────────────┼──────────────┐
             ▼              ▼              ▼
       ┌───────────┐  ┌───────────┐  ┌───────────┐
       │ Beijing    │  │ Shanghai   │  │ Shenzhen   │
       │ CS Bot     │  │ Mktg Bot   │  │ Eng Bot    │
       │~/.openclaw │  │~/.openclaw │  │~/.openclaw │
       └───────────┘  └───────────┘  └───────────┘
```

---

## Project Structure

```
clawconsole/
├── docs/                          # Project documentation
│   ├── ARCHITECTURE.md           # System architecture overview
│   ├── DATABASE.md               # Database schema design
│   ├── SYNC-ENGINE.md            # Sync engine deep-dive
│   ├── FILE-CLASSIFICATION.md    # File classification rules
│   ├── API-REFERENCE.md          # API reference documentation
│   └── MODULE-MAP.md             # Module map & dependency rules
├── prd/                           # Product requirements documents
├── backend/                       # Backend application (Node.js + TypeScript)
│   ├── src/
│   │   ├── server.ts             # Application entry point
│   │   ├── config/               # Configuration loading
│   │   ├── shared/               # Shared utilities (DB, Redis, encryption, logging, errors)
│   │   ├── transport/            # SSH connection pool + Tailscale integration
│   │   ├── parsers/              # OpenClaw file parsers
│   │   ├── modules/              # Business modules
│   │   │   ├── machines/         # Machine management
│   │   │   ├── agents/           # Agent management
│   │   │   ├── files/            # File blob storage
│   │   │   ├── sync/             # Sync engine (core)
│   │   │   ├── credentials/      # Credential encryption management
│   │   │   └── skills/           # Skill catalog + distribution
│   │   ├── jobs/                 # BullMQ background jobs
│   │   └── websocket/            # WebSocket real-time events
│   └── tests/                     # Test files
└── frontend/                      # Frontend application (Vite + React + TypeScript)
    └── src/
        ├── api/                   # Axios API client layer
        ├── hooks/                 # React Query hooks
        ├── stores/                # Zustand state management (UI + WebSocket)
        ├── types/                 # TypeScript types (mirroring backend)
        ├── components/
        │   ├── layout/            # Layout: Sidebar, Header, AppLayout
        │   ├── ui/                # Common components: Button, Card, Modal, DataTable, etc.
        │   ├── machines/          # Machine management components
        │   ├── skills/            # Skills components
        │   ├── credentials/       # Credentials components
        │   └── sync/              # Sync status components
        └── pages/                 # Pages: Dashboard, Machines, Skills, etc.
```

## Prerequisites

- **Node.js** >= 20.0.0
- **MySQL** 8.0+
- **Redis** 7.x
- **Tailscale** (Console server must join a Tailnet)

## Quick Start

### 1. Install Dependencies

```bash
# Backend
cd backend && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Configure Environment Variables

Copy the example configuration and modify as needed:

```bash
cp .env.example .env
```

Key configuration options:

| Variable | Description | Default |
|------|------|--------|
| `PORT` | Server port | 3000 |
| `MYSQL_HOST` | MySQL host | 127.0.0.1 |
| `MYSQL_PORT` | MySQL port | 3306 |
| `MYSQL_USER` | MySQL username | clawconsole |
| `MYSQL_PASSWORD` | MySQL password | - |
| `MYSQL_DATABASE` | Database name | clawconsole |
| `REDIS_HOST` | Redis host | 127.0.0.1 |
| `REDIS_PORT` | Redis port | 6379 |
| `CREDENTIAL_ENCRYPTION_KEY` | AES-256 encryption key (64-char hex) | - |

### 3. Initialize the Database

Ensure MySQL is running, then create the database and run migrations:

```bash
# Create database (if not exists)
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS clawconsole CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# Run database migrations (creates 8 business tables)
npm run migrate
```

### 4. Start the Server

```bash
# Development mode (hot reload)
npm run dev

# Or build and start
npm run build
npm start
```

After the server starts:
- HTTP API: `http://localhost:3000/api`
- WebSocket: `ws://localhost:3000/ws`
- Health check: `http://localhost:3000/api/health`

### 5. Start the Frontend

```bash
cd frontend
npm run dev
```

The frontend dev server runs at `http://localhost:5173` and automatically proxies API requests to the backend.

## Available Scripts

### Backend (`backend/`)

| Command | Description |
|------|------|
| `npm run dev` | Start in development mode (tsx watch with hot reload) |
| `npm run build` | Compile TypeScript to dist/ |
| `npm start` | Start in production mode (requires build first) |
| `npm test` | Start vitest in watch mode |
| `npm run test:run` | Run all tests (single run) |
| `npm run lint` | ESLint code checking |
| `npm run migrate` | Run database migrations |
| `npm run migrate:rollback` | Rollback the most recent migration |

### Frontend (`frontend/`)

| Command | Description |
|------|------|
| `npm run dev` | Vite dev server (HMR, backend proxy) |
| `npm run build` | TypeScript check + production build |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint code checking |

## Generate Encryption Key

For `CREDENTIAL_ENCRYPTION_KEY` (AES-256-GCM credential encryption):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## API Overview

| Module | Endpoint Prefix | Description |
|------|----------|------|
| Machines | `/api/machines` | Tailscale node CRUD, health checks, structure discovery |
| Agents | `/api/agents` | Agent CRUD, status tracking |
| Files | `/api/files` | File blob read/write, dirty flag management |
| Sync Engine | `/api/machines/:id/sync` | Pull / Push / Full Sync / Plan preview |
| Credentials | `/api/credentials` | Encrypted credential CRUD, sync to remote machines |
| Skills | `/api/skills` | Skill catalog CRUD, review, Agent install/uninstall |
| WebSocket | `/ws` | Real-time sync progress, status change events |

For detailed API documentation, see [docs/API-REFERENCE.md](docs/API-REFERENCE.md).

## Testing

```bash
cd backend
npm run test:run
```

Currently 102 unit tests covering:
- File classifier (29 tests)
- Sync mode detector (13 tests)
- Diff engine (7 tests)
- Conflict resolver (8 tests)
- Markdown frontmatter parser (5 tests)
- WebSocket event system (5 tests)
- Credential service (13 tests)
- Skill service (22 tests)

## Tech Stack

| Component | Technology |
|------|------|
| Runtime | Node.js 20+ / TypeScript 5 |
| Web Framework | Fastify 5 |
| Database | MySQL 8 (Knex.js query builder) |
| Cache / Queue | Redis 7 (ioredis + BullMQ) |
| AI Engine | LangGraph + ChatAnthropic (Claude) |
| SSH Communication | ssh2 (connection pool + SFTP) |
| Network Layer | Tailscale (zero-trust WireGuard tunnels) |
| Encryption | AES-256-GCM (credential encryption) |
| Validation | Zod |
| Logging | Pino |
| Testing | Vitest |
| WebSocket | @fastify/websocket + Redis Pub/Sub |
| Frontend Framework | React 19 + Vite 7 |
| Frontend Styling | TailwindCSS 4 |
| State Management | TanStack Query v5 + Zustand |
| Routing | React Router 7 |
| HTTP Client | Axios |
| Icons | Lucide React |

## Documentation Index

- [System Architecture](docs/ARCHITECTURE.md) — Overall design and core workflows
- [Database Design](docs/DATABASE.md) — Schema and indexing strategy for 8 tables
- [Sync Engine](docs/SYNC-ENGINE.md) — Pull-Before-Push protocol deep-dive
- [File Classification](docs/FILE-CLASSIFICATION.md) — File sync behavior rules
- [API Reference](docs/API-REFERENCE.md) — All REST endpoints
- [Module Map](docs/MODULE-MAP.md) — Code structure and dependency rules
