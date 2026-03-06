# Contributing to ClawConsole

Thank you for your interest in contributing to ClawConsole! This guide will help you get started.

## Development Setup

### Prerequisites

- **Node.js** >= 20.0.0
- **MySQL** 8.0+
- **Redis** 7.x
- **Tailscale** (optional, for testing remote sync features)

### Quick Start

```bash
# Clone the repo
git clone https://github.com/guyil/clawconsole.git
cd clawconsole

# Install all dependencies
npm run install:all

# Set up the backend environment
cd backend
cp .env.example .env
# Edit .env with your MySQL/Redis credentials

# Run database migrations
npm run migrate

# Start backend (from backend/)
npm run dev

# In another terminal, start frontend (from frontend/)
cd frontend
npm run dev
```

Or use Docker for a one-command setup:

```bash
docker compose up
```

### Running Tests

```bash
cd backend
npm run test:run    # Single run
npm test            # Watch mode
```

### Linting

```bash
# Backend
cd backend && npm run lint

# Frontend
cd frontend && npm run lint
```

## How to Contribute

### Reporting Bugs

- Use the [Bug Report](https://github.com/guyil/clawconsole/issues/new?template=bug_report.yml) issue template
- Include steps to reproduce, expected behavior, and actual behavior
- Include your Node.js version, OS, and browser (if frontend-related)

### Suggesting Features

- Use the [Feature Request](https://github.com/guyil/clawconsole/issues/new?template=feature_request.yml) issue template
- Explain the use case and why existing features don't solve it
- If possible, include mockups or examples

### Submitting Pull Requests

1. **Fork** the repository and create your branch from `main`
2. **Write tests** for any new functionality
3. **Run the test suite** to make sure nothing is broken
4. **Lint your code** with `npm run lint`
5. **Write a clear PR description** explaining what changed and why

### PR Guidelines

- Keep PRs focused — one feature or fix per PR
- Follow the existing code style (TypeScript strict mode, ESM imports)
- Add comments for non-obvious logic
- Update documentation if you change user-facing behavior
- Add a changelog entry for user-facing changes

## Code Structure

```
backend/src/
├── config/          # Configuration loading
├── shared/          # Shared utilities (DB, Redis, crypto, logging)
├── transport/       # SSH connection pool + Tailscale integration
├── parsers/         # OpenClaw file parsers
├── modules/         # Business modules (machines, agents, sync, etc.)
├── jobs/            # BullMQ background jobs
└── websocket/       # WebSocket real-time events

frontend/src/
├── api/             # Axios API client layer
├── hooks/           # React Query hooks
├── stores/          # Zustand state management
├── components/      # React components
└── pages/           # Route pages
```

## Coding Conventions

- **Language**: TypeScript (ESM), strict mode
- **Backend framework**: Fastify 5
- **Frontend framework**: React 19 + Vite
- **Styling**: TailwindCSS 4
- **State management**: TanStack Query v5 (server state) + Zustand (UI state)
- **Validation**: Zod schemas
- **Testing**: Vitest
- **Naming**: camelCase for variables/functions, PascalCase for types/classes

## Community

- [GitHub Discussions](https://github.com/guyil/clawconsole/discussions) — Questions, ideas, and general discussion
- [GitHub Issues](https://github.com/guyil/clawconsole/issues) — Bug reports and feature requests

## License

By contributing to ClawConsole, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
