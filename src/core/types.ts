import { z } from 'zod'

export const ProofVersionSchema = z.literal(1)

export const DefaultProofRef = 'skillcraft/proofs/v1'

export const PendingSchema = z.object({
  skills: z.array(z.string()).default([]),
})

export const ContextSchema = z.object({
  activeLoadouts: z.array(z.string()).default([]),
})

export const ProofAgentSchema = z.object({
  provider: z.string().optional(),
})

export const ProofModelSchema = z.object({
  provider: z.string().optional(),
  name: z.string().optional(),
})

export const AgentIntegrationSchema = z.enum(['opencode', 'codex'])

export const AgentStateSchema = z.object({
  version: z.number().int().default(1),
  providers: z.array(AgentIntegrationSchema).default([]),
  enabled: z.boolean().default(true),
})

export const InstalledSkillInstallSchema = z.object({
  type: z.enum(['github-directory', 'local-directory']),
  repo: z.string().optional(),
  ref: z.string().optional(),
  path: z.string(),
})

export const InstalledSkillRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  install: InstalledSkillInstallSchema,
  installedAt: z.string(),
})

export const InstalledSkillsFileSchema = z.object({
  version: z.number().int().default(1),
  skills: z.array(InstalledSkillRecordSchema).default([]),
})

export const PromptPreferencesSchema = z.object({
  starSkillcraftDisabled: z.boolean().default(false),
})

export const ConfigSchema = z.object({
  githubUser: z.string().optional(),
  provider: z.enum(['gh']).default('gh'),
  prompts: PromptPreferencesSchema.default({}),
  version: z.number().int().default(1),
  proofRef: z.string().default(DefaultProofRef),
})

export const RepoEntrySchema = z.object({
  path: z.string(),
  remote: z.string().optional(),
  enabledAt: z.string().optional(),
})

export const ReposFileSchema = z.object({
  repos: z.array(RepoEntrySchema).default([]),
})

export const TrackedCredentialSchema = z.object({
  id: z.string(),
  trackedAt: z.string().optional(),
})

export const TrackedCredentialsFileSchema = z.object({
  credentials: z.array(TrackedCredentialSchema).default([]),
})

export type Proof = {
  version: number
  commit: string
  skills: Array<{ id: string; version?: string }>
  loadouts: string[]
  timestamp: string
  agent?: {
    provider?: string
  }
  model?: {
    provider?: string
    name?: string
  }
}

export type RepoEntry = z.infer<typeof RepoEntrySchema>
export type ReposFile = z.infer<typeof ReposFileSchema>
export type TrackedCredentialEntry = z.infer<typeof TrackedCredentialSchema>
export type TrackedCredentialsFile = z.infer<typeof TrackedCredentialsFileSchema>
export type Config = z.infer<typeof ConfigSchema>
export type PendingFile = z.infer<typeof PendingSchema>
export type ContextFile = z.infer<typeof ContextSchema>
export type AgentIntegration = z.infer<typeof AgentIntegrationSchema>
export type AgentState = z.infer<typeof AgentStateSchema>
export type InstalledSkillInstall = z.infer<typeof InstalledSkillInstallSchema>
export type InstalledSkillRecord = z.infer<typeof InstalledSkillRecordSchema>
export type InstalledSkillsFile = z.infer<typeof InstalledSkillsFileSchema>

export type CliCommandResult = {
  ok: boolean
  message: string
  data?: unknown
}
