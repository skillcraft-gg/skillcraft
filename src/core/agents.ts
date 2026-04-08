import { execSync } from 'node:child_process'
import path from 'node:path'
import {
  aiModelContextPath,
  codexConfigPath,
  codexHooksPath,
  codexMarketplacePath,
  codexPluginManifestPath,
  codexPluginRootPath,
  codexPluginSkillPath,
  opencodePluginPath,
  pluginPath,
} from './paths.js'
import { recordCodexSkillUsage } from './codexSkills.js'
import { AgentStateSchema, type AgentIntegration } from './types.js'
import { ensureDir, fileExists, readJson, readText, removeFile, removePath, writeJson, writeText } from './fs.js'

const supportedAgents = ['codex', 'opencode'] as const
const codexTomlStart = '# skillcraft:begin codex'
const codexTomlEnd = '# skillcraft:end codex'
const codexHookCommand = 'skillcraft _agent-hook codex'

type CodexHookCommand = {
  type: 'command'
  command: string
  statusMessage?: string
  timeout?: number
}

type CodexHookGroup = {
  matcher?: string
  hooks: CodexHookCommand[]
}

type CodexHooksFile = {
  hooks?: Record<string, CodexHookGroup[]>
}

type CodexMarketplace = {
  name?: string
  interface?: {
    displayName?: string
  }
  plugins?: Array<Record<string, unknown>>
}

export const SupportedAgents = [...supportedAgents]

export function normalizeAgentName(value: string): AgentIntegration | undefined {
  const normalized = value.trim().toLowerCase()
  return supportedAgents.find((agent) => agent === normalized)
}

export function parseAgentOptions(values: readonly string[]): AgentIntegration[] {
  const normalized = values
    .flatMap((value) => value.split(','))
    .map((value) => normalizeAgentName(value))
    .filter((value): value is AgentIntegration => !!value)

  return Array.from(new Set(normalized)).sort()
}

export function unsupportedAgentOptions(values: readonly string[]): string[] {
  return values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => !normalizeAgentName(value))
}

export async function loadEnabledAgents(repoPath: string): Promise<AgentIntegration[]> {
  const raw = await readJson<unknown>(pluginPath(repoPath))
  const parsed = AgentStateSchema.safeParse(raw ?? {})
  if (parsed.success) {
    return parsed.data.providers
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return []
  }

  const record = raw as Record<string, unknown>
  if (!Array.isArray(record.providers)) {
    return []
  }

  return record.providers
    .map((value) => (typeof value === 'string' ? normalizeAgentName(value) : undefined))
    .filter((value): value is AgentIntegration => !!value)
}

export async function saveEnabledAgents(repoPath: string, agents: readonly AgentIntegration[]): Promise<void> {
  const providers = Array.from(new Set(agents)).sort()
  await writeJson(pluginPath(repoPath), {
    version: 1,
    providers,
    enabled: providers.length > 0,
  })
}

export async function detectAvailableAgents(): Promise<AgentIntegration[]> {
  return supportedAgents.filter((agent) => isToolAvailable(agent))
}

export async function enableAgentIntegration(repoPath: string, agent: AgentIntegration): Promise<void> {
  if (agent === 'opencode') {
    await ensureDir(path.dirname(opencodePluginPath(repoPath)))
    await writeText(opencodePluginPath(repoPath), getManagedOpencodePluginSource())
    return
  }

  await enableCodexIntegration(repoPath)
}

export async function disableAgentIntegration(repoPath: string, agent: AgentIntegration): Promise<void> {
  if (agent === 'opencode') {
    await removeFile(opencodePluginPath(repoPath))
    return
  }

  await disableCodexIntegration(repoPath)
}

export async function ensureAiModelContext(repoPath: string, agent: AgentIntegration): Promise<void> {
  const existing = await readJson<unknown>(aiModelContextPath(repoPath))
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    const record = existing as Record<string, unknown>
    const currentAgent = record.agent && typeof record.agent === 'object' && !Array.isArray(record.agent)
      ? (record.agent as Record<string, unknown>).provider
      : undefined
    if (typeof currentAgent === 'string' && currentAgent.trim()) {
      return
    }

    await updateAiModelContext(repoPath, { agent: { provider: agent } })
    return
  }

  await writeJson(aiModelContextPath(repoPath), {
    agent: { provider: agent },
    model: {},
  })
}

