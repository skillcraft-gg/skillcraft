import { writeText } from './fs.js'
import { localRepoHookPath } from './paths.js'
import fs from 'node:fs/promises'

const postCommitScript = `#!/usr/bin/env sh
if [ -n "$SKILLCRAFT_HOOK_DISABLED" ]; then
  exit 0
fi

if ! command -v skillcraft >/dev/null 2>&1; then
  exit 0
fi

SKILLCRAFT_HOOK_DIR="$PWD"
skillcraft _hook post-commit "$SKILLCRAFT_HOOK_DIR" || true
`

export async function installPostCommitHook(repoPath: string): Promise<void> {
  await writeText(localRepoHookPath(repoPath), `${postCommitScript}\n`)
  await fs.chmod(localRepoHookPath(repoPath), 0o755)
}

export async function removePostCommitHook(repoPath: string): Promise<void> {
  await import('node:fs/promises').then((fs) => fs.rm(localRepoHookPath(repoPath), { force: true }))
}
