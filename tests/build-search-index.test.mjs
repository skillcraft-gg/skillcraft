import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const INDEX_SCRIPT_PATH = pathToFileURL(join(__dirname, '..', '..', 'skills', '.github', 'scripts', 'build-search-index.mjs')).href
const ANTHROPIC_BASE_URL = 'https://raw.githubusercontent.com/anthropics/skills/main'
const MARKETPLACE_URL = `${ANTHROPIC_BASE_URL}/.claude-plugin/marketplace.json`
const ALT_BASE_URL = 'https://example-registry.test'
const ALT_MARKETPLACE_URL = `${ALT_BASE_URL}/.claude-plugin/marketplace.json`

function createMockResponse(body, options = {}) {
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'last-modified') {
          return options.lastModified || null
        }
        return null
      },
    },
    text: async () => String(body),
    json: async () => {
      if (typeof body === 'string') {
        return JSON.parse(body)
      }
      return body
    },
  }
}

function createMockNotFound() {
  return {
    ok: false,
    status: 404,
    headers: { get: () => null },
    text: async () => '',
    json: async () => ({}),
  }
}

function createMockFetchMap(marketplacePayload, skillDocuments = []) {
  const fetchMap = new Map()

  fetchMap.set(MARKETPLACE_URL, createMockResponse(marketplacePayload, { lastModified: 'Thu, 01 Jan 1970 00:00:00 GMT' }))

  for (const [path, text] of skillDocuments) {
    const normalizedPath = String(path).replace(/^\/+/, '')
    fetchMap.set(`${ANTHROPIC_BASE_URL}/${normalizedPath}`, createMockResponse(text, { lastModified: 'Thu, 02 Jan 1970 00:00:00 GMT' }))
  }

  return fetchMap
}

async function buildIndex(baseDir, fetchMap, options = {}) {
  const originalEnv = process.env.GITHUB_EVENT_NAME
  const originalExternalEnv = process.env.SKILLCRAFT_EXTERNAL_REGISTRIES_PATH
  const originalFetch = global.fetch
  const originalCwd = process.cwd()

  process.env.GITHUB_EVENT_NAME = 'workflow_dispatch'
  if (options.externalRegistriesPath !== undefined) {
    process.env.SKILLCRAFT_EXTERNAL_REGISTRIES_PATH = options.externalRegistriesPath
  } else if (originalExternalEnv !== undefined) {
    process.env.SKILLCRAFT_EXTERNAL_REGISTRIES_PATH = originalExternalEnv
  } else {
    delete process.env.SKILLCRAFT_EXTERNAL_REGISTRIES_PATH
  }
  global.fetch = async (url) => {
    const normalized = typeof url === 'string' ? url : String(url)
    return fetchMap.get(normalized) || createMockNotFound()
  }

  try {
    const { runSearchIndexWorkflow } = await import(INDEX_SCRIPT_PATH)
    process.chdir(baseDir)
    await runSearchIndexWorkflow()

    return JSON.parse(readFileSync(join(baseDir, 'search', 'index.json'), 'utf8'))
  } finally {
    process.chdir(originalCwd)
    rmSync(baseDir, { recursive: true, force: true })
    if (originalEnv === undefined) {
      delete process.env.GITHUB_EVENT_NAME
    } else {
      process.env.GITHUB_EVENT_NAME = originalEnv
    }

    if (originalExternalEnv === undefined) {
      delete process.env.SKILLCRAFT_EXTERNAL_REGISTRIES_PATH
    } else {
      process.env.SKILLCRAFT_EXTERNAL_REGISTRIES_PATH = originalExternalEnv
    }

    global.fetch = originalFetch
  }
}

function writeLocalSkill(baseDir, owner, slug) {
  const localSkillDir = join(baseDir, 'skills', owner, slug)
  mkdirSync(localSkillDir, { recursive: true })
  writeFileSync(join(localSkillDir, 'skill.yaml'), `id: ${owner}/${slug}\nname: Shield\n`)
  writeFileSync(join(localSkillDir, 'SKILL.md'), '# Local skill\n')
}

function writeExternalRegistry(baseDir, filename, config) {
  const externalDir = join(baseDir, 'external-registries')
  mkdirSync(externalDir, { recursive: true })
  const filePath = join(externalDir, filename)
  writeFileSync(filePath, JSON.stringify(config, null, 2))
  return externalDir
}