export async function updateAiModelContext(repoPath: string, update: { agent?: { provider?: string }; model?: { provider?: string; name?: string } }): Promise<void> {
  const current = await readJson<unknown>(aiModelContextPath(repoPath))
  const existing = current && typeof current === 'object' && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {}

  const existingAgent = existing.agent && typeof existing.agent === 'object' && !Array.isArray(existing.agent)
    ? existing.agent as Record<string, unknown>
    : {}
  const existingModel = existing.model && typeof existing.model === 'object' && !Array.isArray(existing.model)
    ? existing.model as Record<string, unknown>
    : {}

  const next = {
    ...existing,
    agent: {
      ...existingAgent,
      ...(update.agent?.provider ? { provider: update.agent.provider.trim().toLowerCase() } : {}),
    },
    model: {
      ...existingModel,
      ...(update.model?.provider ? { provider: update.model.provider.trim().toLowerCase() } : {}),
      ...(update.model?.name ? { name: update.model.name.trim() } : {}),
    },
  }

  await writeJson(aiModelContextPath(repoPath), next)
}

export async function handleCodexAgentHook(repoPath: string, payload: unknown): Promise<void> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    await updateAiModelContext(repoPath, { agent: { provider: 'codex' } })
    return
  }

  const record = payload as Record<string, unknown>
  const modelName = typeof record.model === 'string' ? record.model.trim() : ''
  const modelProvider = typeof record.model_provider === 'string'
    ? record.model_provider.trim().toLowerCase()
    : typeof record.modelProvider === 'string'
      ? record.modelProvider.trim().toLowerCase()
      : ''

  await updateAiModelContext(repoPath, {
    agent: { provider: 'codex' },
    model: {
      ...(modelProvider ? { provider: modelProvider } : {}),
      ...(modelName ? { name: modelName } : {}),
    },
  })

  await recordCodexSkillUsage(repoPath, payload)
}

function isToolAvailable(tool: string): boolean {
  try {
    execSync(`command -v ${tool}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function enableCodexIntegration(repoPath: string): Promise<void> {
  await Promise.all([
    writeCodexConfig(repoPath),
    writeCodexHooks(repoPath),
    writeCodexMarketplace(repoPath),
    writeCodexPlugin(repoPath),
  ])
}

async function disableCodexIntegration(repoPath: string): Promise<void> {
  await Promise.all([
    removeCodexManagedConfig(repoPath),
    removeCodexHooks(repoPath),
    removeCodexMarketplace(repoPath),
    removePath(codexPluginRootPath(repoPath)),
  ])
}

async function writeCodexPlugin(repoPath: string): Promise<void> {
  await writeJson(codexPluginManifestPath(repoPath), {
    name: 'skillcraft-codex',
    version: '0.1.0',
    description: 'Repo-local Skillcraft workflow support for Codex CLI.',
    skills: './skills/',
    interface: {
      displayName: 'Skillcraft',
      shortDescription: 'Skillcraft-aware repository guidance for Codex.',
      longDescription: 'Adds Skillcraft repository guidance and pairs with repo-local hooks to record model provenance.',
      developerName: 'Skillcraft',
      category: 'Developer Tools',
      capabilities: ['Read', 'Write'],
      defaultPrompt: [
        'Use Skillcraft guidance while working in this repository.',
      ],
      brandColor: '#0f766e',
    },
  })

  await writeText(codexPluginSkillPath(repoPath), `---
name: skillcraft
description: Use when working in a Skillcraft-enabled repository so Codex preserves normal git history and evidence-friendly commit workflows.
---

When Skillcraft is enabled in this repository:

- Preserve normal git history unless the user explicitly asks for destructive history changes.
- Prefer regular commits over rebases, squashes, or amends once Skillcraft evidence has been recorded.
- Keep work in this repository so repo-local Skillcraft hooks can capture model provenance.
- Let Skillcraft post-commit hooks attach proof references after meaningful commits.
`)
}

async function writeCodexMarketplace(repoPath: string): Promise<void> {
  const filePath = codexMarketplacePath(repoPath)
  const raw = await readJson<unknown>(filePath)
  if (raw && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error(`Invalid marketplace file: ${filePath}`)
  }

  const current = (raw ?? {}) as CodexMarketplace
  const plugins = Array.isArray(current.plugins) ? [...current.plugins] : []
  const entry = {
    name: 'skillcraft-codex',
    source: {
      source: 'local',
      path: './plugins/skillcraft-codex',
    },
    policy: {
      installation: 'AVAILABLE',
      authentication: 'ON_INSTALL',
    },
    category: 'Developer Tools',
    interface: {
      displayName: 'Skillcraft',
    },
  }

  const nextPlugins = plugins.filter((plugin) => plugin && typeof plugin === 'object' && (plugin as Record<string, unknown>).name !== entry.name)
  nextPlugins.push(entry)

  await writeJson(filePath, {
    name: current.name || 'skillcraft-local',
    interface: current.interface || { displayName: 'Skillcraft Local Plugins' },
    plugins: nextPlugins,
  })
}

async function removeCodexMarketplace(repoPath: string): Promise<void> {
  const filePath = codexMarketplacePath(repoPath)
  const raw = await readJson<unknown>(filePath)
  if (!raw) {
    return
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid marketplace file: ${filePath}`)
  }

  const current = raw as CodexMarketplace
  const plugins = Array.isArray(current.plugins) ? current.plugins.filter((plugin) => {
    return !(plugin && typeof plugin === 'object' && (plugin as Record<string, unknown>).name === 'skillcraft-codex')
  }) : []

  if (!plugins.length) {
    await removeFile(filePath)
    return
  }

  await writeJson(filePath, {
    ...current,
    plugins,
  })
}

