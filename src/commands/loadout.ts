import path from 'node:path'
import fs from 'node:fs/promises'
import { isEnabled } from '@/core/state'
import { contextPath } from '@/core/paths'
import { readJson, writeJson } from '@/core/fs'
import { isValidIdentifier } from '@/core/validation'
import { assertNonEmpty } from '@/core/validation'
import { getProvider } from '@/providers'
import { loadGlobalConfig } from '@/core/config'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { splitArgPair } from '@/core/validation'
import { emitJson, getOutputMode, printHeader, printRows, printSuccess, printWarning } from '@/lib/output'

const execPromise = promisify(execFile)

export async function runLoadoutUse(id: string): Promise<void> {
  if (!isValidIdentifier(id)) {
    throw new Error('loadout id must be <owner>/<slug>')
  }
  const cwd = process.cwd()
  if (!(await isEnabled(cwd))) {
    throw new Error('Repository is not enabled')
  }

  const current = (await readJson(contextPath(cwd))) as { activeLoadouts?: string[] } | null
  const active = Array.isArray(current?.activeLoadouts) ? current!.activeLoadouts.filter(Boolean) : []
  if (!active.includes(id)) {
    active.push(id)
  }
  await writeJson(contextPath(cwd), { activeLoadouts: active })
  const message = `activated loadout: ${id}`
  if (getOutputMode() === 'json') {
    emitJson({ id, activeLoadouts: active, message })
    return
  }

  printHeader('Loadout Activated')
  printSuccess(message)
  printRows([{ label: 'active loadouts', value: active.join(', '), tone: 'success' }])
}

export async function runLoadoutClear(): Promise<void> {
  const cwd = process.cwd()
  if (!(await isEnabled(cwd))) {
    throw new Error('Repository is not enabled')
  }
  await writeJson(contextPath(cwd), { activeLoadouts: [] })
  const message = 'cleared active loadouts'
  if (getOutputMode() === 'json') {
    emitJson({ activeLoadouts: [], message })
    return
  }

  printHeader('Loadouts Cleared')
  printSuccess(message)
}

export async function runLoadoutShare(id: string): Promise<void> {
  const cleanId = assertNonEmpty(id, 'loadout id')
  if (!isValidIdentifier(cleanId)) {
    throw new Error('loadout id must be <owner>/<slug>')
  }
  const { owner, slug: slugPart } = splitArgPair(cleanId)

  const cwd = process.cwd()
  const loadoutFile = path.join(cwd, 'loadout.yaml')
  await fs.access(loadoutFile)
  const stat = await fs.stat(loadoutFile)
  if (!stat.isFile()) {
    throw new Error('loadout.yaml not found in current directory')
  }

  const config = await loadGlobalConfig()
  const provider = getProvider(config.provider ?? 'gh')
  const remote = `skillcraft-gg/loadouts`
  const temp = path.join(process.cwd(), '.skillcraft-temp-loadout-share')
  const branch = `skillcraft-loadout-${owner}-${slugPart}`
  let pullRequest = 0
  let prAutoCreated = true

  try {
    await fs.rm(temp, { force: true, recursive: true })
    await provider.cloneRepo(remote, temp)
    await runGit(temp, ['checkout', '-B', branch])

    const targetDir = path.join(temp, 'loadouts', owner, slugPart)
    await fs.rm(targetDir, { force: true, recursive: true }).catch(() => undefined)
    await fs.mkdir(path.dirname(targetDir), { recursive: true })
    await fs.copyFile(loadoutFile, path.join(targetDir, 'loadout.yaml'))

    await runGit(temp, ['add', targetDir])
    await runGit(temp, ['commit', '-m', `Loadout: publish ${cleanId}`]).catch(async () => {
      throw new Error('nothing to commit; loadout may already be published')
    })
    await runGit(temp, ['push', '-u', 'origin', branch]).catch(() => {
      throw new Error('unable to push loadout publish branch')
    })
    pullRequest = await provider.createPullRequest(
      remote,
      branch,
      `Loadout publish: ${cleanId}`,
    ).catch(() => {
      prAutoCreated = false
      return 0
    })

    const message = `loadout publish workflow completed for ${cleanId}`
    if (getOutputMode() === 'json') {
      emitJson({
        id: cleanId,
        remote,
        branch,
        pullRequest,
        prAutoCreated,
        message,
      })
      return
    }

    printHeader('Loadout Publish')
    if (!prAutoCreated) {
      printWarning('unable to create PR automatically. Please open one manually from your branch.')
    }
    printSuccess(message)
    printRows([
      { label: 'branch', value: branch },
      { label: 'pull request', value: pullRequest || 'manual', tone: pullRequest ? 'success' : 'warning' },
    ])
  } finally {
    await fs.rm(temp, { force: true, recursive: true })
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execPromise('git', args, { cwd })
  return stdout.trim()
}
