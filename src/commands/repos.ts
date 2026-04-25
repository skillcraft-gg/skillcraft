import { loadRepos, saveRepos } from '@/core/config'
import { isGitRepo, gitRoot } from '@/core/git'
import { emitJson, getOutputMode, printBulletList, printEmpty, printHeader, printRows, printSection, printSuccess } from '@/lib/output'

export async function runReposList(): Promise<void> {
  const data = await loadRepos()
  if (getOutputMode() === 'json') {
    emitJson({
      count: data.repos.length,
      repos: data.repos,
    })
    return
  }

  if (!data.repos.length) {
    printHeader('Tracked Repositories')
    printEmpty('no repositories tracked')
    return
  }

  printHeader('Tracked Repositories')
  printSection('Repositories')
  printBulletList(data.repos.map((entry, index) => `${index + 1}. ${entry.path}${entry.remote ? ` (${entry.remote})` : ''}`))
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
  const message = `pruned repo list: ${data.repos.length} -> ${next.length}`
  if (getOutputMode() === 'json') {
    emitJson({
      before: data.repos.length,
      after: next.length,
      removed: data.repos.length - next.length,
      message,
    })
    return
  }

  printHeader('Tracked Repositories')
  printSuccess(message)
  printRows([
    { label: 'before', value: data.repos.length },
    { label: 'after', value: next.length },
    { label: 'removed', value: data.repos.length - next.length, tone: data.repos.length - next.length ? 'warning' : 'muted' },
  ])
}
