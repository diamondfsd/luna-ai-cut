const ENV_KEYS = Object.freeze({
  endpoint: ['LUNA_SDK_ENDPOINT', 'LUNA_ASSISTANT_CAPABILITY_ENDPOINT', 'LUNA_SCRIPT_ENDPOINT'],
  token: ['LUNA_SDK_TOKEN', 'LUNA_ASSISTANT_CAPABILITY_TOKEN', 'LUNA_SCRIPT_TOKEN'],
  projectId: ['LUNA_SDK_PROJECT_ID', 'LUNA_ASSISTANT_PROJECT_ID', 'LUNA_SCRIPT_PROJECT_ID'],
  sessionId: ['LUNA_SDK_SESSION_ID', 'LUNA_ASSISTANT_SESSION_ID', 'LUNA_SCRIPT_SESSION_ID'],
  cwd: ['LUNA_SDK_CWD', 'LUNA_ASSISTANT_CWD', 'LUNA_SCRIPT_CWD'],
  model: ['LUNA_SDK_MODEL', 'LUNA_ASSISTANT_MODEL', 'LUNA_SCRIPT_MODEL', 'DEEPSEEK_MODEL'],
})

function firstNonEmpty(...values) {
  return values.find(value => typeof value === 'string' && value.trim())?.trim()
}

function fromEnvironment(env, key) {
  return firstNonEmpty(...ENV_KEYS[key].map(name => env?.[name]))
}

/**
 * Resolve the stable Luna SDK host configuration from plugin options or the
 * environment. The legacy LUNA_ASSISTANT_* and LUNA_SCRIPT_* names remain
 * accepted so an Electron host can upgrade the adapter independently.
 */
export function normalizeLunaConfig(input = {}, env = process.env, options = {}) {
  const config = input && typeof input === 'object' ? input : {}
  const resolved = {
    endpoint: firstNonEmpty(config.endpoint, fromEnvironment(env, 'endpoint')),
    token: firstNonEmpty(config.token, fromEnvironment(env, 'token')),
    projectId: firstNonEmpty(config.projectId, fromEnvironment(env, 'projectId')),
    sessionId: firstNonEmpty(config.sessionId, fromEnvironment(env, 'sessionId')),
    cwd: firstNonEmpty(config.cwd, fromEnvironment(env, 'cwd')),
    model: firstNonEmpty(config.model, fromEnvironment(env, 'model')),
  }

  if (!resolved.endpoint || !resolved.token || !resolved.projectId || !resolved.cwd) {
    throw new Error('Luna SDK 配置不完整：需要 endpoint、token、projectId 和 cwd。')
  }
  if (options.requireModel && !resolved.model) {
    throw new Error('Luna Harness 配置不完整：还需要 model。')
  }
  return Object.freeze(resolved)
}

export function toLunaEnvironment(config) {
  const resolved = normalizeLunaConfig(config)
  return {
    LUNA_SDK_ENDPOINT: resolved.endpoint,
    LUNA_SDK_TOKEN: resolved.token,
    LUNA_SDK_PROJECT_ID: resolved.projectId,
    ...(resolved.sessionId ? { LUNA_SDK_SESSION_ID: resolved.sessionId } : {}),
    LUNA_SDK_CWD: resolved.cwd,
    ...(resolved.model ? { LUNA_SDK_MODEL: resolved.model } : {}),
    // Keep the old names for scripts and packaged hosts that still read them.
    LUNA_SCRIPT_ENDPOINT: resolved.endpoint,
    LUNA_SCRIPT_TOKEN: resolved.token,
    LUNA_SCRIPT_PROJECT_ID: resolved.projectId,
    ...(resolved.sessionId ? { LUNA_SCRIPT_SESSION_ID: resolved.sessionId } : {}),
    LUNA_SCRIPT_CWD: resolved.cwd,
    ...(resolved.model ? { LUNA_SCRIPT_MODEL: resolved.model } : {}),
  }
}
