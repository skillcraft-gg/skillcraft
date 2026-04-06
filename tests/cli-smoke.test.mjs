import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, chmodSync } from 'node:fs'
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

function runGit(cwd, args, env = process.env) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    env,
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

function setCredentialCacheTimestamp(cachePath, timestampMs) {
  if (!existsSync(cachePath)) {
    return
  }

  const rawText = readFileSync(cachePath, 'utf8')
  let payload = {}
  try {
    payload = JSON.parse(rawText)
  } catch {
    payload = {}
  }

  const nextPayload =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? {
          ...payload,
          cachedAt: timestampMs,
        }
      : {
          cachedAt: timestampMs,
          version: 1,
          entries: Array.isArray(payload) ? payload : [],
        }

  writeFileSync(cachePath, JSON.stringify(nextPayload))
}

function getCredentialCacheTimestamp(cachePath) {
  if (!existsSync(cachePath)) {
    return null
  }

  let payload = null
  try {
    payload = JSON.parse(readFileSync(cachePath, 'utf8'))
  } catch {
    return null
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }

  const cachedAt = Number.parseInt(payload.cachedAt, 10)
  return Number.isFinite(cachedAt) ? cachedAt : null
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

function addTrackedProof(repoDir, fileName, skills, env) {
  const pendingPath = join(repoDir, '.git', 'skillcraft', 'pending.json')
  writeFileSync(pendingPath, JSON.stringify({ skills: [...skills] }))
  writeFileSync(join(repoDir, fileName), `proof evidence for ${fileName}\n`)
  const hookDisabledEnv = { ...env, SKILLCRAFT_HOOK_DISABLED: '1' }
  runGit(repoDir, ['add', fileName], hookDisabledEnv)
  runGit(repoDir, ['commit', '-m', `add ${fileName}`], hookDisabledEnv)
  runCli(['_hook', 'post-commit', repoDir], repoDir, env)
}

function writeExecutable(filePath, lines) {
  writeFileSync(filePath, lines.join('\n'))
  chmodSync(filePath, 0o755)
}

function makeDoctorBin(binDir, options = {}) {
  mkdirSync(binDir, { recursive: true })

  writeExecutable(join(binDir, 'which'), [
    '#!/bin/sh',
    'dir="${0%/*}"',
    'if [ -x "$dir/$1" ]; then',
    '  echo "$dir/$1"',
    '  exit 0',
    'fi',
    'exit 1',
  ])

  writeExecutable(join(binDir, 'node'), [
    '#!/bin/sh',
    `exec "${process.execPath}" "$@"`,
  ])

  for (const tool of options.tools || []) {
    if (tool === 'gh') {
      const command = options.ghLogin ? `echo "${options.ghLogin}"` : 'exit 1'
      writeExecutable(join(binDir, 'gh'), [
        '#!/bin/sh',
        'if [ "$1" = "api" ] && [ "$2" = "user" ]; then',
        `  ${command}`,
        '  exit 0',
        'fi',
        'exit 0',
      ])
      continue
    }

    writeExecutable(join(binDir, tool), [
      '#!/bin/sh',
      'exit 0',
    ])
  }

  return binDir
}

function makeFakeGhScript(binDir) {
  const fake = join(binDir, 'gh')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(
    fake,
    [
      '#!/usr/bin/env sh',
      'if [ "$1" = "issue" ] && [ "$2" = "create" ]; then',
      '  echo "https://github.com/skillcraft-gg/credential-ledger/issues/4711"',
      '  exit 0',
      'fi',
      'if [ "$1" = "issue" ] && [ "$2" = "view" ]; then',
      '  if [ -n "$SKILLCRAFT_FAKE_GH_ISSUE_VIEW_JSON" ]; then',
      '    echo "$SKILLCRAFT_FAKE_GH_ISSUE_VIEW_JSON"',
      '  else',
      "    echo '{\"state\":\"open\",\"labels\":[{\"name\":\"skillcraft-claim\"},{\"name\":\"skillcraft-processing\"}],\"url\":\"https://github.com/skillcraft-gg/credential-ledger/issues/4711\"}'",
      '  fi',
      '  exit 0',
      'fi',
      'if [ "$1" = "issue" ] && [ "$2" = "list" ]; then',
      '  printf "%s" "${SKILLCRAFT_FAKE_GH_ISSUE_LIST_JSON:-[]}"',
      '  exit 0',
      'fi',
      'if [ "$1" = "run" ] && [ "$2" = "list" ]; then',
      "  echo '[{\"name\":\"Process claim issue #4711\",\"status\":\"completed\",\"conclusion\":\"success\",\"url\":\"https://github.com/skillcraft-gg/credential-ledger/actions/runs/1001\",\"createdAt\":\"2026-04-01T00:00:00Z\",\"workflowName\":\"Process credential claims\"},{\"name\":\"Process claim issue #4711\",\"status\":\"completed\",\"conclusion\":\"failure\",\"url\":\"https://github.com/skillcraft-gg/credential-ledger/actions/runs/1000\",\"createdAt\":\"2026-03-31T23:00:00Z\",\"workflowName\":\"Process credential claims\"}]'",
      '  exit 0',
      'fi',
      'if [ "$1" = "api" ] && [ "$2" = "user" ]; then',
      '  echo "test-user"',
      '  exit 0',
      'fi',
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
      "  echo '{\"user\": {\"login\": \"test-user\"}}'",
      '  exit 0',
      'fi',
      'echo "unsupported mock gh command: $@" >&2',
      'exit 1',
    ].join('\n'),
  )
  chmodSync(fake, 0o755)
  return fake
}

describe('Skillcraft CLI surface smoke tests', () => {
  const tempBase = makeTempDir('smoke')
  const home = join(tempBase, 'home')
  const plain = join(tempBase, 'plain')
  const indexFile = join(tempBase, 'search-index.json')
  const credentialIndexFile = join(tempBase, 'credential-index.json')
  mkdirSync(home)
  mkdirSync(plain)
  const cliEnv = { ...process.env, HOME: home }
  const indexedCliEnv = { ...cliEnv, SKILLCRAFT_SEARCH_INDEX_PATH: indexFile }
  const credentialCliEnv = { ...cliEnv, SKILLCRAFT_CREDENTIAL_INDEX_PATH: credentialIndexFile }

  test('help command', (t) => {
    const result = runCli(['--help'], plain, cliEnv)
    assertOk(t, result, 'Usage: skillcraft')
  })

  test('status command in non-git directory', (t) => {
    const result = runCli(['status'], plain, cliEnv)
    assertOk(t, result, 'git: not a repository')
  })

  test('doctor checks documented install prerequisites', (t) => {
    const doctorBin = makeDoctorBin(join(tempBase, 'doctor-bin-ready'), {
      tools: ['npm', 'git', 'gh', 'opencode'],
      ghLogin: 'test-user',
    })
    const doctorEnv = { ...cliEnv, PATH: doctorBin }

    const result = runCli(['doctor'], plain, doctorEnv)
    assert.equal(result.code, 0, `${t.name} exited with ${result.code}\n${result.output}`)
    assert.ok(result.output.includes('node: ok'))
    assert.ok(result.output.includes('npm: ok'))
    assert.ok(result.output.includes('git: ok'))
    assert.ok(result.output.includes('gh: ok'))
    assert.ok(result.output.includes('gh auth: ok'))
    assert.ok(result.output.includes('github user: test-user'))
    assert.ok(result.output.includes('opencode: ok'))
    assert.ok(!result.output.includes('skillcraft config:'))
    assert.ok(!result.output.includes('plugin hook:'))
  })

  test('doctor reports missing auth and tools without repo checks', (t) => {
    const doctorBin = makeDoctorBin(join(tempBase, 'doctor-bin-missing'), {
      tools: ['npm', 'git', 'gh'],
    })
    const doctorEnv = { ...cliEnv, PATH: doctorBin }

    const result = runCli(['doctor'], plain, doctorEnv)
    assert.equal(result.code, 0, `${t.name} exited with ${result.code}\n${result.output}`)
    assert.ok(result.output.includes('node: ok'))
    assert.ok(result.output.includes('npm: ok'))
    assert.ok(result.output.includes('git: ok'))
    assert.ok(result.output.includes('gh: ok'))
    assert.ok(result.output.includes('gh auth: missing'))
    assert.ok(result.output.includes('github user: unknown'))
    assert.ok(result.output.includes('opencode: missing'))
    assert.ok(!result.output.includes('skillcraft config:'))
    assert.ok(!result.output.includes('plugin hook:'))
  })

  test('enable/status/disable flow', (t) => {
    const repo = makeRepo(tempBase, 'flow')
    let result = runCli(['status'], repo, cliEnv)
    assertOk(t, result, 'skillcraft: disabled')

    result = runCli(['enable'], repo, cliEnv)
    assertOk(t, result, 'enabled skillcraft')

    assert.ok(existsSync(join(home, '.skillcraft', 'config.json')))
    assert.ok(existsSync(join(repo, '.opencode', 'plugins', 'skillcraft.mjs')))

    const aiContextFile = join(repo, '.git', 'skillcraft', 'ai-model-context.json')
    assert.ok(existsSync(aiContextFile))
    const aiContext = JSON.parse(readFileSync(aiContextFile, 'utf8'))
    assert.equal(aiContext?.agent?.provider, 'opencode')

    result = runCli(['status'], repo, cliEnv)
    assertOk(t, result, 'skillcraft: enabled')

    result = runCli(['disable'], repo, cliEnv)
    assertOk(t, result, 'disabled skillcraft')

    result = runCli(['status'], repo, cliEnv)
    assertOk(t, result, 'skillcraft: disabled')

    assert.ok(!existsSync(join(repo, '.opencode', 'plugins', 'skillcraft.mjs')))
    assert.ok(!existsSync(aiContextFile))
  })

  test('post-commit hook resolves repo root from subdirectory', (t) => {
    const repo = makeRepo(tempBase, 'hook-root')
    try {
      const result = runCli(['enable'], repo, cliEnv)
      assertOk(t, result, 'enabled skillcraft')

      const postCommitHook = readFileSync(join(repo, '.git', 'hooks', 'post-commit'), 'utf8')
      assert.ok(postCommitHook.includes('SKILLCRAFT_HOOK_DIR="$(git -C "$SKILLCRAFT_HOOK_DIR" rev-parse --show-toplevel'))

      const nested = join(repo, 'nested')
      mkdirSync(nested)
      writeFileSync(join(nested, 'nested.txt'), 'nested file\n')
      runGit(nested, ['add', 'nested.txt'])
      runGit(nested, ['commit', '-m', 'commit from nested directory'])

      const message = runGit(repo, ['log', '-n', '1', '--pretty=%B'])
      assert.ok(message.includes('Skillcraft-Ref:'), 'hook should append Skillcraft-Ref when run from subdirectory')
    } finally {
      runCli(['disable'], repo, cliEnv)
    }
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

  test('loadout command and progress baseline', (t) => {
    const repo = makeRepo(tempBase, 'loadout')
    let result = runCli(['enable'], repo, cliEnv)
    assertOk(t, result, 'enabled skillcraft')

    result = runCli(['loadout', 'use', 'acme/dev'], repo, cliEnv)
    assertOk(t, result, 'activated loadout: acme/dev')

    result = runCli(['progress'], repo, cliEnv)
    assertOk(t, result, 'no credentials tracked')

    result = runCli(['loadout', 'clear'], repo, cliEnv)
    assertOk(t, result, 'cleared active loadouts')

    result = runCli(['_hook', 'post-commit', repo], repo, cliEnv)
    assert.equal(result.code, 0)

    runCli(['disable'], repo, cliEnv)
  })

  test('claim fails when source commits are not pushed', (t) => {
    const repo = makeRepo(tempBase, 'claim-unpushed')

    writeFileSync(
      credentialIndexFile,
      JSON.stringify(
        [
          {
            id: 'skillcraft-gg/hello-world',
            requirements: {
              min_commits: 1,
            },
          },
        ],
        null,
        2,
      ),
    )

    const result = runCli(['enable'], repo, cliEnv)
    assertOk(t, result, 'enabled skillcraft')

    addTrackedProof(repo, 'claim-proof.txt', ['acme/alpha'], credentialCliEnv)

    const claimResult = runCli(['claim', 'skillcraft-gg/hello-world'], repo, credentialCliEnv)
    assert.equal(claimResult.code, 1)
    assert.equal(claimResult.output.includes('⚠️ Warning: some claim commits may not be pushed yet. Please push recent commits before re-submitting the claim.'), true)
    assert.equal(claimResult.output.includes('opened claim:'), false)

    runCli(['disable'], repo, cliEnv)
  })

  test('claim succeeds when source commits are pushed', (t) => {
    const repo = makeRepo(tempBase, 'claim-pushed')
    const remote = join(tempBase, 'claim-pushed-origin.git')
    const fakeGhDir = join(tempBase, 'fake-gh-claim-success')

    writeFileSync(
      credentialIndexFile,
      JSON.stringify(
        [
          {
            id: 'skillcraft-gg/hello-world',
            requirements: {
              min_commits: 1,
            },
          },
        ],
        null,
        2,
      ),
    )

    const fakeGh = makeFakeGhScript(fakeGhDir)
    const claimEnv = {
      ...credentialCliEnv,
      PATH: `${dirname(fakeGh)}:${credentialCliEnv.PATH || process.env.PATH || ''}`,
      USER: 'local-mac-user',
    }

    let result = runCli(['enable'], repo, cliEnv)
    assertOk(t, result, 'enabled skillcraft')

    runGit(repo, ['remote', 'add', 'origin', `file://${remote}`])
    mkdirSync(remote, { recursive: true })
    runGit(remote, ['init', '--bare'])

    addTrackedProof(repo, 'claim-proof.txt', ['acme/alpha'], claimEnv)
    runGit(repo, ['push', 'origin', 'HEAD'])

    const claimResult = runCli(['claim', 'skillcraft-gg/hello-world'], repo, claimEnv)
    assert.equal(claimResult.code, 0)
    assert.equal(claimResult.output.includes('opened claim: #4711'), true)
    assert.equal(claimResult.output.includes('github: test-user'), true)
    assert.equal(claimResult.output.includes('github: local-mac-user'), false)
    assert.equal(
      claimResult.output.includes('⚠️ Warning: some claim commits may not be pushed yet. Please push recent commits before re-submitting the claim.'),
      false,
    )

    runCli(['disable'], repo, cliEnv)
  })

  test('claim blocks already issued credential for current user', (t) => {
    const repo = makeRepo(tempBase, 'claim-duplicate')
    const remote = join(tempBase, 'claim-duplicate-origin.git')
    const fakeGhDir = join(tempBase, 'fake-gh-claim-duplicate')

    writeFileSync(
      credentialIndexFile,
      JSON.stringify(
        [
          {
            id: 'skillcraft-gg/hello-world',
            requirements: {
              min_commits: 1,
            },
          },
        ],
        null,
        2,
      ),
    )

    const issuedIssue = JSON.stringify([
      {
        number: 4700,
        title: 'claim: skillcraft-gg/hello-world',
        state: 'closed',
        body: 'claim_version: 1\nclaimant:\n  github: test-user\ncredential:\n  id: skillcraft-gg/hello-world\nsources: []',
        url: 'https://github.com/skillcraft-gg/credential-ledger/issues/4700',
        labels: [{ name: 'skillcraft-claim' }, { name: 'skillcraft-issued' }],
      },
    ])

    const fakeGh = makeFakeGhScript(fakeGhDir)
    const claimEnv = {
      ...credentialCliEnv,
      PATH: `${dirname(fakeGh)}:${credentialCliEnv.PATH || process.env.PATH || ''}`,
      SKILLCRAFT_FAKE_GH_ISSUE_LIST_JSON: issuedIssue,
    }

    let result = runCli(['enable'], repo, cliEnv)
    assertOk(t, result, 'enabled skillcraft')

    runGit(repo, ['remote', 'add', 'origin', `file://${remote}`])
    mkdirSync(remote, { recursive: true })
    runGit(remote, ['init', '--bare'])

    addTrackedProof(repo, 'claim-proof.txt', ['acme/alpha'], claimEnv)
    runGit(repo, ['push', 'origin', 'HEAD'])

    const claimResult = runCli(['claim', 'skillcraft-gg/hello-world'], repo, claimEnv)
    assert.equal(claimResult.code, 1)
    assert.equal(claimResult.output.includes('You already have an issued claim for skillcraft-gg/hello-world'), true)
    assert.equal(claimResult.output.includes('Existing issue: #4700'), true)
    assert.equal(claimResult.output.includes('opened claim:'), false)

    runCli(['disable'], repo, cliEnv)
  })

  test('claim list shows only current user claims', (t) => {
    const fakeGhDir = join(tempBase, 'fake-gh-claim-list')
    const fakeGh = makeFakeGhScript(fakeGhDir)
    const listEnv = {
      ...cliEnv,
      PATH: `${dirname(fakeGh)}:${cliEnv.PATH || process.env.PATH || ''}`,
      SKILLCRAFT_FAKE_GH_ISSUE_LIST_JSON: JSON.stringify([
        {
          number: 4711,
          title: 'claim: skillcraft-gg/hello-world',
          state: 'open',
          body: 'claim_version: 1\nclaimant:\n  github: test-user\ncredential:\n  id: skillcraft-gg/hello-world\nsources: []',
          labels: [{ name: 'skillcraft-claim' }],
        },
        {
          number: 4712,
          title: 'claim: skillcraft-gg/other',
          state: 'closed',
          body: 'claim_version: 1\nclaimant:\n  github: other-user\ncredential:\n  id: skillcraft-gg/other\nsources: []',
          labels: [{ name: 'skillcraft-claim' }],
        },
      ]),
    }

    const result = runCli(['claim', 'list'], plain, listEnv)
    assert.equal(result.code, 0)
    assertOk(t, result, '(pending)')
    assert.ok(result.output.includes('#4711'))
    assert.ok(!result.output.includes('#4712'))
    assert.ok(!result.output.includes('claim: skillcraft-gg/other'))
  })

  test('claim status checks processing action runs', (t) => {
    const fakeGhDir = join(tempBase, 'fake-gh-claim-status')
    const fakeGh = makeFakeGhScript(fakeGhDir)
    const statusEnv = {
      ...cliEnv,
      PATH: `${dirname(fakeGh)}:${cliEnv.PATH || process.env.PATH || ''}`,
      SKILLCRAFT_FAKE_GH_ISSUE_LIST_JSON: JSON.stringify([
        {
          number: 4712,
          title: 'claim: skillcraft-gg/other',
          state: 'open',
          body: 'claim_version: 1\nclaimant:\n  github: other-user\ncredential:\n  id: skillcraft-gg/hello-world\nsources: []',
          labels: [{ name: 'skillcraft-claim' }],
        },
        {
          number: 4711,
          title: 'claim: skillcraft-gg/hello-world',
          state: 'closed',
          body: 'claim_version: 1\nclaimant:\n  github: test-user\ncredential:\n  id: skillcraft-gg/hello-world\nsources: []',
          labels: [{ name: 'skillcraft-claim' }],
        },
      ]),
    }

    const result = runCli(['claim', 'status', 'skillcraft-gg/hello-world'], plain, statusEnv)
    assertOk(t, result, 'issue #4711')
    assertOk(t, result, 'state: processing')
    assertOk(t, result, 'labels: skillcraft-claim, skillcraft-processing')
    assertOk(t, result, 'processing actions: completed (success)')
    assertOk(t, result, 'latest run: https://github.com/skillcraft-gg/credential-ledger/actions/runs/1001')
    assertOk(t, result, 'previous attempts: 1')
  })

  test('claim status uses claim labels over issue state', (t) => {
    const fakeGhDir = join(tempBase, 'fake-gh-claim-status-label')
    const fakeGh = makeFakeGhScript(fakeGhDir)
    const statusEnv = {
      ...cliEnv,
      PATH: `${dirname(fakeGh)}:${cliEnv.PATH || process.env.PATH || ''}`,
      SKILLCRAFT_FAKE_GH_ISSUE_LIST_JSON: JSON.stringify([
        {
          number: 4711,
          title: 'claim: skillcraft-gg/hello-world',
          state: 'closed',
          body: 'claim_version: 1\nclaimant:\n  github: test-user\ncredential:\n  id: skillcraft-gg/hello-world\nsources: []',
          labels: [{ name: 'skillcraft-claim' }],
        },
      ]),
      SKILLCRAFT_FAKE_GH_ISSUE_VIEW_JSON:
        '{"state":"closed","labels":[{"name":"skillcraft-claim"},{"name":"skillcraft-issued"}],"url":"https://github.com/skillcraft-gg/credential-ledger/issues/4711"}',
    }

    const result = runCli(['claim', 'status', 'skillcraft-gg/hello-world'], plain, statusEnv)
    assertOk(t, result, 'issue #4711')
    assertOk(t, result, 'state: issued')
    assertOk(t, result, 'labels: skillcraft-claim, skillcraft-issued')
  })

  test('claim status reports missing claim clearly', (t) => {
    const fakeGhDir = join(tempBase, 'fake-gh-claim-status-missing')
    const fakeGh = makeFakeGhScript(fakeGhDir)
    const statusMissingEnv = {
      ...cliEnv,
      PATH: `${dirname(fakeGh)}:${cliEnv.PATH || process.env.PATH || ''}`,
      SKILLCRAFT_FAKE_GH_ISSUE_LIST_JSON: JSON.stringify([
        {
          number: 4711,
          title: 'claim: skillcraft-gg/other',
          state: 'open',
          body: 'claim_version: 1\nclaimant:\n  github: other-user\ncredential:\n  id: skillcraft-gg/hello-world\nsources: []',
          labels: [{ name: 'skillcraft-claim' }],
        },
      ]),
    }

    const result = runCli(['claim', 'status', 'skillcraft-gg/missing'], plain, statusMissingEnv)
    assert.equal(result.code, 1)
    assert.equal(result.output.includes('No claim found for credential skillcraft-gg/missing for user test-user. Run "skillcraft claim" to see your claims.'), true)
    assert.equal(result.output.includes('Command failed: gh issue view'), false)
  })

  test('progress help documents --refresh', (t) => {
    const result = runCli(['progress', '--help'], plain, cliEnv)
    assertOk(t, result, '--refresh')
  })

  test('progress supports --refresh', (t) => {
    const repo = makeRepo(tempBase, 'progress-refresh')

    writeFileSync(
      credentialIndexFile,
      JSON.stringify(
        [
          {
            id: 'skillcraft-gg/hello-world',
            name: 'Hello World',
            requirements: {
              min_commits: 1,
            },
          },
        ],
        null,
        2,
      ),
    )

    let result = runCli(['enable'], repo, cliEnv)
    assertOk(t, result, 'enabled skillcraft')

    try {
      result = runCli(['progress', 'track', 'skillcraft-gg/hello-world'], repo, credentialCliEnv)
      assertOk(t, result, 'tracking credential: skillcraft-gg/hello-world')

      result = runCli(['--json', 'progress', '--refresh'], repo, credentialCliEnv)
      assert.equal(result.code, 0)
      const payload = JSON.parse(result.output.trim())
      assert.equal(payload.trackedCredentials, 1)
    } finally {
      runCli(['progress', 'untrack', 'skillcraft-gg/hello-world'], repo, credentialCliEnv)
      runCli(['disable'], repo, cliEnv)
    }
  })

  test('progress cache uses file timestamps and forced refresh', async (t) => {
    const repo = makeRepo(tempBase, 'progress-cache-refresh')
    const credentialCachePath = join(home, '.skillcraft', 'cache', 'credentials', 'index.json')

    const remoteUrl = 'https://skillcraft.gg/credential-ledger/credentials/index.json'
    const remoteCredentialEnv = {
      ...cliEnv,
      SKILLCRAFT_CREDENTIAL_INDEX_URL: remoteUrl,
    }
    delete remoteCredentialEnv.SKILLCRAFT_CREDENTIAL_INDEX_PATH

    try {
      runCli(['enable'], repo, cliEnv)

      let result = runCli(['progress', 'track', 'skillcraft-gg/hello-world'], repo, remoteCredentialEnv)
      assertOk(t, result, 'tracking credential: skillcraft-gg/hello-world')

      result = runCli(['--json', 'progress'], repo, remoteCredentialEnv)
      assert.equal(result.code, 0)
      let payload = JSON.parse(result.output.trim())
      assert.equal(payload.credentials[0].name, 'Hello World')

      const firstCachedAt = getCredentialCacheTimestamp(credentialCachePath)
      assert.ok(firstCachedAt)

      setCredentialCacheTimestamp(credentialCachePath, firstCachedAt - 7 * 60 * 60 * 1000)

      result = runCli(['--json', 'progress'], repo, remoteCredentialEnv)
      assert.equal(result.code, 0)
      payload = JSON.parse(result.output.trim())
      assert.equal(payload.credentials[0].name, 'Hello World')
      const secondCachedAt = getCredentialCacheTimestamp(credentialCachePath)
      assert.ok(secondCachedAt)
      assert.ok(secondCachedAt > firstCachedAt)

      result = runCli(['--json', 'progress'], repo, remoteCredentialEnv)
      assert.equal(result.code, 0)
      payload = JSON.parse(result.output.trim())
      assert.equal(payload.credentials[0].name, 'Hello World')
      const thirdCachedAt = getCredentialCacheTimestamp(credentialCachePath)
      assert.ok(thirdCachedAt)
      assert.equal(thirdCachedAt, secondCachedAt)

      result = runCli(['--json', 'progress', '--refresh'], repo, remoteCredentialEnv)
      assert.equal(result.code, 0)
      payload = JSON.parse(result.output.trim())
      assert.equal(payload.credentials[0].name, 'Hello World')
      const fourthCachedAt = getCredentialCacheTimestamp(credentialCachePath)
      assert.ok(fourthCachedAt)
      assert.ok(fourthCachedAt > thirdCachedAt)
    } finally {
      runCli(['progress', 'untrack', 'skillcraft-gg/hello-world'], repo, remoteCredentialEnv)
      runCli(['disable'], repo, cliEnv)
    }
  })

  test('progress track and untrack', (t) => {
    const repo = makeRepo(tempBase, 'progress-track')

    writeFileSync(
      credentialIndexFile,
      JSON.stringify(
        [
          {
            id: 'skillcraft-gg/hello-world',
            name: 'Hello World',
            requirements: {
              min_commits: 1,
            },
          },
        ],
        null,
        2,
      ),
    )

    let result = runCli(['progress', 'track', 'skillcraft-gg/hello-world'], repo, credentialCliEnv)
    assertOk(t, result, 'tracking credential: skillcraft-gg/hello-world')

    result = runCli(['progress', 'track', 'missing/credential'], repo, credentialCliEnv)
    assert.equal(result.code, 1)
    assert.ok(result.output.includes('credential not found in credential index: missing/credential'))

    result = runCli(['progress', 'track', 'skillcraft-gg/hello-world'], repo, credentialCliEnv)
    assertOk(t, result, 'credential already tracked: skillcraft-gg/hello-world')

    result = runCli(['progress', 'untrack', 'skillcraft-gg/hello-world'], repo, credentialCliEnv)
    assertOk(t, result, 'untracked credential: skillcraft-gg/hello-world')

    result = runCli(['progress', 'untrack', 'skillcraft-gg/hello-world'], repo, credentialCliEnv)
    assertOk(t, result, 'credential not tracked: skillcraft-gg/hello-world')
  })

  test('progress evaluates tracked credentials', (t) => {
    const repoA = makeRepo(tempBase, 'progress-agg-a')
    const repoB = makeRepo(tempBase, 'progress-agg-b')

    writeFileSync(
      credentialIndexFile,
      JSON.stringify(
        [
          {
            id: 'skillcraft-gg/hello-world',
            requirements: {
              min_commits: 1,
            },
          },
          {
            id: 'skillcraft-gg/alpha-beta',
            requirements: {
              min_repositories: 1,
              and: [
                {
                  skill: 'acme/alpha',
                },
                {
                  skill: 'acme/beta',
                },
              ],
            },
          },
          {
            id: 'skillcraft-gg/blocked',
            requirements: {
              min_commits: 3,
            },
          },
        ],
        null,
        2,
      ),
    )

    let result = runCli(['enable'], repoA, cliEnv)
    assertOk(t, result, 'enabled skillcraft')
    result = runCli(['enable'], repoB, cliEnv)
    assertOk(t, result, 'enabled skillcraft')

    result = runCli(['progress', 'track', 'skillcraft-gg/hello-world'], repoA, credentialCliEnv)
    assertOk(t, result, 'tracking credential: skillcraft-gg/hello-world')
    result = runCli(['progress', 'track', 'skillcraft-gg/alpha-beta'], repoA, credentialCliEnv)
    assertOk(t, result, 'tracking credential: skillcraft-gg/alpha-beta')
    result = runCli(['progress', 'track', 'skillcraft-gg/blocked'], repoA, credentialCliEnv)
    assertOk(t, result, 'tracking credential: skillcraft-gg/blocked')

    addTrackedProof(repoA, 'proof-a.txt', ['acme/alpha'], credentialCliEnv)
    addTrackedProof(repoB, 'proof-b.txt', ['acme/beta'], credentialCliEnv)

    try {
      result = runCli(['--json', 'progress'], tempBase, credentialCliEnv)
      assert.equal(result.code, 0)
      const payload = JSON.parse(result.output.trim())
      assert.equal(payload.trackedCredentials, 3)
      assert.equal(payload.trackedRepositories, 2)
      assert.equal(payload.evidence.proofFiles, 2)
      assert.equal(payload.evidence.provenCommits, 2)

      const helloWorld = payload.credentials.find((entry) => entry.credentialId === 'skillcraft-gg/hello-world')
      assert.ok(helloWorld)
      assert.equal(helloWorld.passed, true)

      const alphaBeta = payload.credentials.find((entry) => entry.credentialId === 'skillcraft-gg/alpha-beta')
      assert.ok(alphaBeta)
      assert.equal(alphaBeta.passed, true)

      const blocked = payload.credentials.find((entry) => entry.credentialId === 'skillcraft-gg/blocked')
      assert.ok(blocked)
      assert.equal(blocked.passed, false)
      assert.ok(blocked.reasons.includes('minimum required commits not met: have 2, need 3'))
    } finally {
      runCli(['progress', 'untrack', 'skillcraft-gg/hello-world'], repoA, credentialCliEnv)
      runCli(['progress', 'untrack', 'skillcraft-gg/alpha-beta'], repoA, credentialCliEnv)
      runCli(['progress', 'untrack', 'skillcraft-gg/blocked'], repoA, credentialCliEnv)

      runCli(['disable'], repoA, cliEnv)
      runCli(['disable'], repoB, cliEnv)
    }
  })

  test('verify baseline path', (t) => {
    const repo = makeRepo(tempBase, 'verify')
    runCli(['enable'], repo, cliEnv)

    const result = runCli(['verify'], repo, cliEnv)
    assertOk(t, result, 'verify passed: 0 commit proofs resolved')
    assert.ok(result.output.includes('⚠️ Warning: no git remotes configured for repository'))

    runCli(['disable'], repo, cliEnv)
  })

  test('proofs are stored on proof branch', (t) => {
    const repo = makeRepo(tempBase, 'proof-branch')
    runCli(['enable'], repo, cliEnv)

    const pending = join(repo, '.git', 'skillcraft', 'pending.json')
    writeFileSync(pending, JSON.stringify({ skills: ['acme/alpha'] }))
    writeFileSync(
      join(repo, '.git', 'skillcraft', 'ai-model-context.json'),
      JSON.stringify({
        agent: { provider: 'opencode' },
        model: { provider: 'openai', name: 'gpt-4o' },
      }),
    )
    writeFileSync(join(repo, 'proof.txt'), 'change\n')
    runGit(repo, ['add', 'proof.txt'])
    runGit(repo, ['commit', '-m', 'add proof file'], { ...cliEnv, SKILLCRAFT_HOOK_DISABLED: '1' })

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
    assert.equal(proof.agent?.provider, 'opencode')
    assert.equal(proof.model?.provider, 'openai')
    assert.equal(proof.model?.name, 'gpt-4o')

    const oldPath = join(repo, '.git', 'refs', 'skillcraft', 'checkpoints', 'v1')
    assert.equal(existsSync(oldPath), false)

    const result = runCli(['verify'], repo, cliEnv)
    assertOk(t, result, `verify passed: 1 commit proofs resolved`)
    assert.ok(result.output.includes('⚠️ Warning: no git remotes configured for repository'))

    runCli(['disable'], repo, cliEnv)
  })

  test('proofs are created even when no skills are queued', (t) => {
    const repo = makeRepo(tempBase, 'proof-empty-branch')
    runCli(['enable'], repo, cliEnv)

    writeFileSync(join(repo, 'proof-empty.txt'), 'change\n')
    runGit(repo, ['add', 'proof-empty.txt'])
    runGit(repo, ['commit', '-m', 'add empty proof commit'])

    const hookResult = runCli(['_hook', 'post-commit', repo], repo, cliEnv)
    assertOk(t, hookResult, '')

    const headMessage = runGit(repo, ['log', '-n', '1', '--pretty=%B'])
    const match = headMessage.match(/Skillcraft-Ref:\s*(\S+)/)
    assert.ok(match)
    const proofId = match?.[1]
    assert.equal(typeof proofId, 'string')

    const proofFiles = runGit(repo, ['ls-tree', '-r', '--name-only', 'skillcraft/proofs/v1', '--', 'proofs'])
    assert.ok(proofFiles.includes(`proofs/${proofId}.json`))

    const proofJson = runGit(repo, [`show`, `skillcraft/proofs/v1:proofs/${proofId}.json`])
    const proof = JSON.parse(proofJson)
    assert.ok(Array.isArray(proof.skills))
    assert.equal(proof.skills.length, 0)

    const verifyResult = runCli(['verify'], repo, cliEnv)
    assertOk(t, verifyResult, 'verify passed: 1 commit proofs resolved')
    assert.ok(verifyResult.output.includes('⚠️ Warning: no git remotes configured for repository'))

    runCli(['disable'], repo, cliEnv)
  })

  test('progress handles multiple tracked repositories with no credentials tracked', (t) => {
    const repoA = makeRepo(tempBase, 'progress-agg-c')
    const repoB = makeRepo(tempBase, 'progress-agg-d')

    let result = runCli(['enable'], repoA, cliEnv)
    assertOk(t, result, 'enabled skillcraft')
    result = runCli(['enable'], repoB, cliEnv)
    assertOk(t, result, 'enabled skillcraft')

    addTrackedProof(repoA, 'proof-a.txt', ['acme/alpha'], cliEnv)
    addTrackedProof(repoB, 'proof-b.txt', ['acme/beta'], cliEnv)

    result = runCli(['--json', 'progress'], tempBase, cliEnv)
    assert.equal(result.code, 0)
    const payload = JSON.parse(result.output.trim())
    assert.equal(payload.trackedCredentials, 0)
    assert.equal(payload.trackedRepositories, 2)
    assert.equal(payload.evidence.proofFiles, 0)
    assert.deepStrictEqual(payload.credentials, [])

    runCli(['disable'], repoA, cliEnv)
    runCli(['disable'], repoB, cliEnv)
  })

  test('verify reads proofs from remote branch', (t) => {
    const sourceRepo = makeRepo(tempBase, 'verify-remote-source')
    runCli(['enable'], sourceRepo, cliEnv)

    const pending = join(sourceRepo, '.git', 'skillcraft', 'pending.json')
    writeFileSync(pending, JSON.stringify({ skills: ['acme/alpha'] }))
    writeFileSync(join(sourceRepo, 'proof.txt'), 'change\n')
    runGit(sourceRepo, ['add', 'proof.txt'])
    runGit(sourceRepo, ['commit', '-m', 'add proof file'], { ...cliEnv, SKILLCRAFT_HOOK_DISABLED: '1' })

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
    assert.ok(remoteResult.output.includes(`remote status: ${remote} (all referenced proof commits present)`))

    assert.equal(existsSync(join(clone, '.git', 'refs', 'heads', 'skillcraft', 'proofs', 'v1')), false)
  })

  test('verify warns when proof commits are not pushed to remote', (t) => {
    const repo = makeRepo(tempBase, 'verify-unpushed-proof')
    const remote = join(tempBase, 'verify-unpushed-proof-origin.git')

    runCli(['enable'], repo, cliEnv)
    mkdirSync(remote, { recursive: true })
    runGit(remote, ['init', '--bare'])

    const pending = join(repo, '.git', 'skillcraft', 'pending.json')
    writeFileSync(pending, JSON.stringify({ skills: ['acme/alpha'] }))
    writeFileSync(join(repo, 'proof.txt'), 'change\n')
    runGit(repo, ['add', 'proof.txt'])
    runGit(repo, ['commit', '-m', 'add proof file'], { ...cliEnv, SKILLCRAFT_HOOK_DISABLED: '1' })

    runGit(repo, ['remote', 'add', 'origin', remote])
    const hookResult = runCli(['_hook', 'post-commit', repo], repo, cliEnv)
    assertOk(t, hookResult, '')

    const result = runCli(['verify'], repo, cliEnv)
    assertOk(t, result, `verify passed: 1 commit proofs resolved`)
    assert.ok(result.output.includes(`⚠️ Warning: proof commits not pushed to ${remote}:`))

    runCli(['disable'], repo, cliEnv)
  })

  after(() => {
    rmSync(tempBase, { recursive: true, force: true })
  })
})
