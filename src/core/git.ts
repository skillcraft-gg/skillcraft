import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const execFile = promisify(execFileCb)

export async function git(args: readonly string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFile('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (error) {
    const message = (error as { message?: string }).message ?? String(error)
    throw new Error(`git command failed in ${cwd}: ${message}`)
  }
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--git-dir'], cwd)
    return true
  } catch {
    return false
  }
}

export async function gitRoot(cwd: string): Promise<string> {
  return path.resolve(await git(['rev-parse', '--show-toplevel'], cwd))
}

export async function gitRemote(cwd: string): Promise<string | undefined> {
  try {
    const value = await git(['config', '--get', 'remote.origin.url'], cwd)
    return value || undefined
  } catch {
    return undefined
  }
}

export async function gitCommitMessage(cwd: string, commit = 'HEAD'): Promise<string> {
  return git(['log', '--format=%B', '-n', '1', commit], cwd)
}

export async function gitHeadCommit(cwd: string): Promise<string> {
  return (await git(['rev-parse', 'HEAD'], cwd)).trim()
}

export async function gitLogWithMessages(cwd: string, maxCount?: number): Promise<Array<{ commit: string; message: string }>> {
  const n = maxCount ? String(maxCount) : '200'
  const raw = await git(['log', `--max-count=${n}`, '--pretty=%H%x00%B'], cwd)
  if (!raw) {
    return []
  }
  return raw
    .split('\u0000')
    .filter(Boolean)
    .map((entry) => {
      const [commit, ...messageParts] = entry.split('\n')
      const message = messageParts.join('\n').trimEnd()
      return { commit, message }
    })
}

export async function amendCommitMessage(cwd: string, message: string): Promise<string> {
  const env = { ...process.env, SKILLCRAFT_HOOK_DISABLED: '1' }
  const tempFile = path.join(cwd, '.git', 'SKILLCRAFT_COMMIT_MESSAGE')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(tempFile, `${message}\n`, 'utf8')
  await execFile('git', ['commit', '--amend', '--file', tempFile, '--no-gpg-sign'], {
    cwd,
    encoding: 'utf8',
    env,
  })
  return gitHeadCommit(cwd)
}
