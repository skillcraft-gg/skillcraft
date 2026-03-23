import fs from 'node:fs/promises'
import path from 'node:path'

function normalizeProvider(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function normalizeModelName(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function extractModelInfo(payload) {
  if (!payload || typeof payload !== 'object') {
    return {}
  }

  const direct = {
    modelProvider: normalizeProvider(payload.model_provider || payload.modelProvider || payload.model_provider_id),
    modelName: normalizeModelName(payload.model_name || payload.modelName || payload.model),
    agentProvider: normalizeProvider(payload.provider || payload.agent_provider || payload.agentProvider),
  }

  const msg = payload.message
  const request = payload.request
  const context = payload.context

  const nestedMessage = msg && typeof msg === 'object' ? {
    modelProvider: normalizeProvider(msg.model_provider || msg.modelProvider),
    modelName: normalizeModelName(msg.model_name || msg.modelName || msg.model),
    agentProvider: normalizeProvider(msg.provider || msg.agent_provider || msg.agentProvider),
  } : {}

  const nestedRequest = request && typeof request === 'object' ? {
    modelProvider: normalizeProvider(request.model_provider || request.modelProvider),
    modelName: normalizeModelName(request.model_name || request.modelName || request.model),
    agentProvider: normalizeProvider(request.provider || request.agent_provider || request.agentProvider),
  } : {}

  const nestedContext = context && typeof context === 'object' ? {
    modelProvider: normalizeProvider(context.model_provider || context.modelProvider),
    modelName: normalizeModelName(context.model_name || context.modelName || context.model),
    agentProvider: normalizeProvider(context.provider || context.agent_provider || context.agentProvider),
  } : {}

  const candidate = {
    agentProvider: direct.agentProvider || nestedMessage.agentProvider || nestedRequest.agentProvider || nestedContext.agentProvider || 'opencode',
    modelProvider: direct.modelProvider || nestedMessage.modelProvider || nestedRequest.modelProvider || nestedContext.modelProvider,
    modelName: direct.modelName || nestedMessage.modelName || nestedRequest.modelName || nestedContext.modelName,
  }

  if (!candidate.modelProvider && !candidate.modelName && !candidate.agentProvider) {
    return {}
  }

  return candidate
}

function resolveStateFile() {
  return path.join(process.cwd(), '.git', 'skillcraft', 'ai-model-context.json')
}

async function updateState(update) {
  const stateFile = resolveStateFile()
  let current = {}

  try {
    const raw = await fs.readFile(stateFile, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      current = parsed
    }
  } catch {
    current = {}
  }

  const next = {
    ...(current || {}),
    ...(update || {}),
  }

  if (!next.agent || typeof next.agent !== 'object' || Array.isArray(next.agent)) {
    next.agent = { provider: 'opencode' }
  } else if (!next.agent.provider && update?.agent?.provider) {
    next.agent = { ...next.agent }
  }

  if (update?.agent?.provider) {
    next.agent.provider = update.agent.provider
  }

  if (update?.model) {
    next.model = {
      ...(next.model || {}),
      ...(update.model || {}),
    }
  }

  try {
    await fs.mkdir(path.join(process.cwd(), '.git', 'skillcraft'), { recursive: true })
    await fs.writeFile(stateFile, JSON.stringify(next, null, 2) + '
', 'utf8')
  } catch {
    return
  }
}

async function handlePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return
  }

  const extracted = extractModelInfo(payload)
  if (!extracted || !extracted.agentProvider && !extracted.modelProvider && !extracted.modelName) {
    return
  }

  const update = {
    agent: {
      provider: extracted.agentProvider || 'opencode',
    },
    model: {
      ...(extracted.modelProvider ? { provider: extracted.modelProvider } : {}),
      ...(extracted.modelName ? { name: extracted.modelName } : {}),
    },
  }

  await updateState(update)
}

export default async function Skillcraft() {
  const handler = async (event) => {
    try {
      await handlePayload(event)
    } catch {
      return
    }
  }

  return {
    'chat.message': async (event) => {
      try {
        await handler(event)
      } catch {
        return
      }
    },
    event: async (event) => {
      try {
        const payload = event?.type && typeof event.type === 'string' ? event : event?.payload
        await handler(payload)
      } catch {
        return
      }
    },
  }
}
