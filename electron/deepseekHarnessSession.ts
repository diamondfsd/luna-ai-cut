import * as fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { stringify } from 'yaml'

const DEFAULT_AGENTS_START = '<!-- luna-ai-cut:default-agents:start -->'
const DEFAULT_AGENTS_END = '<!-- luna-ai-cut:default-agents:end -->'
const CURRENT_PROJECT_START = '<!-- luna-ai-cut:current-project:start -->'
const CURRENT_PROJECT_END = '<!-- luna-ai-cut:current-project:end -->'
const PROJECT_FILE_NAME = 'PROJECT.md'

export interface HarnessSessionProject {
  projectId: string
  projectName?: string
}

async function writePrivateDocument(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, stringify(value), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, filePath)
    await fs.chmod(filePath, 0o600).catch(() => undefined)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

async function writePrivateText(filePath: string, value: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporary, value, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    await fs.rename(temporary, filePath)
    await fs.chmod(filePath, 0o600).catch(() => undefined)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

function projectDocument(project?: HarnessSessionProject): string {
  if (!project) {
    return `# 当前打开的 FreeCut 剪辑项目

当前没有可用的 FreeCut 剪辑项目。`
  }
  return `# 当前打开的 FreeCut 剪辑项目

- projectId: ${JSON.stringify(project.projectId)}
- projectName: ${JSON.stringify(project.projectName ?? project.projectId)}

这是宿主当前已经打开的 FreeCut 剪辑项目。通过 Luna SDK 操作剪辑时，使用这个项目上下文；不要猜测或替换 projectId。`
}

export function defaultSessionAgents(): string {
  return `${DEFAULT_AGENTS_START}
# Luna AI Cut 编辑会话

当前会话已经接入 Luna Editor SDK。涉及 FreeCut 剪辑时，使用 Harness 提供的 edit.run_script 工具，
在脚本中调用注入的 luna SDK。不要直接修改项目文件、时间线内部数据或 Electron 状态。

当前项目上下文不写在本文件中。理解本文件和用户请求后，在第一次调用 Luna SDK 之前，使用 Harness 的 read 工具读取当前工作目录的
PROJECT.md；以其中的 projectId 和 projectName 为准，不要猜测、替换或向用户索要 projectId。

脚本必须导出 default async function main(luna)，并从每个 SDK 结果的 data 字段读取结构化数据。
详细的剪辑规则、能力说明和可选工作流由本插件注册的 Markdown skills 提供；需要时按 skill 内容执行，
不要在会话目录自行复制或改写这些规则。工具结果必须回传模型，由模型判断下一步，宿主不根据自然语言猜测意图。
${DEFAULT_AGENTS_END}`
}

async function ensureSessionAgents(sessionRoot: string, project?: HarnessSessionProject): Promise<void> {
  const agentsPath = path.join(sessionRoot, 'AGENTS.md')
  const projectPath = path.join(sessionRoot, PROJECT_FILE_NAME)
  const defaultContent = defaultSessionAgents()
  let existing = ''
  try {
    existing = await fs.readFile(agentsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
  }

  if (!existing) {
    await writePrivateText(agentsPath, `${defaultContent}\n`)
  } else {
    const currentStart = existing.indexOf(CURRENT_PROJECT_START)
    const currentEndMarkerIndex = existing.indexOf(CURRENT_PROJECT_END)
    if (currentStart >= 0 && currentEndMarkerIndex >= currentStart) {
      const currentEnd = currentEndMarkerIndex + CURRENT_PROJECT_END.length
      existing = `${existing.slice(0, currentStart)}${existing.slice(currentEnd)}`.replace(/\n{3,}/gu, '\n\n')
    }

    const start = existing.indexOf(DEFAULT_AGENTS_START)
    const endMarkerIndex = existing.indexOf(DEFAULT_AGENTS_END)
    if (start >= 0 && endMarkerIndex >= start) {
      const end = endMarkerIndex + DEFAULT_AGENTS_END.length
      existing = `${existing.slice(0, start)}${defaultContent}${existing.slice(end)}`
    } else {
      existing = `${defaultContent}\n\n${existing}`
    }

    // Preserve any user-authored session instructions while keeping the
    // generated defaults stable across project changes.
    const next = existing.trimEnd() + '\n'
    const previous = await fs.readFile(agentsPath, 'utf8')
    if (next !== previous) await writePrivateText(agentsPath, next)
  }

  const nextProject = `${projectDocument(project)}\n`
  const previousProject = await fs.readFile(projectPath, 'utf8').catch((error) => {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return ''
    throw error
  })
  if (nextProject !== previousProject) {
    await writePrivateText(projectPath, nextProject)
  }
}

/** Create the session-local Harness bridge without changing vendor code. */
export async function prepareHarnessSession(
  sessionRoot: string,
  pluginSource: string,
  project?: HarnessSessionProject,
): Promise<string> {
  const pluginReferencePath = path.join(sessionRoot, 'luna-freecut-plugin.mjs')
  const patchPath = path.join(sessionRoot, 'luna-freecut-plugin.patch.yml')
  const pluginUrl = pathToFileURL(pluginSource).href
  await writePrivateText(
    pluginReferencePath,
    `// Generated session bridge. The implementation stays in the application source tree.\nexport * from ${JSON.stringify(pluginUrl)}\n`,
  )
  await writePrivateDocument(patchPath, [{
    insert: [{
      id: 'luna-freecut-sdk',
      name: pluginReferencePath,
      config: { registerBuiltInSkills: true },
    }],
  }])
  await ensureSessionAgents(sessionRoot, project)
  return patchPath
}