async function writeCodexHooks(repoPath: string): Promise<void> {
  const filePath = codexHooksPath(repoPath)
  const raw = await readJson<unknown>(filePath)
  if (raw && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new Error(`Invalid hooks file: ${filePath}`)
  }

  const current = (raw ?? {}) as CodexHooksFile
  const hooks = current.hooks && typeof current.hooks === 'object' && !Array.isArray(current.hooks)
    ? { ...current.hooks }
    : {}

  hooks.SessionStart = upsertCodexHookGroup(hooks.SessionStart, {
    matcher: 'startup|resume',
    hooks: [codexHookHandler('Updating Skillcraft session context')],
  })
  hooks.UserPromptSubmit = upsertCodexHookGroup(hooks.UserPromptSubmit, {
    hooks: [codexHookHandler('Updating Skillcraft prompt context')],
  })
  hooks.Stop = upsertCodexHookGroup(hooks.Stop, {
    hooks: [codexHookHandler('Recording Skillcraft turn evidence')],
  })

  await writeJson(filePath, { hooks })
}

async function removeCodexHooks(repoPath: string): Promise<void> {
  const filePath = codexHooksPath(repoPath)
  const raw = await readJson<unknown>(filePath)
  if (!raw) {
    return
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`Invalid hooks file: ${filePath}`)
  }

  const current = raw as CodexHooksFile
  const hooks = current.hooks && typeof current.hooks === 'object' && !Array.isArray(current.hooks)
    ? { ...current.hooks }
    : {}

  for (const eventName of Object.keys(hooks)) {
    const groups = Array.isArray(hooks[eventName]) ? hooks[eventName] : []
    const nextGroups = groups
      .map((group) => {
        const commands = Array.isArray(group.hooks) ? group.hooks.filter((hook) => hook.command !== codexHookCommand) : []
        return commands.length ? { ...group, hooks: commands } : undefined
      })
      .filter((group): group is CodexHookGroup => !!group)

    if (nextGroups.length) {
      hooks[eventName] = nextGroups
    } else {
      delete hooks[eventName]
    }
  }

  if (!Object.keys(hooks).length) {
    await removeFile(filePath)
    return
  }

  await writeJson(filePath, { hooks })
}

async function writeCodexConfig(repoPath: string): Promise<void> {
  const filePath = codexConfigPath(repoPath)
  const current = await readText(filePath).catch(() => '')
  const next = enableCodexHooksInToml(current)
  if (next === current) {
    return
  }
  await writeText(filePath, next)
}

async function removeCodexManagedConfig(repoPath: string): Promise<void> {
  const filePath = codexConfigPath(repoPath)
  if (!(await fileExists(filePath))) {
    return
  }
  const current = await readText(filePath)
  const next = removeManagedTomlBlock(current)
  if (!next.trim()) {
    await removeFile(filePath)
    return
  }
  if (next !== current) {
    await writeText(filePath, next)
  }
}

function codexHookHandler(statusMessage: string): CodexHookCommand {
  return {
    type: 'command',
    command: codexHookCommand,
    statusMessage,
    timeout: 30,
  }
}