describe('search index external registry ingestion', () => {
  test('rebuilds index with mocked Anthropic marketplace', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'skillcraft-search-index-'))
    writeLocalSkill(baseDir, 'acme', 'shield')

    const marketplacePayload = {
      plugins: [
        {
          skills: ['./skills/xlsx', 'skills/team/agent', './skills/team/agent', 'skills/team/agent'],
        },
      ],
    }
    const externalSkillMarkdown = [
      ['skills/xlsx/SKILL.md', `---\nname: XLSX\nruntime: node\ntags:\n- spreadsheet\n---`],
      ['skills/team/agent/SKILL.md', `---\nname: Team Agent\nruntime: python\ntags:\n- automation\n---`],
    ]

    const fetchMap = createMockFetchMap(marketplacePayload, externalSkillMarkdown)
    const index = await buildIndex(baseDir, fetchMap)
    const ids = index.map((entry) => entry.id)

    assert.ok(ids.includes('acme/shield'))
    assert.ok(ids.includes('anthropic:xlsx'))
    assert.ok(ids.includes('anthropic:team/agent'))
  })

  test('loads external registry configs from directory', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'skillcraft-search-index-'))
    writeLocalSkill(baseDir, 'acme', 'shield')

    const registryAPayload = {
      plugins: [
        {
          skills: ['skills/registry-a-tool'],
        },
      ],
    }
    const registryBPayload = {
      plugins: [
        {
          skills: ['skills/registry-b-agent', 'skills/registry-b-tool'],
        },
      ],
    }

    const externalSkillMarkdown = [
      ['skills/registry-a-tool/SKILL.md', `---\nname: Registry A Tool\nruntime: node\n---`],
      ['skills/registry-b-agent/SKILL.md', `---\nname: Registry B Agent\nruntime: python\n---`],
      ['skills/registry-b-tool/SKILL.md', `---\nname: Registry B Tool\nruntime: go\n---`],
    ]

    const fetchMap = createMockFetchMap({}, externalSkillMarkdown)
    const registryBMarketplaceUrl = `${ALT_BASE_URL}/registry-b/.claude-plugin/marketplace.json`
    fetchMap.set(ALT_MARKETPLACE_URL, createMockResponse(registryAPayload, { lastModified: 'Thu, 03 Jan 1970 00:00:00 GMT' }))
    fetchMap.set(registryBMarketplaceUrl, createMockResponse(registryBPayload, { lastModified: 'Thu, 03 Jan 1970 00:00:00 GMT' }))

    for (const [path, text] of externalSkillMarkdown) {
      const normalizedPath = String(path).replace(/^\/+/, '')
      fetchMap.set(`${ALT_BASE_URL}/${normalizedPath}`, createMockResponse(text, { lastModified: 'Thu, 03 Jan 1970 00:00:00 GMT' }))
    }

    const registryDir = writeExternalRegistry(baseDir, 'registry-a.json', {
      id: 'registryA',
      marketplaceUrl: ALT_MARKETPLACE_URL,
      repositoryBaseUrl: ALT_BASE_URL,
      pagesBaseUrl: `${ALT_BASE_URL}/blob/main`,
    })

    writeExternalRegistry(baseDir, 'registry-b.json', {
      id: 'registryB',
      marketplaceUrl: registryBMarketplaceUrl,
      repositoryBaseUrl: ALT_BASE_URL,
      pagesBaseUrl: `${ALT_BASE_URL}/blob/main`,
    })

    const index = await buildIndex(baseDir, fetchMap, { externalRegistriesPath: registryDir })
    const externalIds = index.map((entry) => entry.id).filter((id) => id.startsWith('registry'))

    assert.deepStrictEqual(
      externalIds,
      ['registryA:registry-a-tool', 'registryB:registry-b-agent', 'registryB:registry-b-tool'],
    )
  })

  test('deduplicates duplicate external marketplace references', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'skillcraft-search-index-'))
    writeLocalSkill(baseDir, 'acme', 'shield')

    const marketplacePayload = {
      plugins: [
        {
          skills: ['skills/xlsx', './skills/xlsx', 'skills/xlsx', 'skills/team/agent', './skills/team/agent'],
        },
      ],
    }
    const externalSkillMarkdown = [
      ['skills/xlsx/SKILL.md', `---\nname: XLSX\nruntime: node\n---`],
      ['skills/team/agent/SKILL.md', `---\nname: Team Agent\nruntime: python\n---`],
    ]

    const fetchMap = createMockFetchMap(marketplacePayload, externalSkillMarkdown)
    const index = await buildIndex(baseDir, fetchMap)
    const externalIds = index.map((entry) => entry.id).filter((id) => id.startsWith('anthropic:'))

    assert.deepStrictEqual(externalIds, ['anthropic:team/agent', 'anthropic:xlsx'])
  })

  test('ignores malformed external marketplace refs', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'skillcraft-search-index-'))
    writeLocalSkill(baseDir, 'acme', 'shield')

    const marketplacePayload = {
      plugins: [
        {
          skills: [
            './skills/too/deep/path',
            'skills/team/owner/extra',
            'skills/valid-agent',
          ],
        },
      ],
    }
    const externalSkillMarkdown = [['skills/valid-agent/SKILL.md', `---\nname: Valid\nruntime: node\n---`]]

    const fetchMap = createMockFetchMap(marketplacePayload, externalSkillMarkdown)
    const index = await buildIndex(baseDir, fetchMap)
    const externalIds = index.map((entry) => entry.id).filter((id) => id.startsWith('anthropic:'))

    assert.deepStrictEqual(externalIds, ['anthropic:valid-agent'])
  })

  test('fails on invalid external registry config', async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'skillcraft-search-index-'))
    writeLocalSkill(baseDir, 'acme', 'shield')

    const registryDir = writeExternalRegistry(baseDir, 'bad.json', {
      id: 'bad',
      marketplaceUrl: '',
      repositoryBaseUrl: 'https://example.com',
      pagesBaseUrl: 'https://example.com',
    })

    const fetchMap = createMockFetchMap({})
    await assert.rejects(
      async () => {
        await buildIndex(baseDir, fetchMap, { externalRegistriesPath: registryDir })
      },
      /missing required fields/,
    )
  })
})
