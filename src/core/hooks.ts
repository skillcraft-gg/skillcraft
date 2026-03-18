import { writeText } from './fs.js'
import { localRepoHookPath, localRepoPrePushHookPath, localRepoPostPushHookPath } from './paths.js'
import fs from 'node:fs/promises'

function buildHookScript(body: string): string {
  const rawCliPath = process.argv[1] || ''
  const cliPath = JSON.stringify(rawCliPath)
  return `#!/usr/bin/env sh
if [ -n "$SKILLCRAFT_HOOK_DISABLED" ]; then
  exit 0
fi

run_skillcraft_hook() {
  if command -v skillcraft >/dev/null 2>&1; then
    skillcraft "$@"
    return
  fi

   local cli=${cliPath}
  if [ -n "$cli" ] && [ -f "$cli" ]; then
    case "$cli" in
      *.js|*.mjs)
        node "$cli" "$@"
        ;;
      *)
        "$cli" "$@"
        ;;
    esac
    return
  fi
}

${body}
`
}

const postCommitScript = buildHookScript(`SKILLCRAFT_HOOK_DIR="$PWD"
run_skillcraft_hook _hook post-commit "$SKILLCRAFT_HOOK_DIR" || true`)

const postPushScript = buildHookScript(`SKILLCRAFT_HOOK_DIR="$PWD"
SKILLCRAFT_HOOK_REMOTE="$1"
run_skillcraft_hook _hook post-push "$SKILLCRAFT_HOOK_DIR" "$SKILLCRAFT_HOOK_REMOTE" || true`)

const prePushScript = buildHookScript(`SKILLCRAFT_HOOK_DIR="$PWD"
SKILLCRAFT_HOOK_REMOTE="$1"
run_skillcraft_hook _hook post-push "$SKILLCRAFT_HOOK_DIR" "$SKILLCRAFT_HOOK_REMOTE" || true`)

export async function installPostCommitHook(repoPath: string): Promise<void> {
  await writeText(localRepoHookPath(repoPath), `${postCommitScript}\n`)
  await fs.chmod(localRepoHookPath(repoPath), 0o755)

  await writeText(localRepoPostPushHookPath(repoPath), `${postPushScript}\n`)
  await fs.chmod(localRepoPostPushHookPath(repoPath), 0o755)

  await writeText(localRepoPrePushHookPath(repoPath), `${prePushScript}\n`)
  await fs.chmod(localRepoPrePushHookPath(repoPath), 0o755)
}

export async function removePostCommitHook(repoPath: string): Promise<void> {
  await Promise.all([
    fs.rm(localRepoHookPath(repoPath), { force: true }),
    fs.rm(localRepoPostPushHookPath(repoPath), { force: true }),
    fs.rm(localRepoPrePushHookPath(repoPath), { force: true }),
  ])
}
