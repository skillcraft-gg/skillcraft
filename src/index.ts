#!/usr/bin/env node
import { Command } from 'commander'
import { runDisable } from './commands/disable.js'
import { runDoctor, runStatus } from './commands/status.js'
import { runEnable } from './commands/enable.js'
import { runReposList, runReposPrune } from './commands/repos.js'
import { runProgress } from './commands/progress.js'
import {
  runSkillsAdd,
  runSkillsInspect,
  runSkillsList,
  runSkillsPublish,
  runSkillsSearch,
  runSkillsValidateAndExit,
} from './commands/skills.js'
import { runVerify } from './commands/verify.js'
import { runClaim, runClaimList, runClaimStatus } from './commands/claim.js'
import { runLoadoutUse, runLoadoutClear, runLoadoutShare } from './commands/loadout.js'
import { runHook } from './commands/internalHook.js'
import { runHookPush } from './commands/internalHook.js'

const program = new Command()

program.name('skillcraft').description('Skillcraft CLI').version('0.1.0')
program.option('--json', 'machine-readable JSON output')

program
  .command('enable')
  .description('Enable Skillcraft in the current repository')
  .action(withCommand(runEnable))

program
  .command('disable')
  .description('Disable Skillcraft in the current repository')
  .action(withCommand(runDisable))

program
  .command('status')
  .description('Show repository Skillcraft status')
  .action(withCommand(runStatus))

program
  .command('doctor')
  .description('Check environment and integration readiness')
  .action(withCommand(runDoctor))

const reposCommand = program.command('repos').description('Manage tracked repositories')
reposCommand.command('list').description('List tracked repositories').action(withCommand(runReposList))
reposCommand.command('prune').description('Remove unavailable repository entries').action(withCommand(runReposPrune))

program
  .command('progress')
  .description('Show evidence progress across tracked repositories')
  .action(withCommand(() => runProgress()))

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
  .action((id, _options, command) => {
    const outputMode = command.parent?.parent?.opts()?.json ? 'json' : 'text'
    withCommand(() => runSkillsInspect(id, { outputMode }))()
  })

skillsCommand
  .command('search [query]')
  .description('Search the published skill index')
  .option('--source <source>', 'filter to a registry source')
  .option('--limit <n>', 'limit number of results', (value) => Number.parseInt(value, 10))
  .action((query, options, command) => {
    const outputMode = command.parent?.parent?.opts()?.json ? 'json' : 'text'
    withCommand(() => runSkillsSearch(query, { source: options.source, limit: options.limit, outputMode }))()
  })

program
  .command('verify')
  .description('Verify local Skillcraft proofs and trailers')
  .action(withCommand(runVerify))

const claimCommand = program.command('claim').description('Claim a credential or inspect claim issues')
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
  .description('List claims in the credentials repository')
  .action(withCommand(runClaimList))

claimCommand
  .command('status <issue>')
  .description('Show claim issue status')
  .action((issue) => withCommand(() => runClaimStatus(issue))())

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

function withCommand<T extends (...args: readonly unknown[]) => Promise<void> | void>(fn: T): (...args: Parameters<T>) => void {
  return (...args: Parameters<T>) => {
    void Promise.resolve(fn(...args)).catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    })
  }
}

program.parse(process.argv)
