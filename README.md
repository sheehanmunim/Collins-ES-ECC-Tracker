# Local CR Tracker

A local-first change request tracker for engineering teams. It runs as a
downloadable GitHub project with:

- Next.js App Router for the web UI
- Convex local deployments for the reactive database and server functions
- Ollama with Qwen for local CR questions and summaries
- Tailwind, shadcn/ui primitives, and lucide icons

## Features

- Create, edit, archive, filter, and export CRs
- Track status, priority, risk, owner, requester, system, due date, impact, and technical notes
- Add update notes and status-change history
- Seed demo CRs for first-run testing
- Ask a local Qwen model about blockers, ownership, risk, and review priorities

## Requirements

- Node.js 20 or newer
- npm
- Ollama installed locally

The default model is `qwen3:latest`, which maps to the current Qwen 3 local
model in Ollama. You can override it with `OLLAMA_MODEL`.

## One-Command Local Setup

Clone the repo, then run the launcher for your OS.

Windows:

```powershell
.\start-windows.cmd
```

macOS/Linux:

```bash
bash ./start-unix.sh
```

That command will:

- install Node.js/npm if missing
- install Ollama if missing
- install npm dependencies
- start Ollama if it is not already running
- pull `qwen3:latest` if it is not already installed
- configure/start a local Convex deployment
- start the Next.js app

Open the app:

```text
http://localhost:3000
```

On first run, Convex writes `.env.local` with the local deployment URL. That
file is intentionally ignored by Git.

You can also run the scripts directly:

```powershell
.\scripts\start-local.ps1
```

```bash
./scripts/start-local.sh
```

To install everything without starting the server yet:

```powershell
.\scripts\start-local.ps1 -SetupOnly
```

```bash
bash ./scripts/start-local.sh --setup-only
```

If Node/npm and Ollama are already installed, this shorter command also works:

```bash
npm run local
```

## Optional Configuration

Create `.env.local` or use your shell environment:

```bash
OLLAMA_MODEL=qwen3:latest
OLLAMA_BASE_URL=http://127.0.0.1:11434
```

For a larger local model, set `OLLAMA_MODEL` to another installed Qwen tag, such
as `qwen3:14b` or `qwen3:32b`, if your machine can run it.

## Useful Commands

```bash
npm run local          # install dependencies, ensure Qwen, start local app
npm run setup          # install dependencies and Qwen without starting the app
npm run dev:local      # local Convex + Next.js, after setup
npm run convex:local   # local Convex only
npm run lint           # lint the repo
npm run build          # production build
```

## Notes

- This project is designed for local development and local data. Convex local
  deployment state lives in `.convex/` and `.env.local`.
- The assistant route calls only your local Ollama server. It does not use a
  hosted LLM API.
- Sources checked while setting up this repo: [Convex local deployments](https://docs.convex.dev/cli/local-deployments), [Convex agent mode](https://docs.convex.dev/cli/agent-mode), [Qwen3 official blog](https://qwenlm.github.io/blog/qwen3/), and [Ollama Qwen3 tags](https://www.ollama.com/library/qwen3/tags).
