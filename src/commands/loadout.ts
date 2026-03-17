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
  process.stdout.write(`activated loadout: ${id}\n`)
}

export async function runLoadoutClear(): Promise<void> {
  const cwd = process.cwd()
  if (!(await isEnabled(cwd))) {
    throw new Error('Repository is not enabled')
  }
  await writeJson(contextPath(cwd), { activeLoadouts: [] })
  process.stdout.write('cleared active loadouts\n')
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
    await provider.createPullRequest(
      remote,
      branch,
      `Loadout publish: ${cleanId}`,
    ).catch(() => {
      process.stdout.write('unable to create PR automatically. Please open one manually from your branch.\n')
    })
    process.stdout.write(`loadout publish workflow completed for ${cleanId}\n`)
  } finally {
    await fs.rm(temp, { force: true, recursive: true })
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execPromise('git', args, { cwd })
  return stdout.trim()
}
