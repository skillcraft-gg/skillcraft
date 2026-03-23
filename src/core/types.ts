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

export const ConfigSchema = z.object({
  githubUser: z.string().optional(),
  provider: z.enum(['gh']).default('gh'),
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
export type Config = z.infer<typeof ConfigSchema>
export type PendingFile = z.infer<typeof PendingSchema>
export type ContextFile = z.infer<typeof ContextSchema>

export type CliCommandResult = {
  ok: boolean
  message: string
  data?: unknown
}
