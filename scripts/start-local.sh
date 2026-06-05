#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SETUP_ONLY="false"

if [[ "${1:-}" == "--setup-only" ]]; then
  SETUP_ONLY="true"
fi

say() {
  printf "\n==> %s\n" "$1"
}

has() {
  command -v "$1" >/dev/null 2>&1
}

node_supported() {
  if ! has node; then
    return 1
  fi

  local major
  major="$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)"
  [[ "$major" -ge 20 ]]
}

install_node() {
  if node_supported && has npm; then
    return
  fi

  say "Installing Node.js and npm"
  case "$(uname -s)" in
    Darwin)
      if ! has brew; then
        cat >&2 <<'EOF'
Homebrew is required for automatic Node.js installation on macOS.
Install Homebrew from https://brew.sh, then rerun ./scripts/start-local.sh.
EOF
        exit 1
      fi
      brew install node
      ;;
    Linux)
      if has apt-get; then
        sudo apt-get update
        sudo apt-get install -y nodejs npm
      elif has dnf; then
        sudo dnf install -y nodejs npm
      elif has yum; then
        sudo yum install -y nodejs npm
      elif has pacman; then
        sudo pacman -Sy --noconfirm nodejs npm
      else
        cat >&2 <<'EOF'
Could not find a supported Linux package manager.
Install Node.js and npm, then rerun ./scripts/start-local.sh.
EOF
        exit 1
      fi
      ;;
    *)
      echo "Unsupported OS for automatic Node.js install." >&2
      exit 1
      ;;
  esac
}

install_ollama() {
  if has ollama; then
    return
  fi

  say "Installing Ollama"
  case "$(uname -s)" in
    Darwin)
      if ! has brew; then
        cat >&2 <<'EOF'
Homebrew is required for automatic Ollama installation on macOS.
Install Homebrew from https://brew.sh, then rerun ./scripts/start-local.sh.
EOF
        exit 1
      fi
      brew install ollama
      ;;
    Linux)
      if ! has curl; then
        if has apt-get; then
          sudo apt-get update
          sudo apt-get install -y curl
        elif has dnf; then
          sudo dnf install -y curl
        elif has yum; then
          sudo yum install -y curl
        elif has pacman; then
          sudo pacman -Sy --noconfirm curl
        fi
      fi

      if ! has curl; then
        echo "curl is required to install Ollama automatically." >&2
        exit 1
      fi

      curl -fsSL https://ollama.com/install.sh | sh
      ;;
    *)
      echo "Unsupported OS for automatic Ollama install." >&2
      exit 1
      ;;
  esac
}

echo "Local CR Tracker bootstrap"
if [[ "$SETUP_ONLY" == "true" ]]; then
  echo "This will install missing local prerequisites and pull Qwen."
else
  echo "This will install missing local prerequisites, pull Qwen, and start the app."
fi

install_node
if ! node_supported; then
  cat >&2 <<'EOF'
Node.js 20 or newer is required, and the automatic install did not provide it.
Install a current Node.js LTS release from https://nodejs.org, then rerun this script.
EOF
  exit 1
fi

if ! has npm; then
  echo "npm is required, and the automatic install did not provide it." >&2
  exit 1
fi

install_ollama

if [[ "$SETUP_ONLY" == "true" ]]; then
  say "Running setup"
  npm run setup
else
  say "Starting the app"
  npm run local
fi
