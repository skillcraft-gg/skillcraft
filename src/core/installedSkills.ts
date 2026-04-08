import path from 'node:path'
import { readJson, writeJson } from './fs.js'
import { installedSkillsIndexPath, pendingPath } from './paths.js'
import { InstalledSkillsFileSchema, type InstalledSkillInstall, type InstalledSkillRecord } from './types.js'
import { normalizeSkillId } from './validation.js'

export async function loadInstalledSkills(repoPath: string): Promise<InstalledSkillRecord[]> {
  const raw = await readJson<unknown>(installedSkillsIndexPath(repoPath))
  const parsed = InstalledSkillsFileSchema.safeParse(raw ?? { version: 1, skills: [] })
  return parsed.success ? parsed.data.skills : []
}

export async function saveInstalledSkills(repoPath: string, skills: readonly InstalledSkillRecord[]): Promise<void> {
  const normalized = [...skills].sort((left, right) => left.id.localeCompare(right.id))
  await writeJson(installedSkillsIndexPath(repoPath), {
    version: 1,
    skills: normalized,
  })
}

export async function registerInstalledSkill(repoPath: string, skill: InstalledSkillRecord): Promise<void> {
  const existing = await loadInstalledSkills(repoPath)
  const filtered = existing.filter((entry) => entry.id !== skill.id && entry.name !== skill.name)
  filtered.push(skill)
  await saveInstalledSkills(repoPath, filtered)
}

export async function resolveInstalledSkillId(repoPath: string, name: string): Promise<string | undefined> {
  const normalized = normalizeInstalledSkillName(name)
  if (!normalized) {
    return undefined
  }

  const skills = await loadInstalledSkills(repoPath)
  return skills.find((entry) => entry.name === normalized)?.id
}

export async function queueSkillUsage(repoPath: string, rawId: string): Promise<void> {
  const normalized = normalizeSkillId(rawId)
  if (!normalized) {
    throw new Error(`invalid skill id format: ${rawId}`)
  }

  const current = await readJson<unknown>(pendingPath(repoPath))
  const pending = current && typeof current === 'object' && !Array.isArray(current) && Array.isArray((current as { skills?: unknown[] }).skills)
    ? (current as { skills: unknown[] }).skills
    : []

  const next = Array.from(new Set(pending
    .map((entry) => (typeof entry === 'string' ? normalizeSkillId(entry) : undefined))
    .filter((entry): entry is string => !!entry)
    .concat(normalized))).sort()

  await writeJson(pendingPath(repoPath), { skills: next })
}

export function normalizeInstalledSkillName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')

  return normalized || 'skillcraft-skill'
}

export function buildInstalledSkillRecord(input: {
  id: string
  name: string
  install: InstalledSkillInstall
  installedAt: string
}): InstalledSkillRecord {
  return {
    id: input.id,
    name: input.name,
    path: path.posix.join('.agents', 'skills', input.name),
    install: input.install,
    installedAt: input.installedAt,
  }
}
