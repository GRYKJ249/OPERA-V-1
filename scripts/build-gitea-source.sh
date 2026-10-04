#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/third_party/gitea"

if [[ ! -f "$SOURCE/go.mod" || ! -f "$SOURCE/Makefile" ]]; then
  echo "Vendored Gitea source was not found at $SOURCE" >&2
  exit 1
fi

if ! command -v go >/dev/null 2>&1; then
  echo "Building Gitea requires Go 1.27 or newer." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v make >/dev/null 2>&1; then
  echo "Building Gitea requires Node.js 22 or newer and make." >&2
  exit 1
fi

go_version="$(go env GOVERSION)"
if ! [[ "$go_version" =~ ^go1\.(2[7-9]|[3-9][0-9])([.]|$) ]]; then
  echo "Gitea v28.0.0 requires Go 1.27 or newer; found $go_version." >&2
  exit 1
fi
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 22 )); then
  echo "Gitea v28.0.0 requires Node.js 22 or newer; found $(node --version)." >&2
  exit 1
fi

cd "$SOURCE"
# The source is a release archive nested in the Opera repository. Explicitly set
# the upstream tag so Make does not infer Opera's Git branch/commit as Gitea's version.
GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v28.0.0 TAGS=bindata make build
