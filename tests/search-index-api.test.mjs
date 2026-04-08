import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = join(__dirname, '..')
const cli = join(repoRoot, 'dist', 'index.js')

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

function writeSearchIndex(indexPath, entries) {
  writeFileSync(indexPath, JSON.stringify(entries, null, 2))
}

function readPendingSkills(repoDir) {
  const pendingPath = join(repoDir, '.git', 'skillcraft', 'pending.json')
  return JSON.parse(readFileSync(pendingPath, 'utf8')).skills
}

function readInstalledSkills(repoDir) {
  const manifestPath = join(repoDir, '.agents', 'skills', '.skillcraft-index.json')
  return JSON.parse(readFileSync(manifestPath, 'utf8')).skills
}

function makeSkillFixture(parentDir, name, description = 'Fixture skill') {
  const skillDir = join(parentDir, name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---
name: ${name}
description: ${description}
---

# ${name}

Fixture instructions.
`)
  return skillDir
}

describe('skill index public API behavior', () => {
  const tempBase = makeTempDir('search-index')
  const home = join(tempBase, 'home')
  const indexFile = join(tempBase, 'search-index.json')

  mkdirSync(home)

  const cliEnv = { ...process.env, HOME: home }
  const indexedCliEnv = { ...cliEnv, SKILLCRAFT_SEARCH_INDEX_PATH: indexFile }

  after(() => {
    rmSync(tempBase, { recursive: true, force: true })
  })

  test('skills search filters by source and query through CLI', (t) => {
    const repo = makeRepo(tempBase, 'search')
    writeSearchIndex(indexFile, [
      { id: 'acme/alpha', name: 'Alpha Skill', owner: 'acme', slug: 'alpha', tags: ['utility'] },
      { id: 'anthropic:xlsx', name: 'Spreadsheet Toolkit', runtime: ['python'] },
      { id: 'anthropic:team/agent', name: 'Team Agent', tags: ['automation'] },
    ])

    let result = runCli(['--json', 'skills', 'search'], repo, indexedCliEnv)
    assertOk(t, result, '"count":3')
    const payload = JSON.parse(result.output.trim())
    assert.equal(payload.query, undefined)
    assert.equal(payload.total, 3)
    assert.deepStrictEqual(payload.results.map((entry) => entry.id), ['acme/alpha', 'anthropic:xlsx', 'anthropic:team/agent'])

    result = runCli(['--json', 'skills', 'search', '--source', 'anthropic'], repo, indexedCliEnv)
    assertOk(t, result, '"count":2')
    const externalOnly = JSON.parse(result.output.trim())
    assert.deepStrictEqual(externalOnly.results.map((entry) => entry.id), ['anthropic:xlsx', 'anthropic:team/agent'])

    result = runCli(['--json', 'skills', 'search', 'team', '--source', 'anthropic'], repo, indexedCliEnv)
    assertOk(t, result, '"count":1')
    const queryMatch = JSON.parse(result.output.trim())
    assert.deepStrictEqual(queryMatch.results.map((entry) => entry.id), ['anthropic:team/agent'])
  })

  test('skills add accepts local and external entries from index', (t) => {
    const repo = makeRepo(tempBase, 'add')
    runCli(['enable', '--agent', 'opencode'], repo, cliEnv)

    const fixtureRoot = join(tempBase, 'fixtures-add')
    mkdirSync(fixtureRoot, { recursive: true })
    const alphaDir = makeSkillFixture(fixtureRoot, 'alpha')
    const xlsxDir = makeSkillFixture(fixtureRoot, 'xlsx')
    const agentDir = makeSkillFixture(fixtureRoot, 'agent')

    writeSearchIndex(indexFile, [
      { id: 'acme/alpha', name: 'Alpha Skill', install: { type: 'local-directory', path: alphaDir } },
      { id: 'anthropic:xlsx', name: 'Spreadsheet Toolkit', install: { type: 'local-directory', path: xlsxDir } },
      { id: 'anthropic:team/agent', name: 'Team Agent', install: { type: 'local-directory', path: agentDir } },
    ])

    let result = runCli(['skills', 'add', 'acme/alpha'], repo, indexedCliEnv)
    assertOk(t, result, 'installed skill: acme/alpha')

    result = runCli(['skills', 'add', 'anthropic:team/agent'], repo, indexedCliEnv)
    assertOk(t, result, 'installed skill: anthropic:team/agent')

    result = runCli(['skills', 'add', 'anthropic:xlsx'], repo, indexedCliEnv)
    assertOk(t, result, 'installed skill: anthropic:xlsx')

    assert.equal(existsSync(join(repo, '.agents', 'skills', 'acme-alpha', 'SKILL.md')), true)
    assert.equal(existsSync(join(repo, '.agents', 'skills', 'anthropic-team-agent', 'SKILL.md')), true)
    assert.equal(existsSync(join(repo, '.agents', 'skills', 'anthropic-xlsx', 'SKILL.md')), true)

    const installed = readInstalledSkills(repo)
    assert.deepStrictEqual(installed.map((entry) => entry.id), ['acme/alpha', 'anthropic:team/agent', 'anthropic:xlsx'])
    assert.deepStrictEqual(installed.map((entry) => entry.name), ['acme-alpha', 'anthropic-team-agent', 'anthropic-xlsx'])

    result = runCli(['skills', 'add', 'missing:skill'], repo, indexedCliEnv)
    assert.equal(result.code, 1)
    assert.ok(result.output.includes('is not listed in the search index'))

    const pending = readPendingSkills(repo)
    assert.deepStrictEqual(pending, [])

    result = runCli(['_skill-used', 'anthropic:xlsx'], repo, cliEnv)
    assert.equal(result.code, 0)

    const usedPending = readPendingSkills(repo)
    assert.deepStrictEqual(usedPending, ['anthropic:xlsx'])

    runCli(['disable'], repo, cliEnv)
  })

  test('skills inspect exposes registry source and identity in json output', (t) => {
    const repo = makeRepo(tempBase, 'inspect')
    writeSearchIndex(indexFile, [
      {
        id: 'anthropic:team/agent',
        name: 'Team Agent',
        owner: 'team',
        slug: 'agent',
        runtime: ['python'],
        tags: ['automation'],
        install: { type: 'github-directory', repo: 'anthropics/skills', ref: 'main', path: 'skills/team/agent' },
        updatedAt: '2026-03-17T12:00:00.000Z',
      },
    ])

    const result = runCli(['--json', 'skills', 'inspect', 'anthropic:team/agent'], repo, indexedCliEnv)
    assertOk(t, result, '"source":"anthropic"')
    const payload = JSON.parse(result.output.trim())
    assert.equal(payload.id, 'anthropic:team/agent')
    assert.equal(payload.name, 'Team Agent')
    assert.equal(payload.source, 'anthropic')
    assert.deepStrictEqual(payload.runtime, ['python'])
    assert.deepStrictEqual(payload.tags, ['automation'])
    assert.equal(payload.owner, 'team')
    assert.equal(payload.slug, 'agent')
    assert.equal(payload.install.type, 'github-directory')
  })

  test('invalid index rows are ignored by normalization', (t) => {
    const repo = makeRepo(tempBase, 'normalize')
    runCli(['enable', '--agent', 'opencode'], repo, cliEnv)
    writeSearchIndex(indexFile, [
      { id: 'acme/valid', name: 'Valid Skill' },
      { id: 'bad', name: 'Bad Skill' },
      { id: ':broken', name: 'Broken Skill' },
      { name: 'Missing Id', runtime: ['node'] },
      { id: 'anthropic:team/agent', name: 'Agent' },
    ])

    const result = runCli(['--json', 'skills', 'search'], repo, indexedCliEnv)
    assertOk(t, result, '"count":2')
    const payload = JSON.parse(result.output.trim())
    assert.deepStrictEqual(payload.results.map((entry) => entry.id), ['anthropic:team/agent', 'acme/valid'])

    const addMissingResult = runCli(['skills', 'add', 'bad'], repo, indexedCliEnv)
    assert.equal(addMissingResult.code, 1)
    assert.ok(addMissingResult.output.includes('invalid skill id format'))

    runCli(['disable'], repo, cliEnv)
  })
})
