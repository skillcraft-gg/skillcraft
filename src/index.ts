#!/usr/bin/env node
import { Command } from 'commander'
import packageJson from '../package.json'
import { runDisable } from './commands/disable.js'
import { runDoctor, runStatus } from './commands/status.js'
import { runEnable } from './commands/enable.js'
import { runReposList, runReposPrune } from './commands/repos.js'
import { runProgress, runProgressTrack, runProgressUntrack } from './commands/progress.js'
import {
  runSkillsAdd,
  runSkillsInspect,
  runSkillsList,
  runSkillsPublish,
  runSkillsSearch,
  runSkillUsed,
  runSkillsValidateAndExit,
} from './commands/skills.js'
import { runVerify } from './commands/verify.js'
import { runClaim, runClaimList, runClaimStatus } from './commands/claim.js'
import { runLoadoutUse, runLoadoutClear, runLoadoutShare } from './commands/loadout.js'
import { runAgentHook, runHook, runHookPush } from './commands/internalHook.js'
import { runLearn } from './commands/learn.js'
import { configureOutputMode, emitJsonError, getOutputMode, isJsonOutput, normalizeError, printError } from './lib/output.js'

const program = new Command()

program.name('skillcraft').description('Skillcraft CLI').version(packageJson.version)
program.option('--json', 'machine-readable JSON output')

program
  .command('enable')
  .description('Enable Skillcraft in the current repository')
  .option('--agent <name>', 'enable a specific agent integration (repeatable or comma-separated)', collectStrings, [])
  .action((options) => withCommand(() => runEnable({ agents: options.agent }))())

program
  .command('disable')
  .description('Disable Skillcraft in the current repository')
  .option('--agent <name>', 'disable a specific agent integration (repeatable or comma-separated)', collectStrings, [])
  .action((options) => withCommand(() => runDisable({ agents: options.agent }))())

program
  .command('status')
  .description('Show repository Skillcraft status')
  .action(withCommand(runStatus))

program
  .command('doctor')
  .description('Check environment and integration readiness')
  .action(withCommand(runDoctor))

program
  .command('learn')
  .description('Launch Skillcraft Learn Mode')
  .option('--agent <name>', 'use a specific learn-mode agent (currently opencode only)', collectStrings, [])
  .action((options) => withCommand(() => runLearn({ agents: options.agent }))())

const reposCommand = program.command('repos').description('Manage tracked repositories')
reposCommand.command('list').description('List tracked repositories').action(withCommand(runReposList))
reposCommand.command('prune').description('Remove unavailable repository entries').action(withCommand(runReposPrune))

const progressCommand = program.command('progress').description('Show progress for tracked credentials')
progressCommand
.option('--refresh', 'refresh the local credential index cache before evaluating progress')
.action((options) => {
  withCommand(() => runProgress({ outputMode: getOutputMode(), refreshIndex: options.refresh }))()
})

progressCommand
  .command('track <credential-id>')
  .description('Track a credential for local progress evaluation')
  .action((credentialId: string) => withCommand(() => runProgressTrack(credentialId))())

progressCommand
  .command('untrack <credential-id>')
  .description('Untrack a credential from local progress evaluation')
  .action((credentialId: string) => withCommand(() => runProgressUntrack(credentialId))())

const skillsCommand = program.command('skills').description('Manage local skill publishing')
skillsCommand
  .command('add <id>')
  .description('Add a local or external skill from the registry index')
  .action((id) => withCommand(() => runSkillsAdd(id))())

skillsCommand
  .command('publish <owner-slug>')
  .description('Publish a skill to the registry')
  .action((ownerSlug) => withCommand(() => runSkillsPublish(ownerSlug))())

skillsCommand
  .command('validate')
  .description('Validate local skill layout')
  .action(withCommand(runSkillsValidateAndExit))

skillsCommand
  .command('list')
  .description('List detected skills in the current repository')
  .action(withCommand(runSkillsList))

skillsCommand
  .command('inspect <id>')
  .description('Show detailed information for a registry skill')
  .action((id) => {
    withCommand(() => runSkillsInspect(id, { outputMode: getOutputMode() }))()
  })

skillsCommand
  .command('search [query]')
  .description('Search the published skill index')
  .option('--source <source>', 'filter to a registry source')
  .option('--limit <n>', 'limit number of results', (value) => Number.parseInt(value, 10))
  .action((query, options) => {
    withCommand(() => runSkillsSearch(query, { source: options.source, limit: options.limit, outputMode: getOutputMode() }))()
  })

program
  .command('verify')
  .description('Verify local Skillcraft proofs and trailers')
  .action(withCommand(runVerify))

const claimCommand = program.command('claim').description('Claim a credential or inspect your claims')
claimCommand
  .argument('[credential]', 'credential identifier')
  .option('--all-repos', 'include tracked repositories')
  .option('--repo <path...>', 'explicit repositories to include')
  .action((credential: string | undefined, options) => {
    if (!credential) {
      withCommand(() => runClaimList())()
      return
    }
    withCommand(() =>
      runClaim(credential, {
        allRepos: options.allRepos,
        repo: options.repo,
      }),
    )()
  })

claimCommand
  .command('list')
  .description('List your claims in the credentials repository')
  .action(withCommand(runClaimList))

claimCommand
  .command('status <credential>')
  .description('Show claim status by credential identifier')
  .action((credential) => withCommand(() => runClaimStatus(credential))())

const loadoutCommand = program.command('loadout').description('Manage active loadouts')
loadoutCommand
  .command('use <id>')
  .description('Activate a loadout in local context')
  .action((id) => withCommand(() => runLoadoutUse(id))())

loadoutCommand
  .command('clear')
  .description('Clear active loadouts')
  .action(withCommand(runLoadoutClear))

loadoutCommand
  .command('share <id>')
  .description('Publish local loadout to registry')
  .action((id) => withCommand(() => runLoadoutShare(id))())

program
  .command('_hook <name> [repoPath] [remote]', { hidden: true })
  .description('internal hook command')
  .action((name, repoPath, remote) => withCommand(async () => {
    if (name === 'post-commit') {
      await runHook(repoPath || process.cwd())
    }
    if (name === 'pre-push' || name === 'post-push') {
      await runHookPush(repoPath || process.cwd(), remote || 'origin')
    }
  })())

program
  .command('_agent-hook <agent> [repoPath]', { hidden: true })
  .description('internal agent hook command')
  .action((agent, repoPath) => withCommand(() => runAgentHook(agent, repoPath || process.cwd()))())

program
  .command('_skill-used <id> [repoPath]', { hidden: true })
  .description('internal skill evidence command')
  .action((id, repoPath) => withCommand(() => runSkillUsed(id, repoPath || process.cwd()))())

function withCommand<T extends (...args: readonly unknown[]) => Promise<void> | void>(fn: T): (...args: Parameters<T>) => Promise<void> {
  return async (...args: Parameters<T>) => {
    await Promise.resolve(fn(...args)).catch((error) => {
      const normalized = normalizeError(error)
      if (isJsonOutput()) {
        emitJsonError(normalized)
      } else {
        printError(normalized.message)
      }
      process.exitCode = 1
    })
  }
}

function collectStrings(value: string, previous: string[]): string[] {
  return [...previous, value]
}

configureOutputMode(process.argv)

await program.parseAsync(process.argv)
