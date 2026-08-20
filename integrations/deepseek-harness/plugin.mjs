// DeepSeek Harness adapter for the Luna JS SDK.
//
// The adapter registers one protocol entry point. It does not inspect user
// messages, choose an editing workflow, or execute FreeCut operations. The
// host capability endpoint remains the owner of those capabilities.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { normalizeLunaConfig } from './config.mjs'
import { runEditScript } from './script-runtime.mjs'
import { LUNA_SDK_API } from './sdk-client.mjs'

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    message: { type: 'string' },
    data: {},
  },
  required: ['ok', 'message'],
  additionalProperties: true,
}

const SCRIPT_TOOL = {
  name: 'edit.run_script',
  description: '执行一段 Luna JS SDK 脚本。脚本必须导出 default async function main(luna)，通过 SDK 读取上下文、调用宿主能力并返回结构化结果。工具结果会原样回传给模型。',
  parameters: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        minLength: 1,
        maxLength: 500_000,
        description: '完整的 ESM 脚本，必须导出 default async function main(luna)。',
      },
    },
    required: ['code'],
    additionalProperties: false,
  },
}

export const FREECUT_EXPOSED_TOOL_NAMES = [SCRIPT_TOOL.name]

export const name = 'luna-freecut-script-editing'
export const inject = ['tools', 'systemPrompt', 'skills']

export function renderToolResult(_args, value) {
  const text = JSON.stringify(value, null, 2)
  return [{ type: 'text', text: text ?? String(value) }]
}

function sdkMethodReference() {
  return Object.entries(LUNA_SDK_API)
    .flatMap(([namespace, methods]) => Object.entries(methods).map(([method, capability]) => {
      return `- luna.${namespace}.${method}(args) -> ${capability}`
    }))
    .join('\n')
}

let builtInSkillsLoaderPromise

async function builtInSkillsLoader() {
  if (builtInSkillsLoaderPromise === undefined) {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
    const candidates = [
      path.resolve(moduleDirectory, '../../scripts/deepseek-harness-built-in-skills.mjs'),
      path.resolve(moduleDirectory, '../../deepseek-harness/deepseek-harness-built-in-skills.mjs'),
    ]
    builtInSkillsLoaderPromise = (async () => {
      let lastError
      for (const candidate of candidates) {
        if (!existsSync(candidate)) continue
        try {
          return await import(pathToFileURL(candidate).href)
        } catch (error) {
          lastError = error
        }
      }
      throw lastError ?? new Error('Luna AI Cut 内置技能加载器不存在，请重新构建 Harness runtime。')
    })()
  }
  return builtInSkillsLoaderPromise
}

// This prompt documents the wire contract only. Domain-specific editing
// guidance is loaded from the Markdown skill resources below.
export const SCRIPT_SYSTEM_PROMPT = `
The only editing tool exposed by this adapter is edit.run_script.

The argument must be an ESM module exporting:

export default async function main(luna) {
  return { ok: true }
}

The script may call the following Luna SDK methods. The adapter forwards each
structured call to the host capability endpoint and returns the host result;
the host and model own all business decisions.

The host binds every SDK call to the FreeCut project currently open in the
editor. Start by calling luna.project.inspect(); its result includes
data.projectId and data.project. Do not invent or substitute a projectId.

${sdkMethodReference()}

The script result is returned to the model. No adapter code classifies user
messages or model text, changes the script, or declares a task complete.
`.trim()

function resolveConfig(config) {
  return normalizeLunaConfig(config)
}

function shouldRegisterSkills(config) {
  return config?.registerBuiltInSkills !== false
}

export async function apply(ctx, config) {
  const resolvedConfig = resolveConfig(config)
  const skillLoader = await builtInSkillsLoader()
  const sharedPrompt = await skillLoader.loadSharedPrompt()
  if (shouldRegisterSkills(config)) await skillLoader.registerBuiltInSkills(ctx)

  ctx.tools.register({
    ...SCRIPT_TOOL,
    output: {
      schema: RESULT_SCHEMA,
      render: renderToolResult,
    },
    timeoutMs: 30 * 60 * 1000,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const result = await runEditScript(resolvedConfig, {
        code: args?.code,
        signal: exec.signal,
      })
      exec.signal.throwIfAborted()
      return result
    },
  })

  const disposePrompt = ctx.systemPrompt.section({
    name: 'luna-sdk: script protocol',
    order: 120,
    text: `${SCRIPT_SYSTEM_PROMPT}\n\n${sharedPrompt}`,
  })
  return () => disposePrompt()
}
