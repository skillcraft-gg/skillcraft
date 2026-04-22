import { spawn } from 'node:child_process'
import path from 'node:path'
import { ensureDir, fileExists, readJson, readText, removeFile, removePath, writeJson, writeText } from './fs.js'
import { git, gitRoot } from './git.js'
import { learnModeStatePath, opencodeSkillPath } from './paths.js'
import { isEnabled } from './state.js'

const learnModeSkillName = 'learning-coach'
const learnStartMarker = '<!-- skillcraft:begin learn -->'
const learnEndMarker = '<!-- skillcraft:end learn -->'
const learnIgnoreStartMarker = '# skillcraft:begin learn-ignore'
const learnIgnoreEndMarker = '# skillcraft:end learn-ignore'

export type LearnModeAgent = 'opencode'

type LearnModeState = {
  version: 1
  agentsPath: string
  createdAgentsFile: boolean
  skillDir: string
  gitignorePath?: string
  createdGitignoreFile?: boolean
}

export async function launchLearnMode(repoPath: string, agent: LearnModeAgent): Promise<{ exitCode: number }> {
  if (agent !== 'opencode') {
    throw new Error(`Unsupported learn-mode agent: ${agent}`)
  }

  const root = await gitRoot(repoPath)
  await cleanupLearnMode(root)

  const session = await prepareLearnMode(root)
  try {
    const exitCode = await runOpenCode(root)
    return { exitCode }
  } finally {
    await session.cleanup()
  }
}

export async function cleanupLearnMode(repoPath: string): Promise<void> {
  const root = await gitRoot(repoPath)
  const state = await loadLearnModeState(root)
  if (!state) {
    return
  }

  try {
    if (await fileExists(state.agentsPath)) {
      const current = await readText(state.agentsPath)
      const stripped = stripManagedBlock(current, learnStartMarker, learnEndMarker)
      if (state.createdAgentsFile && !stripped.trim()) {
        await removeFile(state.agentsPath)
      } else if (stripped !== current) {
        await writeText(state.agentsPath, normalizeManagedContent(stripped))
      }
    }

    await removePath(state.skillDir)

    if (state.gitignorePath && (await fileExists(state.gitignorePath))) {
      const current = await readText(state.gitignorePath)
      const stripped = stripManagedBlock(current, learnIgnoreStartMarker, learnIgnoreEndMarker)
      if (state.createdGitignoreFile && !stripped.trim()) {
        await removeFile(state.gitignorePath)
      } else if (stripped !== current) {
        await writeText(state.gitignorePath, normalizeManagedContent(stripped))
      }
    }
  } finally {
    await removeFile(learnModeStatePath(root))
  }
}

async function prepareLearnMode(repoPath: string): Promise<{ cleanup: () => Promise<void> }> {
  const agentsPath = path.join(repoPath, 'AGENTS.md')
  const gitignorePath = path.join(repoPath, '.gitignore')
  const skillFile = opencodeSkillPath(repoPath, learnModeSkillName)
  const skillDir = path.dirname(skillFile)
  const skillcraftEnabled = await isEnabled(repoPath)
  const createdAgentsFile = !(await fileExists(agentsPath))
  const ignoreEntries = await buildLearnIgnoreEntries(repoPath, agentsPath, createdAgentsFile, skillFile)
  const createdGitignoreFile = ignoreEntries.length > 0 && !(await fileExists(gitignorePath))

  if (await fileExists(skillFile)) {
    throw new Error(`Learn Mode cannot start because ${path.relative(repoPath, skillFile)} already exists.`)
  }

  await writeJson(learnModeStatePath(repoPath), {
    version: 1,
    agentsPath,
    createdAgentsFile,
    skillDir,
    ...(ignoreEntries.length > 0
      ? {
          gitignorePath,
          createdGitignoreFile,
        }
      : {}),
  } satisfies LearnModeState)

  try {
    const currentAgents = createdAgentsFile ? '' : await readText(agentsPath)
    const nextAgents = appendManagedLearnBlock(currentAgents, buildLearnAgentsBlock(skillcraftEnabled))
    await writeText(agentsPath, nextAgents)

    if (ignoreEntries.length > 0) {
      const currentGitignore = createdGitignoreFile ? '' : await readText(gitignorePath)
      const nextGitignore = appendManagedGitignoreBlock(currentGitignore, buildLearnGitignoreBlock(ignoreEntries))
      await writeText(gitignorePath, nextGitignore)
    }

    await ensureDir(skillDir)
    await writeText(skillFile, buildLearnSkill(skillcraftEnabled))

    return {
      cleanup: async () => cleanupLearnMode(repoPath),
    }
  } catch (error) {
    await cleanupLearnMode(repoPath)
    throw error
  }
}

async function runOpenCode(repoPath: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const child = spawn('opencode', [repoPath], {
      cwd: repoPath,
      stdio: 'inherit',
      env: process.env,
    })

    child.on('error', (error) => {
      reject(new Error(`Failed to start OpenCode: ${error.message}`))
    })

    child.on('close', (code) => {
      resolve(code ?? 1)
    })
  })
}

async function loadLearnModeState(repoPath: string): Promise<LearnModeState | null> {
  const raw = await readJson<unknown>(learnModeStatePath(repoPath))
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const state = raw as Partial<LearnModeState>
  if (
    state.version !== 1 ||
    typeof state.agentsPath !== 'string' ||
    typeof state.createdAgentsFile !== 'boolean' ||
    typeof state.skillDir !== 'string' ||
    ('gitignorePath' in state && state.gitignorePath !== undefined && typeof state.gitignorePath !== 'string') ||
    ('createdGitignoreFile' in state && state.createdGitignoreFile !== undefined && typeof state.createdGitignoreFile !== 'boolean')
  ) {
    return null
  }

  return {
    version: 1,
    agentsPath: state.agentsPath,
    createdAgentsFile: state.createdAgentsFile,
    skillDir: state.skillDir,
    ...(state.gitignorePath ? { gitignorePath: state.gitignorePath } : {}),
    ...(state.createdGitignoreFile !== undefined ? { createdGitignoreFile: state.createdGitignoreFile } : {}),
  }
}

