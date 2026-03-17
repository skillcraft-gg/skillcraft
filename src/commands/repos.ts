import { loadRepos, saveRepos } from '@/core/config'
import { isGitRepo, gitRoot } from '@/core/git'

export async function runReposList(): Promise<void> {
  const data = await loadRepos()
  if (!data.repos.length) {
    process.stdout.write('no repositories tracked\n')
    return
  }
  data.repos.forEach((entry, index) => {
    process.stdout.write(`${index + 1}. ${entry.path}`)
    if (entry.remote) {
      process.stdout.write(` (${entry.remote})`)
    }
    process.stdout.write('\n')
  })
}

export async function runReposPrune(): Promise<void> {
  const data = await loadRepos()
  const next = [] as typeof data.repos
  for (const item of data.repos) {
    if (await isGitRepo(item.path)) {
      await gitRoot(item.path)
      next.push(item)
    }
  }
  await saveRepos({ repos: next })
  process.stdout.write(`pruned repo list: ${data.repos.length} -> ${next.length}\n`)
}
