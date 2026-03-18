import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = join(__dirname, '..')
const cli = join(repoRoot, 'dist', 'index.js')

if (!existsSync(cli)) {
  throw new Error('Built CLI not found. Run `npm run build` before `npm test`.')
}

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim()
}

function runCli(args, cwd, env = process.env) {
  const result = spawnSync('node', [cli, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    code: result.status ?? 0,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  }
}

function assertOk(t, result, expectedText) {
  assert.equal(result.code, 0, `${t.name} exited with ${result.code}\n${result.output}`)
  assert.ok(result.output.includes(expectedText), `${t.name} missing output: ${expectedText}`)
}

function makeTempDir(name) {
  const dir = join(tmpdir(), `skillcraft-${name}-`)
  return mkdtempSync(dir)
}

function makeRepo(parentDir, name) {
  const repoDir = join(parentDir, name)
  mkdirSync(repoDir)
  runGit(repoDir, ['init'])
  runGit(repoDir, ['config', 'user.name', 'Skillcraft CLI Bot'])
  runGit(repoDir, ['config', 'user.email', 'bot@example.com'])
  writeFileSync(join(repoDir, 'README.md'), '# temp repo\n')
  runGit(repoDir, ['add', 'README.md'])
  runGit(repoDir, ['commit', '-m', 'initial commit'])
  return repoDir
}

describe('Skillcraft CLI surface smoke tests', () => {
  const tempBase = makeTempDir('smoke')
  const home = join(tempBase, 'home')
  const plain = join(tempBase, 'plain')
  const indexFile = join(tempBase, 'search-index.json')
  mkdirSync(home)
  mkdirSync(plain)
  const cliEnv = { ...process.env, HOME: home }
  const indexedCliEnv = { ...cliEnv, SKILLCRAFT_SEARCH_INDEX_PATH: indexFile }

  test('help command', (t) => {
    const result = runCli(['--help'], plain, cliEnv)
    assertOk(t, result, 'Usage: skillcraft')
  })

  test('status command in non-git directory', (t) => {
    const result = runCli(['status'], plain, cliEnv)
    assertOk(t, result, 'git: not a repository')
  })

  test('enable/status/disable flow', (t) => {
    const repo = makeRepo(tempBase, 'flow')
    let result = runCli(['status'], repo, cliEnv)
    assertOk(t, result, 'skillcraft: disabled')

    result = runCli(['enable'], repo, cliEnv)
    assertOk(t, result, 'enabled skillcraft')

    assert.ok(existsSync(join(home, '.skillcraft', 'config.json')))

    result = runCli(['status'], repo, cliEnv)
    assertOk(t, result, 'skillcraft: enabled')

    result = runCli(['disable'], repo, cliEnv)
    assertOk(t, result, 'disabled skillcraft')

    result = runCli(['status'], repo, cliEnv)
    assertOk(t, result, 'skillcraft: disabled')
  })

  test('repositories list and prune', (t) => {
    const repo = makeRepo(tempBase, 'repos')
    let result = runCli(['enable'], repo, cliEnv)
    assertOk(t, result, 'enabled skillcraft')

    result = runCli(['repos', 'list'], repo, cliEnv)
    assert.equal(result.code, 0)
    assert.ok(result.output.includes(repo))

    result = runCli(['repos', 'prune'], repo, cliEnv)
    assertOk(t, result, 'pruned repo list:')

    runCli(['disable'], repo, cliEnv)
  })

  test('skills validate and list', (t) => {
    const repo = makeRepo(tempBase, 'skills')
    runCli(['enable'], repo, cliEnv)

    writeFileSync(join(repo, 'SKILL.md'), '# Skill\n')
    writeFileSync(join(repo, 'skill.yaml'), 'id: acme/skill\n')

    let result = runCli(['skills', 'validate'], repo, cliEnv)
    assertOk(t, result, 'SKILL.md: ok')
    assertOk(t, result, 'skill.yaml: ok')

    result = runCli(['skills', 'list'], repo, cliEnv)
    assertOk(t, result, 'no skills detected')

    runCli(['disable'], repo, cliEnv)
  })

  test('skills add supports local and external IDs', (t) => {
    const repo = makeRepo(tempBase, 'skills-add')
    runCli(['enable'], repo, cliEnv)

    writeFileSync(
      indexFile,
      JSON.stringify(
        [
          { id: 'acme/alpha', name: 'Alpha skill' },
          { id: 'anthropic:xlsx', name: 'XLSX' },
          { id: 'anthropic:team/agent', name: 'Agent' },
        ],
        null,
        2,
      ),
    )

    let result = runCli(['skills', 'add', 'acme/alpha'], repo, indexedCliEnv)
    assertOk(t, result, 'queued skill: acme/alpha')

    result = runCli(['skills', 'add', 'anthropic:xlsx'], repo, indexedCliEnv)
    assertOk(t, result, 'queued skill: anthropic:xlsx')

    result = runCli(['skills', 'add', 'anthropic:team/agent'], repo, indexedCliEnv)
    assertOk(t, result, 'queued skill: anthropic:team/agent')

    result = runCli(['skills', 'add', 'acme/alpha'], repo, indexedCliEnv)
    assertOk(t, result, 'queued skill: acme/alpha')

    const pending = JSON.parse(readFileSync(join(repo, '.git', 'skillcraft', 'pending.json'), 'utf8'))
    assert.deepStrictEqual(pending.skills, ['acme/alpha', 'anthropic:team/agent', 'anthropic:xlsx'])

    result = runCli(['skills', 'add', 'missing:slip'], repo, indexedCliEnv)
    assert.equal(result.code, 1)
    assert.ok(result.output.includes('is not listed in the search index'))

    runCli(['disable'], repo, cliEnv)
  })

  test('skills search lists indexed entries', (t) => {
    const repo = makeRepo(tempBase, 'skills-search')
    runCli(['enable'], repo, cliEnv)

    writeFileSync(
      indexFile,
      JSON.stringify(
        [
          { id: 'acme/alpha', name: 'Alpha Skill', owner: 'acme', slug: 'alpha', tags: ['security', 'analysis'] },
          { id: 'anthropic:xlsx', name: 'XLSX Toolkit', path: 'tools/xlsx', runtime: ['python'], tags: ['data'] },
          { id: 'anthropic:team/agent', name: 'Agent Assistant' },
        ],
        null,
        2,
      ),
    )

    let result = runCli(['skills', 'search'], repo, indexedCliEnv)
    assertOk(t, result, 'skills index (3):')
    assertOk(t, result, 'acme/alpha')
    assertOk(t, result, 'XLSX Toolkit')

    result = runCli(['skills', 'search', 'alpha'], repo, indexedCliEnv)
    assertOk(t, result, 'skills matching "alpha" (1):')
    assertOk(t, result, 'acme/alpha')

    result = runCli(['skills', 'search', 'missing', '--source', 'anthropic'], repo, indexedCliEnv)
    assert.ok(result.output.includes('no skills match "missing"'))
    assert.ok(!result.output.includes('acme/alpha'))

    result = runCli(['skills', 'search', 'agent', '--source', 'anthropic'], repo, indexedCliEnv)
    assertOk(t, result, 'skills matching "agent"')
    assertOk(t, result, 'anthropic:team/agent')

    runCli(['disable'], repo, cliEnv)
  })

  test('skills inspect shows manifest details', (t) => {
    const repo = makeRepo(tempBase, 'skills-inspect')
    runCli(['enable'], repo, cliEnv)
    writeFileSync(
      indexFile,
      JSON.stringify(
        [
          {
            id: 'acme/xlsx',
            name: 'XLSX Toolkit',
            path: 'skills/acme/xlsx/',
            url: 'https://github.com/anthropics/skills/blob/main/skills/xlsx/',
            owner: 'acme',
            slug: 'xlsx',
            runtime: ['node'],
            tags: ['data', 'office'],
            updatedAt: '2026-03-17T12:00:00.000Z',
          },
        ],
        null,
        2,
      ),
    )

    const result = runCli(['skills', 'inspect', 'acme/xlsx'], repo, indexedCliEnv)
    assertOk(t, result, 'skill: acme/xlsx')
    assertOk(t, result, 'name: XLSX Toolkit')
    assertOk(t, result, 'runtime: node')
    assertOk(t, result, 'tags: data, office')
    assertOk(t, result, 'manifest: https://github.com/anthropics/skills/raw/refs/heads/main/skills/xlsx/SKILL.md')
    assert.ok(result.output.includes('manifest fetch:') || result.output.includes('manifest title:'))

    runCli(['disable'], repo, cliEnv)
  })

  test('skills inspect supports json output', (t) => {
    const repo = makeRepo(tempBase, 'skills-inspect-json')
    runCli(['enable'], repo, cliEnv)

    writeFileSync(
      indexFile,
      JSON.stringify(
        [
          { id: 'acme/beta', name: 'Beta Skill', owner: 'acme', slug: 'beta', runtime: ['python'], tags: ['analysis'] },
        ],
        null,
        2,
      ),
    )

    const result = runCli(['skills', 'inspect', 'acme/beta', '--json'], repo, indexedCliEnv)
    assert.equal(result.code, 0)
    const payload = JSON.parse(result.output.trim())
    assert.equal(payload.id, 'acme/beta')
    assert.equal(payload.name, 'Beta Skill')
    assert.deepStrictEqual(payload.runtime, ['python'])
    assert.equal(payload.source, undefined)

    runCli(['disable'], repo, cliEnv)
  })

  test('skills search supports limit', (t) => {
    const repo = makeRepo(tempBase, 'skills-search-limit')
    runCli(['enable'], repo, cliEnv)

    writeFileSync(
      indexFile,
      JSON.stringify(
        [
          { id: 'acme/skill-a', name: 'A Skill', tags: ['one'] },
          { id: 'acme/skill-b', name: 'B Skill', tags: ['two'] },
          { id: 'acme/skill-c', name: 'C Skill', tags: ['three'] },
        ],
        null,
        2,
      ),
    )

    const result = runCli(['skills', 'search', 'skill', '--limit', '2'], repo, indexedCliEnv)
    assertOk(t, result, 'skills matching "skill" (2):')
    assert.ok(!result.output.includes('acme/skill-c'))

    runCli(['disable'], repo, cliEnv)
  })

  test('skills search supports json output', (t) => {
    const repo = makeRepo(tempBase, 'skills-search-json')
    runCli(['enable'], repo, cliEnv)

    writeFileSync(
      indexFile,
      JSON.stringify(
        [
          { id: 'acme/alpha', name: 'Alpha Skill', tags: ['security'] },
          { id: 'acme/beta', name: 'Beta Skill', tags: ['analysis'] },
        ],
        null,
        2,
      ),
    )

    const result = runCli(['skills', 'search', 'skill', '--json'], repo, indexedCliEnv)
    assert.equal(result.code, 0)
    const payload = JSON.parse(result.output.trim())
    assert.equal(payload.query, 'skill')
    assert.equal(payload.count, 2)
    assert.equal(payload.results.length, 2)
    assert.equal(payload.results[0].id, 'acme/alpha')

    runCli(['disable'], repo, cliEnv)
  })

  test('loadout progress and hook path', (t) => {
    const repo = makeRepo(tempBase, 'loadout')
    let result = runCli(['enable'], repo, cliEnv)
    assertOk(t, result, 'enabled skillcraft')

    result = runCli(['loadout', 'use', 'acme/dev'], repo, cliEnv)
    assertOk(t, result, 'activated loadout: acme/dev')

    result = runCli(['progress'], repo, cliEnv)
    assertOk(t, result, 'commits-with-proof:')
    assertOk(t, result, 'proof files:')

    result = runCli(['loadout', 'clear'], repo, cliEnv)
    assertOk(t, result, 'cleared active loadouts')

    result = runCli(['_hook', 'post-commit', repo], repo, cliEnv)
    assert.equal(result.code, 0)

    runCli(['disable'], repo, cliEnv)
  })

  test('verify baseline path', (t) => {
    const repo = makeRepo(tempBase, 'verify')
    runCli(['enable'], repo, cliEnv)

    const result = runCli(['verify'], repo, cliEnv)
    assertOk(t, result, 'verify passed: 0 commit proofs resolved')

    runCli(['disable'], repo, cliEnv)
  })

  test('proofs are stored on proof branch', (t) => {
    const repo = makeRepo(tempBase, 'proof-branch')
    runCli(['enable'], repo, cliEnv)

    const pending = join(repo, '.git', 'skillcraft', 'pending.json')
    writeFileSync(pending, JSON.stringify({ skills: ['acme/alpha'] }))
    writeFileSync(join(repo, 'proof.txt'), 'change\n')
    runGit(repo, ['add', 'proof.txt'])
    runGit(repo, ['commit', '-m', 'add proof file'])

    const hookResult = runCli(['_hook', 'post-commit', repo], repo, cliEnv)
    assertOk(t, hookResult, '')

    const headMessage = runGit(repo, ['log', '-n', '1', '--pretty=%B'])
    const match = headMessage.match(/Skillcraft-Ref:\s*(\S+)/)
    assert.ok(match)
    const proofId = match?.[1]
    assert.equal(typeof proofId, 'string')

    const proofFiles = runGit(repo, ['ls-tree', '-r', '--name-only', 'skillcraft/proofs/v1', '--', 'proofs'])
    assert.ok(proofFiles.includes(`${`proofs`}/${proofId}.json`))

    const proofJson = runGit(repo, [`show`, `skillcraft/proofs/v1:proofs/${proofId}.json`])
    const proof = JSON.parse(proofJson)
    assert.equal(typeof proof.commit, 'string')
    assert.ok(proof.skills.some((entry) => entry.id === 'acme/alpha'))

    const oldPath = join(repo, '.git', 'refs', 'skillcraft', 'checkpoints', 'v1')
    assert.equal(existsSync(oldPath), false)

    const result = runCli(['verify'], repo, cliEnv)
    assertOk(t, result, `verify passed: 1 commit proofs resolved`)

    runCli(['disable'], repo, cliEnv)
  })

  test('verify reads proofs from remote branch', (t) => {
    const sourceRepo = makeRepo(tempBase, 'verify-remote-source')
    runCli(['enable'], sourceRepo, cliEnv)

    const pending = join(sourceRepo, '.git', 'skillcraft', 'pending.json')
    writeFileSync(pending, JSON.stringify({ skills: ['acme/alpha'] }))
    writeFileSync(join(sourceRepo, 'proof.txt'), 'change\n')
    runGit(sourceRepo, ['add', 'proof.txt'])
    runGit(sourceRepo, ['commit', '-m', 'add proof file'])

    assert.equal(existsSync(join(sourceRepo, '.git', 'hooks', 'post-commit')), true)
    assert.equal(existsSync(join(sourceRepo, '.git', 'hooks', 'pre-push')), true)

    const remote = join(tempBase, 'verify-remote-origin.git')
    mkdirSync(remote, { recursive: true })
    runGit(remote, ['init', '--bare'])
    runGit(sourceRepo, ['remote', 'add', 'origin', remote])

    const hookResult = runCli(['_hook', 'post-commit', sourceRepo], sourceRepo, cliEnv)
    assertOk(t, hookResult, '')

    const headMessage = runGit(sourceRepo, ['log', '-n', '1', '--pretty=%B'])
    const match = headMessage.match(/Skillcraft-Ref:\s*(\S+)/)
    assert.ok(match)
    assert.equal(typeof match?.[1], 'string')

    runGit(sourceRepo, ['push', '--force', 'origin', 'HEAD'])

    const remoteProofBranch = runGit(sourceRepo, ['ls-remote', '--heads', 'origin', 'skillcraft/proofs/v1'])
    assert.ok(remoteProofBranch.includes('refs/heads/skillcraft/proofs/v1'))

    const clone = join(tempBase, 'verify-remote-clone')
    runGit(tempBase, ['clone', remote, clone])
    mkdirSync(join(clone, '.skillcraft'), { recursive: true })
    writeFileSync(join(clone, '.skillcraft', '.skillcraft.json'), JSON.stringify({ proofRef: 'skillcraft/proofs/v1' }))

    const remoteResult = runCli(['verify'], clone, cliEnv)
    assertOk(t, remoteResult, `verify passed: 1 commit proofs resolved`)

    assert.equal(existsSync(join(clone, '.git', 'refs', 'heads', 'skillcraft', 'proofs', 'v1')), false)
  })

  after(() => {
    rmSync(tempBase, { recursive: true, force: true })
  })
})