function appendManagedLearnBlock(content: string, block: string): string {
  const stripped = stripManagedBlock(content, learnStartMarker, learnEndMarker).replace(/\s+$/, '')
  return stripped ? `${stripped}\n\n${block}\n` : `${block}\n`
}

function appendManagedGitignoreBlock(content: string, block: string): string {
  const stripped = stripManagedBlock(content, learnIgnoreStartMarker, learnIgnoreEndMarker).replace(/\s+$/, '')
  return stripped ? `${stripped}\n\n${block}\n` : `${block}\n`
}

function stripManagedBlock(content: string, startMarker: string, endMarker: string): string {
  const escapedStart = escapeRegExp(startMarker)
  const escapedEnd = escapeRegExp(endMarker)
  return content.replace(new RegExp(`\n?${escapedStart}[\\s\\S]*?${escapedEnd}\n?`, 'g'), '')
}

function normalizeManagedContent(content: string): string {
  return content.trim() ? `${content.replace(/\s+$/, '')}\n` : ''
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildLearnAgentsBlock(skillcraftEnabled: boolean): string {
  const enableNote = skillcraftEnabled
    ? '- This repository already has Skillcraft enabled. Keep work inside this repository so existing hooks and provenance capture continue to work normally.'
    : '- Mention once near start that `skillcraft enable --agent opencode` is not required for Learn Mode, but it is best way to turn AI-assisted work in this repository into verifiable evidence so user can have learning recognized with Skillcraft credentials. Do not run it unless user explicitly asks.'

  return [
    learnStartMarker,
    '# Skillcraft Learn Mode',
    'This session is running in guided co-creation mode.',
    `Load and follow the \`${learnModeSkillName}\` skill immediately.`,
    'Treat Learn Mode instructions as higher priority than your default preference for autonomous implementation.',
    enableNote,
    learnEndMarker,
  ].join('\n')
}

function buildLearnGitignoreBlock(entries: string[]): string {
  return [learnIgnoreStartMarker, ...entries, learnIgnoreEndMarker].join('\n')
}

async function buildLearnIgnoreEntries(
  repoPath: string,
  agentsPath: string,
  createdAgentsFile: boolean,
  skillFile: string,
): Promise<string[]> {
  const entries: string[] = []

  if (createdAgentsFile) {
    const agentsGitPath = toGitPath(repoPath, agentsPath)
    if (!(await isTrackedPath(repoPath, agentsGitPath)) && !(await isIgnoredPath(repoPath, agentsGitPath))) {
      entries.push(agentsGitPath)
    }
  }

  const skillGitPath = toGitPath(repoPath, skillFile)
  if (!(await isTrackedPath(repoPath, skillGitPath)) && !(await isIgnoredPath(repoPath, skillGitPath))) {
    entries.push(`${toGitPath(repoPath, path.dirname(skillFile))}/`)
  }

  return entries
}

async function isTrackedPath(repoPath: string, gitPath: string): Promise<boolean> {
  try {
    await git(['ls-files', '--error-unmatch', '--', gitPath], repoPath)
    return true
  } catch {
    return false
  }
}

async function isIgnoredPath(repoPath: string, gitPath: string): Promise<boolean> {
  try {
    await git(['check-ignore', '--quiet', '--', gitPath], repoPath)
    return true
  } catch {
    return false
  }
}

function toGitPath(repoPath: string, filePath: string): string {
  return path.relative(repoPath, filePath).split(path.sep).join('/')
}

function buildLearnSkill(skillcraftEnabled: boolean): string {
  const proofCaptureSection = skillcraftEnabled
    ? ''
    : `
## Skillcraft proof capture

- \`skillcraft enable --agent opencode\` is not required for Learn Mode.
- If repository is not already enabled, mention once that enabling Skillcraft is best way to turn AI-assisted work from real projects into verifiable evidence.
- Explain briefly that this helps user have learning recognized with Skillcraft credentials.
- Do not run \`skillcraft enable --agent opencode\` unless user explicitly asks.
`

  return `---
name: ${learnModeSkillName}
description: Guided co-creation behavior for Skillcraft learn sessions in OpenCode
---

## Goal

Help user build real software while learning how decisions get made.

## Default behavior

- Surface important decisions instead of making them silently.
- Give 2-3 concrete options when a choice matters.
- Explain trade-offs briefly in plain language.
- Ask user to choose direction before continuing on major architecture, framework, data, testing, deployment, or workflow decisions.
- Build incrementally after each choice instead of dumping full end-to-end solutions.

## Keep momentum

- Do not interrupt for trivial formatting, naming, or mechanical choices unless they materially affect design.
- When one option is clearly better, recommend it first and say why in 1-2 short sentences.
- If user explicitly says to decide for them, choose and keep teaching as you go.

## Teaching style

- Keep explanations short and tied to current task.
- Prefer concrete trade-offs over abstract theory.
- When editing code, explain why this step exists before or right after doing it.
- If user asks for full implementation, still break work into meaningful checkpoints unless they explicitly want less guidance.
${proofCaptureSection}

## Collaboration rule

- Guided co-creation does not mean blocking all progress. Ask only for decisions that meaningfully change outcome.
- After user chooses, continue implementation without repeating the same trade-off discussion.
`
}
