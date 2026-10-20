#!/usr/bin/env bash
# mailamb デプロイスクリプト
# 使い方: ./scripts/deploy.sh [worker|watcher|all]
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

if [ ! -f .env ]; then
  echo "ERR: .env が無い。cp .env.example .env して値を埋めてから実行"
  exit 1
fi

# .env 読み込み (= の右辺は quote 不要、空白なし前提)
set -a
# shellcheck disable=SC1091
. ./.env
set +a

# <FILL_HERE> チェック
check() {
  local v="${1}"
  local name="${2}"
  if [ -z "${v:-}" ] || [ "$v" = "<FILL_HERE>" ]; then
    echo "ERR: .env の $name が未設定"
    exit 1
  fi
}

TARGET="${1:-all}"

deploy_worker() {
  echo "=== mailamb Worker デプロイ ==="
  check "$MAILAMB_API_KEY" MAILAMB_API_KEY
  cd "$ROOT/worker"
  echo -n "$MAILAMB_API_KEY" | npx wrangler secret put API_KEY
  npx wrangler deploy
  cd "$ROOT"
}

deploy_watcher() {
  echo "=== worker-watcher デプロイ ==="
  check "$IMAP_HOST" IMAP_HOST
  check "$IMAP_USER" IMAP_USER
  check "$IMAP_PASSWORD" IMAP_PASSWORD
  check "$IMAP_INBOX" IMAP_INBOX
  check "$IMAP_DRAFTS" IMAP_DRAFTS
  check "$MAILAMB_API_KEY" MAILAMB_API_KEY

  cd "$ROOT/worker-watcher"
  echo -n "$IMAP_HOST" | npx wrangler secret put IMAP_HOST
  echo -n "$IMAP_PORT" | npx wrangler secret put IMAP_PORT
  echo -n "$IMAP_USER" | npx wrangler secret put IMAP_USER
  echo -n "$IMAP_PASSWORD" | npx wrangler secret put IMAP_PASSWORD
  echo -n "$IMAP_INBOX" | npx wrangler secret put IMAP_INBOX
  echo -n "$IMAP_DRAFTS" | npx wrangler secret put IMAP_DRAFTS
  echo -n "$MAILAMB_API_KEY" | npx wrangler secret put MAILAMB_API_KEY
  npx wrangler deploy
  cd "$ROOT"
}

case "$TARGET" in
  worker)  deploy_worker ;;
  watcher) deploy_watcher ;;
  all)     deploy_worker; deploy_watcher ;;
  *)       echo "Usage: $0 [worker|watcher|all]"; exit 1 ;;
esac

echo ""
echo "=== 完了 ==="
echo "- Worker URL:  https://mailamb.<account>.workers.dev"
echo "- 設定メモ.txt (sender/admin) に Worker URL と MAILAMB_API_KEY を記入して配布"