function upsertCodexHookGroup(current: CodexHookGroup[] | undefined, nextGroup: CodexHookGroup): CodexHookGroup[] {
  const groups = Array.isArray(current) ? [...current] : []
  const index = groups.findIndex((group) => (group.matcher || '') === (nextGroup.matcher || ''))
  if (index === -1) {
    groups.push(nextGroup)
    return groups
  }

  const existing = groups[index]
  const hooks = Array.isArray(existing.hooks) ? [...existing.hooks] : []
  for (const hook of nextGroup.hooks) {
    if (!hooks.some((entry) => entry.command === hook.command)) {
      hooks.push(hook)
    }
  }

  groups[index] = {
    ...existing,
    matcher: nextGroup.matcher ?? existing.matcher,
    hooks,
  }
  return groups
}

function enableCodexHooksInToml(source: string): string {
  const withoutManaged = removeManagedTomlBlock(source)
  if (/^\s*features\.codex_hooks\s*=\s*false\s*$/m.test(withoutManaged)) {
    return withoutManaged.replace(/^\s*features\.codex_hooks\s*=\s*false\s*$/m, 'features.codex_hooks = true')
  }
  if (/^\s*features\.codex_hooks\s*=\s*true\s*$/m.test(withoutManaged)) {
    return withoutManaged
  }

  const lines = withoutManaged.split(/\r?\n/)
  let inFeatures = false
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*\[.*\]\s*$/.test(line)) {
      inFeatures = line.trim() === '[features]'
      continue
    }

    if (inFeatures && /^\s*codex_hooks\s*=\s*false\s*$/.test(line)) {
      lines[index] = 'codex_hooks = true'
      return ensureTrailingNewline(lines.join('\n'))
    }
    if (inFeatures && /^\s*codex_hooks\s*=\s*true\s*$/.test(line)) {
      return ensureTrailingNewline(lines.join('\n'))
    }
  }

  const featuresIndex = lines.findIndex((line) => line.trim() === '[features]')
  const managedBlock = [codexTomlStart, 'codex_hooks = true', codexTomlEnd]
  if (featuresIndex !== -1) {
    lines.splice(featuresIndex + 1, 0, ...managedBlock)
    return ensureTrailingNewline(lines.join('\n'))
  }

  const prefix = withoutManaged.trim() ? `${withoutManaged.trimEnd()}\n\n` : ''
  return `${prefix}${codexTomlStart}\n[features]\ncodex_hooks = true\n${codexTomlEnd}\n`
}

function removeManagedTomlBlock(source: string): string {
  const escapedStart = codexTomlStart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedEnd = codexTomlEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matcher = new RegExp(`\\n?${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`, 'g')
  return ensureTrailingNewline(source.replace(matcher, '\n').replace(/\n{3,}/g, '\n\n').trimEnd())
}

function ensureTrailingNewline(source: string): string {
  return source ? `${source.replace(/\n+$/g, '')}\n` : ''
}

