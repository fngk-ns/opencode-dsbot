#!/usr/bin/env bash
# Installs the Discord bot as a systemd service on Linux.
#   ./deploy/install.sh            system service (uses sudo), runs as the current user
#   ./deploy/install.sh --user     systemd --user service, no root needed
#   ./deploy/install.sh --no-start install and enable, but do not start yet
set -euo pipefail

MODE="system"
START=1
for arg in "$@"; do
  case "$arg" in
    --user) MODE="user" ;;
    --no-start) START=0 ;;
    -h | --help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }
[ "$(uname -s)" = "Linux" ] || die "this installer is for Linux"
command -v systemctl >/dev/null || die "systemd (systemctl) is required"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT="$(git -C "$DIR" rev-parse --show-toplevel 2>/dev/null || true)"
[ -n "$ROOT" ] || die "run this from a git checkout of the repository (self-modification rollback needs git)"

BUN="$(command -v bun || true)"
[ -n "$BUN" ] || die "bun is required: curl -fsSL https://bun.sh/install | bash"
OPENCODE="$(command -v opencode || true)"
if [ -z "$OPENCODE" ]; then
  echo "warning: the 'opencode' command was not found."
  echo "  Install it (curl -fsSL https://opencode.ai/install | bash) or set OPENCODE_CMD in .env,"
  echo "  for example OPENCODE_CMD=\"bun run --cwd $ROOT/packages/opencode src/index.ts\""
fi

echo "==> installing dependencies"
(cd "$ROOT" && "$BUN" install)

if [ ! -f "$DIR/.env" ]; then
  cp "$DIR/.env.example" "$DIR/.env"
  chmod 600 "$DIR/.env"
  echo "==> created $DIR/.env  -> edit it (DISCORD_TOKEN, DISCORD_OWNER_IDS) before starting"
  START=0
fi
chmod +x "$DIR/deploy/run.sh"

SERVICE_PATH="$(dirname "$BUN")${OPENCODE:+:$(dirname "$OPENCODE")}:/usr/local/bin:/usr/bin:/bin"
render() {
  sed -e "s|__DIR__|$DIR|g" -e "s|__PATH__|$SERVICE_PATH|g" -e "s|__USER_LINE__|$1|" -e "s|__WANTED_BY__|$2|" \
    "$DIR/deploy/opencode-discord.service"
}

if [ "$MODE" = "user" ]; then
  TARGET="$HOME/.config/systemd/user/opencode-discord.service"
  mkdir -p "$(dirname "$TARGET")"
  render "" "default.target" > "$TARGET"
  systemctl --user daemon-reload
  systemctl --user enable opencode-discord.service
  [ "$START" -eq 1 ] && systemctl --user restart opencode-discord.service
  echo "==> user service installed. To keep it running after logout: sudo loginctl enable-linger $USER"
  echo "    logs: journalctl --user -u opencode-discord -f"
else
  TARGET="/etc/systemd/system/opencode-discord.service"
  render "User=$USER" "multi-user.target" | sudo tee "$TARGET" >/dev/null
  sudo systemctl daemon-reload
  sudo systemctl enable opencode-discord.service
  [ "$START" -eq 1 ] && sudo systemctl restart opencode-discord.service
  echo "==> system service installed. logs: journalctl -u opencode-discord -f"
fi

if [ "$START" -eq 0 ]; then
  echo "==> not started yet. After editing .env run: systemctl$([ "$MODE" = user ] && echo ' --user') start opencode-discord"
fi
cat <<'MSG'

Discord Developer Portal checklist (Bot tab):
  [x] SERVER MEMBERS INTENT   (member cache)
  [x] MESSAGE CONTENT INTENT  (message cache)
Invite URL (replace CLIENT_ID):
  https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot&permissions=1495051381846
  (permissions=309237746752 = without server-management powers)
MSG
