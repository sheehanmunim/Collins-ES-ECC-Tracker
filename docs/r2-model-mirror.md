# Cloudflare R2 Model Mirror

Use this when `ollama pull` works for the maintainer but fails on corporate
networks. The maintainer uploads GGUF model artifacts to Cloudflare R2 once, and
fresh clones download from the approved R2/custom-domain URL without contacting
Ollama's public model registry.

This repo disables Ollama registry fallback by default, so corporate laptops
will only use installed Ollama models, local GGUF artifacts, or the configured
R2/custom-domain mirror. Set `OLLAMA_DISABLE_REGISTRY_FALLBACK=0` only on
maintainer machines that are allowed to run `ollama pull`.

## 1. Prepare The GGUF Artifact

Put the model file where the launcher expects it:

```bash
.cache/ollama-models/qwen3.5-4b.gguf
.cache/ollama-models/gemma3-4b.gguf
```

The configured artifact names live in [`config/local-models.json`](../config/local-models.json).
For a custom filename or checksum, edit the `artifacts` entry:

```json
{
  "artifacts": {
    "qwen3.5:4b": {
      "fileName": "qwen3.5-4b.gguf",
      "sha256": "optional-64-character-sha256"
    }
  }
}
```

## 2. Authenticate Wrangler

Wrangler is installed with the project dev dependencies, so run `npm install`
first if this is a fresh checkout.

Use either an interactive login:

```bash
npx wrangler login
```

Or set a Cloudflare API token with R2 bucket/object permissions:

```bash
export CLOUDFLARE_API_TOKEN=...
```

On PowerShell:

```powershell
$env:CLOUDFLARE_API_TOKEN="..."
```

## 3. Create The Bucket, Connect A Domain, And Upload

Production-friendly setup uses a custom domain that is already in the same
Cloudflare account as the R2 bucket:

```bash
npm run models:r2 -- --bucket ecc-local-models --domain models.fourechelon.com --prefix ecc
```

That command will:

- create the R2 bucket if needed
- connect the custom domain to the bucket
- upload configured local GGUF artifacts to `ecc/<file-name>.gguf`
- deploy a temporary authenticated Worker uploader for files larger than
  Wrangler can upload directly, then remove that Worker after the final single
  R2 object is complete
- write `OLLAMA_MODEL_MIRROR_BASE_URL` to `.env.local`
- write `mirrorBaseUrl` to `config/local-models.json`

Commit the updated `config/local-models.json` after the mirror URL is correct.
Fresh clones will then use the R2 mirror automatically.

## 4. Upload New Artifacts Later

After replacing or adding files under `.cache/ollama-models`, upload again:

```bash
npm run models:r2:upload -- --bucket ecc-local-models --mirror-url https://models.fourechelon.com/ecc
```

If the full-file upload is interrupted, rerun the same command.

To only save the public mirror URL into local env and committed config:

```bash
npm run models:r2:env -- --mirror-url https://models.fourechelon.com/ecc
```

## Development URL Option

For a quick smoke test without a custom domain:

```bash
npm run models:r2 -- --bucket ecc-local-models --dev-url --prefix ecc
```

Cloudflare's `r2.dev` public URL is intended for non-production traffic, is
rate-limited, and can be blocked by corporate DNS policy. Use the custom domain
for corporate distribution.

## Corporate Network Troubleshooting

Fresh clones use `https://models.fourechelon.com/ecc` by default. If startup
fails while downloading mirrored artifacts, first confirm the laptop can reach
the full model objects:

```powershell
curl.exe -I https://models.fourechelon.com/ecc/qwen3.5-4b.gguf
curl.exe -I https://models.fourechelon.com/ecc/gemma3-4b.gguf
```

The launcher tries Node's built-in HTTPS client first, then retries mirror
downloads through `curl`, then on Windows retries through PowerShell with a BITS
fallback, then uses installed Chrome or Edge as an automatic download engine.
These paths give corporate proxy settings, TLS inspection, and Windows-managed
download policies a better chance of being honored. HTTP paths send a
browser-like `User-Agent`, which can be overridden with
`OLLAMA_MODEL_MIRROR_USER_AGENT` if a corporate proxy requires a specific
allowlisted value. If Chrome or Edge is installed in a non-standard location,
set `OLLAMA_MODEL_BROWSER_PATH` to the executable path.

If automatic browser downloads are disabled or blocked, the same mirror also
hosts a manual downloader:

```text
https://models.fourechelon.com/ecc/model-downloader.html
```

Open that page in Chrome or Edge, select the cloned `local-cr-tracker` folder,
and wait for it to save the configured artifacts into
`.cache/ollama-models`. Then rerun `npm run local`. The launcher will validate
and import those local GGUF files without downloading them through a blocked
command-line process. Set `OLLAMA_MODEL_MANUAL_BROWSER_PROMPT=1` only if you
want the launcher to pause and open that page automatically after all automatic
download paths fail.