function getManagedOpencodePluginSource(): string {
  return `import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)

function normalizeProvider(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeModelName(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeSkillName(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')
    : ''
}

function extractModelInfo(payload) {
  if (!payload || typeof payload !== 'object') {
    return {}
  }

  const direct = {
    modelProvider: normalizeProvider(payload.model_provider || payload.modelProvider || payload.model_provider_id),
    modelName: normalizeModelName(payload.model_name || payload.modelName || payload.model),
    agentProvider: normalizeProvider(payload.provider || payload.agent_provider || payload.agentProvider),
  }

  const msg = payload.message
  const request = payload.request
  const context = payload.context

  const nestedMessage = msg && typeof msg === 'object' ? {
    modelProvider: normalizeProvider(msg.model_provider || msg.modelProvider),
    modelName: normalizeModelName(msg.model_name || msg.modelName || msg.model),
    agentProvider: normalizeProvider(msg.provider || msg.agent_provider || msg.agentProvider),
  } : {}

  const nestedRequest = request && typeof request === 'object' ? {
    modelProvider: normalizeProvider(request.model_provider || request.modelProvider),
    modelName: normalizeModelName(request.model_name || request.modelName || request.model),
    agentProvider: normalizeProvider(request.provider || request.agent_provider || request.agentProvider),
  } : {}

  const nestedContext = context && typeof context === 'object' ? {
    modelProvider: normalizeProvider(context.model_provider || context.modelProvider),
    modelName: normalizeModelName(context.model_name || context.modelName || context.model),
    agentProvider: normalizeProvider(context.provider || context.agent_provider || context.agentProvider),
  } : {}

  const candidate = {
    agentProvider: direct.agentProvider || nestedMessage.agentProvider || nestedRequest.agentProvider || nestedContext.agentProvider || 'opencode',
    modelProvider: direct.modelProvider || nestedMessage.modelProvider || nestedRequest.modelProvider || nestedContext.modelProvider,
    modelName: direct.modelName || nestedMessage.modelName || nestedRequest.modelName || nestedContext.modelName,
  }

  if (!candidate.modelProvider && !candidate.modelName && !candidate.agentProvider) {
    return {}
  }

  return candidate
}

function resolveStateFile(root) {
  return path.join(root, '.git', 'skillcraft', 'ai-model-context.json')
}

function resolveInstalledSkillsIndex(root) {
  return path.join(root, '.agents', 'skills', '.skillcraft-index.json')
}

async function updateState(root, update) {
  const stateFile = resolveStateFile(root)
  let current = {}

  try {
    const raw = await fs.readFile(stateFile, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      current = parsed
    }
  } catch {
    current = {}
  }

  const next = {
    ...(current || {}),
    ...(update || {}),
  }

  if (!next.agent || typeof next.agent !== 'object' || Array.isArray(next.agent)) {
    next.agent = { provider: 'opencode' }
  } else if (!next.agent.provider && update?.agent?.provider) {
    next.agent = { ...next.agent }
  }

  if (update?.agent?.provider) {
    next.agent.provider = update.agent.provider
  }

  if (update?.model) {
    next.model = {
      ...(next.model || {}),
      ...(update.model || {}),
    }
  }

  try {
    await fs.mkdir(path.join(root, '.git', 'skillcraft'), { recursive: true })
    await fs.writeFile(stateFile, JSON.stringify(next, null, 2) + '\n', 'utf8')
  } catch {
    return
  }
}

async function loadInstalledSkillId(root, skillName) {
  const normalized = normalizeSkillName(skillName)
  if (!normalized) {
    return undefined
  }

  try {
    const raw = await fs.readFile(resolveInstalledSkillsIndex(root), 'utf8')
    const parsed = JSON.parse(raw)
    const skills = Array.isArray(parsed?.skills) ? parsed.skills : []
    const match = skills.find((entry) => entry && typeof entry === 'object' && entry.name === normalized && typeof entry.id === 'string')
    return match?.id
  } catch {
    return undefined
  }
}

function extractSkillName(args) {
  if (!args) {
    return ''
  }
  if (typeof args === 'string') {
    return args.trim()
  }
  if (typeof args !== 'object') {
    return ''
  }

  const direct = [args.name, args.skill, args.id]
  for (const value of direct) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  for (const value of Object.values(args)) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }

  return ''
}

async function markSkillUsed(root, skillId) {
  if (!skillId) {
    return
  }

  try {
    await exec('skillcraft', ['_skill-used', skillId, root], { cwd: root })
  } catch {
    return
  }
}

async function handlePayload(root, payload) {
  if (!payload || typeof payload !== 'object') {
    return
  }

  const extracted = extractModelInfo(payload)
  if (!extracted || !extracted.agentProvider && !extracted.modelProvider && !extracted.modelName) {
    return
  }

  const update = {
    agent: {
      provider: extracted.agentProvider || 'opencode',
    },
    model: {
      ...(extracted.modelProvider ? { provider: extracted.modelProvider } : {}),
      ...(extracted.modelName ? { name: extracted.modelName } : {}),
    },
  }

  await updateState(root, update)
}

export default async function Skillcraft(context) {
  const repoRoot = context?.worktree || context?.directory || process.cwd()
  const handler = async (event) => {
    try {
      await handlePayload(repoRoot, event)
    } catch {
      return
    }
  }

  return {
    'chat.message': async (event) => {
      try {
        await handler(event)
      } catch {
        return
      }
    },
    'tool.execute.after': async (input) => {
      try {
        if (input?.tool !== 'skill') {
          return
        }
        const skillName = extractSkillName(input?.args)
        const skillId = await loadInstalledSkillId(repoRoot, skillName)
        await markSkillUsed(repoRoot, skillId)
      } catch {
        return
      }
    },
    event: async (event) => {
      try {
        const payload = event?.type && typeof event.type === 'string' ? event : event?.payload
        await handler(payload)
      } catch {
        return
      }
    },
  }
}
`
}
