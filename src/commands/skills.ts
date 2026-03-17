import path from 'node:path'
import fs from 'node:fs/promises'
import { getProvider } from '@/providers'
import { loadGlobalConfig } from '@/core/config'
import { assertNonEmpty, splitArgPair } from '@/core/validation'
import { isEnabled } from '@/core/state'
import { loadProofFromRepo } from '@/core/progress'
import { loadPending } from '@/core/proof'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execPromise = promisify(execFile)

export async function runSkillsPublish(slug: string): Promise<void> {
  const ref = assertNonEmpty(slug, 'skill id')
  const { owner, slug: slugPart } = splitArgPair(ref)
  const cwd = process.cwd()
  if (!(await isEnabled(cwd))) {
    throw new Error('Repository is not enabled')
  }

  const files = await Promise.all([
    fs.access(path.join(cwd, 'SKILL.md')).then(() => true).catch(() => false),
    fs.access(path.join(cwd, 'skill.yaml')).then(() => true).catch(() => false),
  ])
  if (!files[0] || !files[1]) {
    throw new Error('SKILL.md and skill.yaml are required for publishing')
  }

  const config = await loadGlobalConfig()
  const provider = getProvider(config.provider ?? 'gh')
  await provider.getUser()

  const destination = 'skillcraft-gg/skills'
  const branch = `skillcraft-skill-${owner}-${slugPart}`
  const temp = path.join(process.cwd(), '.skillcraft-temp-skill-publish')

  try {
    await fs.rm(temp, { force: true, recursive: true })
    await provider.cloneRepo(destination, temp)
    await runGit(temp, ['checkout', '-B', branch])

    const target = path.join(temp, 'skills', owner, slugPart)
    await fs.rm(target, { force: true, recursive: true })
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.cp(cwd, target, { recursive: true })

    await runGit(temp, ['add', `skills/${owner}/${slugPart}`])
    await runGit(temp, ['commit', '-m', `Publish skill ${ref}`]).catch(() => {
      throw new Error('nothing to commit; skill may already be published')
    })
    await runGit(temp, ['push', '-u', 'origin', branch]).catch(() => {
      throw new Error('unable to push skill publish branch')
    })
    await provider.createPullRequest(destination, branch, `Publish skill: ${ref}`).catch(() => {
      process.stdout.write('unable to create PR automatically. Please open one manually from your branch.\n')
    })

    process.stdout.write(`published skill ${ref} from ${destination}\n`)
  } finally {
    await fs.rm(temp, { force: true, recursive: true })
  }
}

export async function runSkillsValidate(): Promise<void> {
  const cwd = process.cwd()
  const checks = [
    ['SKILL.md', await exists(path.join(cwd, 'SKILL.md'))],
    ['skill.yaml', await exists(path.join(cwd, 'skill.yaml'))],
  ]
  for (const [name, ok] of checks) {
    process.stdout.write(`${name}: ${ok ? 'ok' : 'missing'}\n`)
  }
}

export async function runSkillsList(): Promise<void> {
  const cwd = process.cwd()
  if (!(await isEnabled(cwd))) {
    throw new Error('Repository is not enabled')
  }

  const [proofs, pending] = await Promise.all([loadProofFromRepo(cwd), loadPending(cwd)])
  const skills = new Set<string>()
  for (const proof of proofs) {
    for (const item of proof.skills) {
      skills.add(item.id)
    }
  }
  for (const skill of pending) {
    skills.add(skill)
  }

  if (!skills.size) {
    process.stdout.write('no skills detected\n')
    return
  }

  const list = Array.from(skills).sort().join('\n')
  process.stdout.write(`skills detected (${skills.size}):\n${list}\n`)
}

async function exists(pathToCheck: string): Promise<boolean> {
  try {
    await fs.access(pathToCheck)
    return true
  } catch {
    return false
  }
}

async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execPromise('git', args, { cwd })
  return stdout.trim()
}

export async function runSkillsValidateAndExit(): Promise<void> {
  await runSkillsValidate()
}
