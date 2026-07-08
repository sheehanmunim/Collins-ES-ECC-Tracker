# Local CR Tracker

A local-first change request tracker for engineering teams. It runs as a
downloadable GitHub project with:

- Next.js App Router for the web UI
- Convex local deployments for the reactive database and server functions
- Ollama with auto-selected local models for CR questions, screenshots, and voice
- Local Moonshine speech-to-text and Kokoro text-to-speech for voice mode
- Tailwind, shadcn/ui primitives, and lucide icons

## Features

- Create, edit, archive, filter, and export CRs
- Track status, priority, risk, owner, requester, system, due date, impact, and technical notes
- Add update notes and status-change history
- Ask a local model about blockers, ownership, risk, and review priorities

## Requirements

- Node.js 20 or newer
- npm
- Ollama installed locally

The launcher auto-selects a local model profile. Smaller machines use the
`fast` profile, machines with at least 12 GB RAM use `balanced`, and larger
machines use `quality`. Each profile ranks candidate models by speed, answer
quality, memory fit, and whether the model is already installed. You can
override the profile with `LOCAL_MODEL_PROFILE=fast`, `balanced`, or `quality`,
or pin individual models with `OLLAMA_MODEL`, `OLLAMA_VOICE_MODEL`, and
`OLLAMA_VISION_MODEL`.

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
- import cached or mirrored GGUF model artifacts when available
- pull the selected local Ollama models if no artifact is available
- save the resolved local model choices into `.env.local`
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
LOCAL_MODEL_PROFILE=auto
# Optional: pin exact models to bypass adaptive local selection.
# OLLAMA_MODEL=qwen3.5:4b
# OLLAMA_VOICE_MODEL=gemma3:4b
# OLLAMA_VISION_MODEL=gemma3:4b
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL_ARTIFACT_DIR=.cache/ollama-models
# Optional mirror for GGUF artifacts, for example a Cloudflare R2 public bucket URL.
# OLLAMA_MODEL_MIRROR_BASE_URL=https://models.fourechelon.com/ecc
# Keep this enabled for corporate laptops that cannot reach Ollama's registry.
# Set to 0 only on maintainer machines that are allowed to run `ollama pull`.
OLLAMA_DISABLE_REGISTRY_FALLBACK=1
KOKORO_MODEL=onnx-community/Kokoro-82M-v1.0-ONNX
KOKORO_VOICE=af_heart
KOKORO_DTYPE=q8
LOCAL_STT_MODEL=onnx-community/moonshine-tiny-ONNX
LOCAL_STT_DTYPE=q8
LOCAL_STT_DEVICE=cpu
```

Recommended clone-friendly defaults live in
[`config/local-models.json`](./config/local-models.json). It has separate
candidate lists for text chat, live voice, and screenshots, so the app can keep
voice fast while still using a stronger text or vision model when the machine
can handle it. Setting an individual `OLLAMA_*` model pins that role exactly and
skips adaptive ranking for that role.

### Mirrored Ollama Model Artifacts

The repo does not commit multi-GB model files. Instead, the launcher supports a
clone-friendly predownload path:

1. It checks whether the model is already installed in Ollama.
2. It checks `OLLAMA_MODEL_ARTIFACT_DIR` for a matching `.gguf` file.
3. It downloads that `.gguf` from `OLLAMA_MODEL_MIRROR_BASE_URL` when configured.
4. It imports the artifact with `ollama create`.
5. By default, it stops there and does not call `ollama pull`. To allow registry
   fallback on a maintainer machine, set `OLLAMA_DISABLE_REGISTRY_FALLBACK=0`.

By default, model tags are converted into artifact names by replacing separators
with dashes. For example:

```text
qwen3.5:4b -> .cache/ollama-models/qwen3.5-4b.gguf
gemma3:4b -> .cache/ollama-models/gemma3-4b.gguf
```

The committed model config disables registry fallback so corporate laptops use
the Cloudflare/custom mirror path only. If a required artifact is missing from
the mirror, startup fails with the exact local path and mirror object name to
upload instead of attempting Ollama's public registry.

Some corporate endpoint policies allow Chrome downloads from the mirror while
blocking Node, `curl`, PowerShell, and BITS. In that case, `npm run local`
launches Chrome or Edge as the download engine, saves the full GGUF file into
`.cache/ollama-models`, and imports it into Ollama without requiring folder
selection.

To use Cloudflare R2 or another object store, upload the GGUF file under that
same object name and set:

```bash
OLLAMA_MODEL_MIRROR_BASE_URL=https://your-public-model-domain.example/ecc
```

For the Cloudflare R2 bucket/domain/upload flow, see
[`docs/r2-model-mirror.md`](./docs/r2-model-mirror.md). After the public R2 URL
is known, save it as `mirrorBaseUrl` in
[`config/local-models.json`](./config/local-models.json) and commit that change
so fresh clones use the mirror automatically.

For custom filenames, hashes, or Modelfile parameters, add an `artifacts` entry
to [`config/local-models.json`](./config/local-models.json):

```json
{
  "artifacts": {
    "qwen3.5:4b": {
      "fileName": "qwen3.5-4b-q4.gguf",
      "sha256": "replace-with-the-64-character-sha256",
      "modelfile": ["PARAMETER num_ctx 8192"]
    }
  }
}
```

Voice input and output are local as well. The first dictation or voice-chat run
downloads and caches the Moonshine speech-to-text model and Kokoro TTS model;
after they are cached, set `LOCAL_STT_OFFLINE=1` and `KOKORO_OFFLINE=1` if you
want to force fully offline voice mode.

## Local Data And Pulls

Git tracks the app source, scripts, docs, and committed model mirror config. It
does not track machine-local runtime state:

- CR data and local Convex database state live under `.convex/`.
- generated Convex bindings live under `convex/_generated/`.
- local environment values live in `.env.local`.
- downloaded GGUF model files live under `.cache/ollama-models/`.
- generated assistant skill bundles live under `.agents/` and `.claude/`.

That means a user can pull app updates with `git pull` without replacing their
existing local CRs, model cache, or machine-specific settings.

Older clones may already have generated files tracked. If Git shows only
`convex/_generated/`, `AGENTS.md`, `CLAUDE.md`, `skills-lock.json`, `.agents/`,
or `.claude/` as modified, discard just that generated metadata before pulling:

```bash
git restore convex/_generated AGENTS.md CLAUDE.md skills-lock.json .agents .claude
git pull
```

## Useful Commands

```bash
npm run local          # install dependencies, ensure local models, start local app
npm run setup          # install dependencies and local models without starting the app
npm run models         # ensure/pull local Ollama models and update .env.local
npm run dev:local      # local Convex + Next.js, after setup
npm run convex:local   # local Convex only
npm run lint           # lint the repo
npm run build          # production build
npm run start          # ensures local models, then starts the production build
```

## Notes

- This project is designed for local development and local data. Convex local
  deployment state lives in `.convex/` and `.env.local`.
- The assistant route calls only your local Ollama server. Voice recognition and
  speech output use locally cached ONNX models. The app does not use a hosted
  LLM API.
- Sources checked while setting up this repo: [Convex local deployments](https://docs.convex.dev/cli/local-deployments), [Convex agent mode](https://docs.convex.dev/cli/agent-mode), [Qwen3 official blog](https://qwenlm.github.io/blog/qwen3/), [Ollama Qwen 3.5 4B](https://ollama.com/library/qwen3.5:4b), [Ollama Qwen3 tags](https://www.ollama.com/library/qwen3/tags), [Ollama Gemma 3](https://ollama.com/library/gemma3), [Ollama Granite 3.2 Vision](https://ollama.com/library/granite3.2-vision), [Moonshine tiny ONNX](https://huggingface.co/onnx-community/moonshine-tiny-ONNX), [Transformers.js pipelines](https://huggingface.co/docs/transformers.js/api/pipelines), and [Kokoro.js](https://huggingface.co/posts/Xenova/503648859052804).
