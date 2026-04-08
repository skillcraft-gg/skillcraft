import fs from 'node:fs/promises'
import path from 'node:path'
import { ensureDir, fileExists, readText, writeText } from './fs.js'
import { gitHooksPath } from './git.js'

const MANAGED_MARKER = '# skillcraft-managed-hook'

type ManagedHook = {
  hookPath: string
  backupPath: string
}

function buildHookScript(backupPath: string | undefined, body: string): string {
  const rawCliPath = process.argv[1] || 'skillcraft'
  const cliPath = JSON.stringify(rawCliPath)
  const backup = backupPath ? JSON.stringify(backupPath) : undefined
  const backupBlock = backup
    ? `if [ -x ${backup} ]; then
  ${backup} "$@"
  SKILLCRAFT_PREVIOUS_HOOK_EXIT=$?
  if [ "$SKILLCRAFT_PREVIOUS_HOOK_EXIT" -ne 0 ]; then
    exit "$SKILLCRAFT_PREVIOUS_HOOK_EXIT"
  fi
fi

`
    : ''

  return `#!/usr/bin/env sh
${MANAGED_MARKER}
if [ -n "$SKILLCRAFT_HOOK_DISABLED" ]; then
  exit 0
fi

${backupBlock}SKILLCRAFT_HOOK_DIR="$PWD"
SKILLCRAFT_HOOK_DIR="$(git -C "$SKILLCRAFT_HOOK_DIR" rev-parse --show-toplevel 2>/dev/null || printf "%s" "$SKILLCRAFT_HOOK_DIR")"
SKILLCRAFT_CLI=${cliPath}
unset GIT_INDEX_FILE

${body}
`
}

const postCommitScript = (backupPath?: string) => buildHookScript(backupPath, `"$SKILLCRAFT_CLI" _hook post-commit "$SKILLCRAFT_HOOK_DIR" || true`)

const postPushScript = (backupPath?: string) => buildHookScript(backupPath, `SKILLCRAFT_HOOK_REMOTE="$1"
"$SKILLCRAFT_CLI" _hook post-push "$SKILLCRAFT_HOOK_DIR" "$SKILLCRAFT_HOOK_REMOTE" || true`)

const prePushScript = (backupPath?: string) => buildHookScript(backupPath, `SKILLCRAFT_HOOK_REMOTE="$1"
"$SKILLCRAFT_CLI" _hook post-push "$SKILLCRAFT_HOOK_DIR" "$SKILLCRAFT_HOOK_REMOTE" || true`)

export async function installPostCommitHook(repoPath: string): Promise<void> {
  const hooksDir = await resolveManagedHooksDir(repoPath)
  await ensureDir(hooksDir)

  await installManagedHook(path.join(hooksDir, 'post-commit'), postCommitScript)
  await installManagedHook(path.join(hooksDir, 'post-push'), postPushScript)
  await installManagedHook(path.join(hooksDir, 'pre-push'), prePushScript)
}

export async function removePostCommitHook(repoPath: string): Promise<void> {
  const hooksDir = await resolveManagedHooksDir(repoPath).catch(() => undefined)
  if (!hooksDir || hooksDir === '/dev/null') {
    return
  }

  await Promise.all([
    restoreManagedHook(path.join(hooksDir, 'post-commit')),
    restoreManagedHook(path.join(hooksDir, 'post-push')),
    restoreManagedHook(path.join(hooksDir, 'pre-push')),
  ])
}

export async function hasInstalledPostCommitHook(repoPath: string): Promise<boolean> {
  const hooksDir = await resolveManagedHooksDir(repoPath).catch(() => undefined)
  if (!hooksDir || hooksDir === '/dev/null') {
    return false
  }

  const hookPath = path.join(hooksDir, 'post-commit')
  if (!(await fileExists(hookPath))) {
    return false
  }

  return isSkillcraftManagedHook(await readText(hookPath).catch(() => ''))
}

async function resolveManagedHooksDir(repoPath: string): Promise<string> {
  const rawPath = await gitHooksPath(repoPath)
  if (rawPath === '/dev/null') {
    throw new Error('Git hooks are disabled for this repository (`core.hooksPath=/dev/null`). Re-enable hooks or unset `core.hooksPath` before running `skillcraft enable`.')
  }

  const resolved = path.isAbsolute(rawPath) ? path.normalize(rawPath) : path.resolve(repoPath, rawPath)
  const gitHooksDir = path.join(repoPath, '.git', 'hooks')
  if (resolved === gitHooksDir || isWithinPath(resolved, repoPath)) {
    return resolved
  }

  throw new Error(`Git hooks path points outside this repository: ${resolved}. Skillcraft currently supports the default hooks directory or repo-local hooks paths such as .husky.`)
}

async function installManagedHook(hookPath: string, buildScript: (backupPath?: string) => string): Promise<void> {
  const managed = await readManagedHook(hookPath)
  if (managed.exists && managed.isManaged) {
    await writeText(hookPath, `${buildScript(managed.backupExists ? managed.backupPath : undefined)}\n`)
    await fs.chmod(hookPath, 0o755)
    return
  }

  let backupPath: string | undefined
  if (managed.exists) {
    backupPath = managed.backupPath
    if (!(await fileExists(backupPath))) {
      await fs.rename(hookPath, backupPath)
    } else {
      await fs.rm(hookPath, { force: true })
    }
  }

  await writeText(hookPath, `${buildScript(backupPath)}\n`)
  await fs.chmod(hookPath, 0o755)
}

async function restoreManagedHook(hookPath: string): Promise<void> {
  const managed = await readManagedHook(hookPath)
  if (!managed.exists || !managed.isManaged) {
    return
  }

  if (managed.backupExists) {
    await fs.rename(managed.backupPath, hookPath)
    return
  }

  await fs.rm(hookPath, { force: true })
}

async function readManagedHook(hookPath: string): Promise<ManagedHook & { exists: boolean; isManaged: boolean; backupExists: boolean }> {
  const backupPath = `${hookPath}.skillcraft.orig`
  const exists = await fileExists(hookPath)
  if (!exists) {
    return { hookPath, backupPath, exists: false, isManaged: false, backupExists: await fileExists(backupPath) }
  }

  const contents = await readText(hookPath).catch(() => '')
  return {
    hookPath,
    backupPath,
    exists: true,
    isManaged: isSkillcraftManagedHook(contents),
    backupExists: await fileExists(backupPath),
  }
}

function isSkillcraftManagedHook(contents: string): boolean {
  return contents.includes(MANAGED_MARKER)
    || (contents.includes('SKILLCRAFT_CLI=') && (contents.includes('_hook post-commit') || contents.includes('_hook post-push')))
}

function isWithinPath(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
