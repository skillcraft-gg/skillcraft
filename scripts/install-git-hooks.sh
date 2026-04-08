#!/usr/bin/env sh
set -eu

HOOKS_DIR="$(git rev-parse --git-path hooks)"
if [ "$HOOKS_DIR" = "/dev/null" ]; then
  printf '%s\n' 'Git hooks are disabled for this repository (core.hooksPath=/dev/null).' >&2
  exit 1
fi

mkdir -p "$HOOKS_DIR"

HOOK_PATH="$HOOKS_DIR/commit-msg"
BACKUP_PATH="$HOOK_PATH.commitlint.orig"

if [ -f "$HOOK_PATH" ] && ! grep -q '# commitlint-managed-hook' "$HOOK_PATH"; then
  if [ -e "$BACKUP_PATH" ]; then
    printf '%s\n' "Refusing to overwrite existing commit-msg hook because backup already exists: $BACKUP_PATH" >&2
    exit 1
  fi
  mv "$HOOK_PATH" "$BACKUP_PATH"
fi

cat > "$HOOK_PATH" <<'EOF'
#!/usr/bin/env sh
# commitlint-managed-hook
set -eu

HOOK_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
BACKUP_PATH="$HOOK_DIR/commit-msg.commitlint.orig"
REPO_ROOT="$(git rev-parse --show-toplevel)"

if [ -x "$BACKUP_PATH" ]; then
  "$BACKUP_PATH" "$@"
fi

COMMITLINT_BIN="$REPO_ROOT/node_modules/.bin/commitlint"
if [ ! -x "$COMMITLINT_BIN" ]; then
  printf '%s\n' "commitlint is not installed. Run npm install in $REPO_ROOT." >&2
  exit 1
fi

"$COMMITLINT_BIN" --edit "$1"
EOF

chmod +x "$HOOK_PATH"
