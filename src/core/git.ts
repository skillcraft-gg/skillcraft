import { execFile as execFileCb, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'

const execFile = promisify(execFileCb)

type GitOptions = {
  env?: NodeJS.ProcessEnv
}

export async function git(args: readonly string[], cwd: string, options: GitOptions = {}): Promise<string> {
  try {
    const { stdout } = await execFile('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      env: options.env,
    })
    return stdout.trim()
  } catch (error) {
    const message = (error as { message?: string }).message ?? String(error)
    throw new Error(`git command failed in ${cwd}: ${message}`)
  }
}

async function gitWithInput(args: readonly string[], cwd: string, input: string, options: GitOptions = {}): Promise<string> {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      reject(new Error(`git command failed in ${cwd}: ${error.message}`))
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim())
        return
      }

      const message = stderr.trim() || stdout.trim() || `process exited with code ${code ?? 'unknown'}`
      reject(new Error(`git command failed in ${cwd}: ${message}`))
    })

    child.stdin.end(input)
  })
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

export async function gitRemote(cwd: string, remote = 'origin'): Promise<string | undefined> {
  try {
    const value = await git(['config', '--get', `remote.${remote}.url`], cwd)
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

export async function gitHasRef(cwd: string, ref: string): Promise<boolean> {
  try {
    await git(['show-ref', '--verify', '--quiet', ref], cwd)
    return true
  } catch {
    return false
  }
}

export async function gitCreateUnrelatedBranch(cwd: string, branch: string, message: string): Promise<void> {
  const ref = `refs/heads/${branch}`
  if (await gitHasRef(cwd, ref)) {
    return
  }

  const emptyTree = await gitWithInput(['hash-object', '-t', 'tree', '--stdin'], cwd, '')
  const commit = await git(['commit-tree', emptyTree, '-m', message], cwd)
  await git(['update-ref', ref, commit], cwd)
}

export async function gitIsAncestor(cwd: string, ancestor: string, descendant = 'HEAD'): Promise<boolean> {
  try {
    await git(['merge-base', '--is-ancestor', ancestor, descendant], cwd)
    return true
  } catch {
    return false
  }
}

export async function gitLsTreeNames(cwd: string, ref: string, subPath?: string): Promise<string[]> {
  try {
    const raw = await git(['ls-tree', '-r', '--name-only', ref, '--', ...(subPath ? [subPath] : [])], cwd)
    return raw ? raw.split('\n').filter(Boolean) : []
  } catch {
    return []
  }
}

export async function gitShowText(cwd: string, ref: string, filePath: string): Promise<string | undefined> {
  try {
    return await git(['show', `${ref}:${filePath}`], cwd)
  } catch {
    return undefined
  }
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
