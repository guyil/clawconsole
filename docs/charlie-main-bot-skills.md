# Charlie Machine - Main Bot Skills

> Machine: **Charlie Mac Mini**
> Bot: **main** (个人 Agent)
> Generated: 2026-03-08

---

## 共享 Skills (Global Scope)

Skills shared across all agents on the Charlie machine.

### 1. amazon-scraper

**Source:** local

Research Amazon product categories, scrape product listings (ASIN pages), BSR Best Sellers rankings, and search results with full data extraction including all images. Use PROACTIVELY when the user asks to scrape Amazon data, analyze Amazon products, research Amazon categories, check BSR rankings, extract product information, or gather competitive intelligence from Amazon. Also trigger when user mentions ASIN, Amazon listing, Best Seller Rank, product research, or wants to search Amazon for products. Supports Chinese output. 用于亚马逊产品调研、分类分析、BSR排名查询、ASIN页面抓取及竞争情报收集。

---

### 2. .claude

**Source:** custom

*(No description provided)*

---

### 3. agent-onboarding

**Source:** custom

Agent initialization and onboarding skill. Use when a new agent needs to set up its identity, role, responsibilities, and working scope. Like onboarding a new team member - guide them through defining who they are and what they do.

---

### 4. find-skills

**Source:** custom

Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.

---

### 5. self-improving-agent

**Source:** custom

Captures learnings, errors, and corrections to enable continuous improvement. Use when: (1) A command or operation fails unexpectedly, (2) User corrects Claude ('No, that's wrong...', 'Actually...'), (3) User requests a capability that doesn't exist, (4) An external API or tool fails, (5) Claude realizes its knowledge is outdated or incorrect, (6) A better approach is discovered for a recurring task. Also review learnings before major tasks.

---

### 6. summarize

**Source:** clawhub

Summarize URLs or files with the summarize CLI (web, PDFs, images, audio, YouTube).

---

## 专属 Skills (Agent Scope)

Skills specific to the main bot.

### 7. agent-browser

**Source:** custom

A fast Rust-based headless browser automation CLI with Node.js fallback that enables AI agents to navigate, click, type, and snapshot pages via structured commands.

---

### 8. capability-evolver

**Source:** custom

A self-evolution engine for AI agents. Analyzes runtime history to identify improvements and applies protocol-constrained evolution.

---

### 9. clawhub-web-install

**Source:** custom

*(No description provided)*

---

### 10. deep-research-pro

**Source:** custom

Multi-source deep research agent. Searches the web, synthesizes findings, and delivers cited reports. No API keys required.

---

### 11. gog

**Source:** custom

Google Workspace CLI for Gmail, Calendar, Drive, Contacts, Sheets, and Docs.

---

### 12. humanize-ai-text

**Source:** custom

Humanize AI-generated text to bypass detection. This humanizer rewrites ChatGPT, Claude, and GPT content to sound natural and pass AI detectors like GPTZero, Turnitin, and Originality.ai. Based on Wikipedia's comprehensive "Signs of AI Writing" guide. Makes robotic AI writing undetectable and human-like.

---

### 13. learn-cog

**Source:** custom

The best tutors explain the same concept five different ways. CellCog does too - diagrams, analogies, worked examples, practice problems, and interactive explanations. #1 on DeepResearch Bench (Feb 2026). Tutoring, homework help, study guides, exam prep, coding tutorials, language learning - every subject, every level.

---

### 14. openclaw-reflect

**Source:** custom

Self-improvement layer with evaluation separation, rollback, and tiered operator gates. Observes outcomes across sessions, detects recurring patterns, proposes improvements, validates proposals through a separate evaluator invocation, and applies changes safely with snapshot/rollback capability.

---

### 15. pls-seo-audit

**Source:** custom

*(No description provided)*

---

### 16. rss-feed-digest

**Source:** custom

Fetch, filter, and summarize RSS/Atom feeds into a clean daily or weekly digest. Supports multiple feeds, keyword filtering, deduplication, and outputs Markdown or plain text summaries.

---

### 17. scrape

**Source:** custom

Legal web scraping with robots.txt compliance, rate limiting, and GDPR/CCPA-aware data handling.

---

### 18. seo-content-writer

**Source:** custom

This skill should be used when the user asks to "write SEO content", "create a blog post", "write an article", "content writing for SEO", "draft optimized content", "write a how-to guide", "create a product description", "write a landing page", "SEO copywriting", "draft content targeting [keyword]", or "write 2000-word article about [topic]". Creates keyword-optimized content using a 12-step workflow: CORE-EEAT pre-write checklist, keyword integration, title optimization (5 formula options), meta description, H1/H2/H3 hierarchy, featured snippet targeting, internal/external linking, and readability enhancement. Produces full drafts with embedded SEO elements, title variants, meta description, FAQ section with schema, and a self-scored CORE-EEAT checklist. For AI-citation optimization, see geo-content-optimizer. For updating existing content, see content-refresher.

---

### 19. skill-vetter

**Source:** custom

Security-first skill vetting for AI agents. Use before installing any skill from ClawdHub, GitHub, or other sources. Checks for red flags, permission scope, and suspicious patterns.

---

### 20. tavily-search

**Source:** custom

AI-optimized web search via Tavily API. Returns concise, relevant results for AI agents.

---

## Summary

| # | Skill Key | Name | Scope | Source | Has Description |
|---|-----------|------|-------|--------|-----------------|
| 1 | amazon-scraper | amazon-scraper | global | local | Yes |
| 2 | .claude | .claude | global | custom | No |
| 3 | agent-onboarding | agent-onboarding | global | custom | Yes |
| 4 | find-skills | find-skills | global | custom | Yes |
| 5 | self-improving-agent | self-improvement | global | custom | Yes |
| 6 | summarize | summarize | global | clawhub | Yes |
| 7 | agent-browser | Agent Browser | agent | custom | Yes |
| 8 | capability-evolver | capability-evolver | agent | custom | Yes |
| 9 | clawhub-web-install | clawhub-web-install | agent | custom | No |
| 10 | deep-research-pro | deep-research-pro | agent | custom | Yes |
| 11 | gog | gog | agent | custom | Yes |
| 12 | humanize-ai-text | humanize-ai-text | agent | custom | Yes |
| 13 | learn-cog | learn-cog | agent | custom | Yes |
| 14 | openclaw-reflect | openclaw-reflect | agent | custom | Yes |
| 15 | pls-seo-audit | pls-seo-audit | agent | custom | No |
| 16 | rss-feed-digest | rss-digest | agent | custom | Yes |
| 17 | scrape | Scrape | agent | custom | Yes |
| 18 | seo-content-writer | seo-content-writer | agent | custom | Yes |
| 19 | skill-vetter | skill-vetter | agent | custom | Yes |
| 20 | tavily-search | tavily | agent | custom | Yes |

**Total: 20 skills** (6 global + 14 agent-specific) | 3 skills without description
