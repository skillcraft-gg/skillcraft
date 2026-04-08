import fs from 'node:fs/promises'
import path from 'node:path'
import { loadInstalledSkills, queueSkillUsage } from './installedSkills.js'
import type { InstalledSkillRecord } from './types.js'

type CodexHookPayload = {
  hook_event_name?: string
  turn_id?: string
  cwd?: string
  transcript_path?: string
  tool_input?: {
    command?: string
  }
}

export async function recordCodexSkillUsage(repoPath: string, payload: unknown): Promise<void> {
  const installed = await loadInstalledSkills(repoPath)
  if (!installed.length) {
    return
  }

  const parsed = normalizePayload(payload)
  if (!parsed.hook_event_name) {
    return
  }

  const usedSkillIds = new Set<string>()
  if (parsed.hook_event_name === 'Stop') {
    for (const skillId of await detectExplicitSkillUsage(repoPath, installed, parsed.transcript_path, parsed.turn_id)) {
      usedSkillIds.add(skillId)
    }
  }

  for (const skillId of usedSkillIds) {
    await queueSkillUsage(repoPath, skillId)
  }
}

function normalizePayload(payload: unknown): CodexHookPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {}
  }

  const record = payload as Record<string, unknown>
  const toolInput = record.tool_input
  return {
    hook_event_name: normalizeText(record.hook_event_name),
    turn_id: normalizeText(record.turn_id),
    cwd: normalizeText(record.cwd),
    transcript_path: normalizeText(record.transcript_path),
    tool_input:
      toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput)
        ? { command: normalizeText((toolInput as Record<string, unknown>).command) }
        : undefined,
  }
}

async function detectExplicitSkillUsage(
  repoPath: string,
  installed: readonly InstalledSkillRecord[],
  transcriptPath?: string,
  targetTurnId?: string,
): Promise<string[]> {
  if (!transcriptPath || !targetTurnId) {
    return []
  }

  const raw = await fs.readFile(transcriptPath, 'utf8').catch(() => '')
  if (!raw.trim()) {
    return []
  }

  const installedByPath = new Map<string, string>()
  const installedByName = new Map<string, string>()
  for (const skill of installed) {
    installedByName.set(skill.name, skill.id)
    installedByPath.set(normalizeFsPath(path.join(repoPath, skill.path, 'SKILL.md')), skill.id)
  }

  const detected = new Set<string>()
  let activeTurnId: string | undefined
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      continue
    }

    const record = parsed as Record<string, unknown>
    if (record.type === 'turn_context') {
      activeTurnId = extractTurnContextTurnId(record.payload)
      continue
    }

    if (record.type !== 'response_item' || activeTurnId !== targetTurnId) {
      continue
    }

    for (const entry of extractExplicitSkillReferences(record.payload)) {
      const skillId =
        (entry.path ? installedByPath.get(normalizeFsPath(entry.path)) : undefined)
        || (entry.name ? installedByName.get(entry.name) : undefined)
      if (skillId) {
        detected.add(skillId)
      }
    }
  }

  return Array.from(detected).sort()
}

function extractTurnContextTurnId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined
  }
  return normalizeText((payload as Record<string, unknown>).turn_id)
}

function extractExplicitSkillReferences(payload: unknown): Array<{ name?: string; path?: string }> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return []
  }

  const record = payload as Record<string, unknown>
  if (record.type !== 'message' || normalizeText(record.role) !== 'user' || !Array.isArray(record.content)) {
    return []
  }

  const matches: Array<{ name?: string; path?: string }> = []
  for (const item of record.content) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue
    }

    const text = normalizeText((item as Record<string, unknown>).text)
    if (!text) {
      continue
    }

    const skillBlocks = text.matchAll(/<skill>\s*<name>([^<]+)<\/name>\s*<path>([^<]+)<\/path>[\s\S]*?<\/skill>/g)
    for (const block of skillBlocks) {
      matches.push({
        name: normalizeInstalledSkillName(block[1] || ''),
        path: normalizeText(block[2]),
      })
    }
  }

  return matches
}

function normalizeInstalledSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeFsPath(filePath: string): string {
  return path.resolve(filePath)
}

function normalizeText(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}
