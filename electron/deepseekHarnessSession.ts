import * as fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { stringify } from 'yaml'

const DEFAULT_AGENTS_START = '<!-- luna-ai-cut:default-agents:start -->'
const DEFAULT_AGENTS_END = '<!-- luna-ai-cut:default-agents:end -->'
const CURRENT_PROJECT_START = '<!-- luna-ai-cut:current-project:start -->'
const CURRENT_PROJECT_END = '<!-- luna-ai-cut:current-project:end -->'

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

function currentProjectInstructions(project?: HarnessSessionProject): string {
  if (!project) return ''
  return `${CURRENT_PROJECT_START}
## 当前打开的剪辑项目

- projectId: ${JSON.stringify(project.projectId)}
- projectName: ${JSON.stringify(project.projectName ?? project.projectId)}

这是宿主当前已经打开的 FreeCut 剪辑项目。通过 Luna SDK 操作剪辑时，使用这个项目上下文；不要猜测或替换 projectId。
${CURRENT_PROJECT_END}`
}

export function defaultSessionAgents(project?: HarnessSessionProject): string {
  const currentProject = currentProjectInstructions(project)
  return `${DEFAULT_AGENTS_START}
# Luna AI Cut 编辑会话

当前会话已经接入 Luna Editor SDK。涉及 FreeCut 剪辑时，使用 Harness 提供的 edit.run_script 工具，
在脚本中调用注入的 luna SDK。不要直接修改项目文件、时间线内部数据或 Electron 状态。

脚本必须导出：

~~~js
export default async function main(luna) {
  const projectState = await luna.project.inspect()
  const timeline = await luna.timeline.inspectContext()
  return { projectId: projectState.data.projectId, project: projectState, timeline }
}
~~~

每个 SDK 调用都返回结构化结果，实际能力数据从 data.project、data.createdItemIds 和
data.affectedIds 读取。先读取项目或时间线状态，再通过结构化 SDK 调用执行剪切、分割、移动、
删除、参数、关键帧、文字和转场等操作；每次调用都等待结果并根据结构化数据继续下一步。

时间参数统一使用秒数：timeline.trim 使用 itemId 加 startSeconds/endSeconds（时间轴绝对位置），
timeline.split 使用 itemId 加 atSeconds，timeline.move 使用 itemId 加 toSeconds。
timeline.addTrack 使用 type（video 或 audio）、可选 name/order，返回的 data.createdItemIds[0] 是轨道 ID。
视频片段使用视频轨道；字幕、标题和其他画面叠加先创建独立视频轨道；TTS、背景音乐和音效先创建独立音频轨道；
原始视频产生的伴侣音频保留在原音频轨道。不要把所有内容反复写入默认的两个轨道。
timeline.addTransition 的 type 只能是 'crossfade'，使用 fromClipId、toClipId、type:'crossfade'、durationSeconds；
需要淡化视觉样式时另传 presentation:'fade'，不要把 'fade' 作为 type，也不要省略 type。
两个画面片段必须在同一视频轨道并在切点相邻；相邻转场还要求前片段有源素材尾部余量、后片段有源素材头部余量。
先检查 timeline.inspectContext() 中的 from、durationInFrames、sourceStart、sourceEnd、sourceDuration，任一侧余量为 0
就不要调用转场，或先调整源区间/改用 fadeIn/fadeOut。工具失败时读取结构化错误，不要假设转场已添加。

素材使用 media.list、media.read 和 media.searchTranscript。需要新证据时，先用
media.analyze 提交 transcript 或 visual 任务，再用 media.getAnalysisTask 轮询到 completed 或 failed；
完成后再使用 media.read。加入时间轴使用 timeline.addMedia 或 timeline.addMediaBatch。

长期偏好使用 memory.read/search/update/remove：只保存跨项目可复用的用户偏好，更新和删除都复用准确的
memoryId。TTS 使用 audio.startSpeech；背景音乐和音效使用 audio.startMusic，其中 model 使用
small-music 或 small-sfx；提交后用 audio.getTask 轮询。queued、preparing-model、generating 和 saving
都表示仍在处理，只有 completed 且存在 mediaId 时才能加入时间轴，failed 时读取结构化错误。
分析任务为 failed 时，不得继续把不存在的分析结果当作事实使用。
不要根据固定文案猜测用户意图或自行宣布任务完成。
${DEFAULT_AGENTS_END}${currentProject ? `\n\n${currentProject}` : ''}`
}

async function ensureSessionAgents(sessionRoot: string, project?: HarnessSessionProject): Promise<void> {
  const agentsPath = path.join(sessionRoot, 'AGENTS.md')
  const defaultContent = defaultSessionAgents()
  let existing = ''
  try {
    existing = await fs.readFile(agentsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
  }

  if (!existing) {
    await writePrivateText(agentsPath, `${defaultSessionAgents(project)}\n`)
    return
  }

  const start = existing.indexOf(DEFAULT_AGENTS_START)
  const endMarkerIndex = existing.indexOf(DEFAULT_AGENTS_END)
  if (start >= 0 && endMarkerIndex >= start) {
    const end = endMarkerIndex + DEFAULT_AGENTS_END.length
    existing = `${existing.slice(0, start)}${defaultContent}${existing.slice(end)}`
  }

  const currentStart = existing.indexOf(CURRENT_PROJECT_START)
  const currentEndMarkerIndex = existing.indexOf(CURRENT_PROJECT_END)
  if (currentStart >= 0 && currentEndMarkerIndex >= currentStart) {
    const currentEnd = currentEndMarkerIndex + CURRENT_PROJECT_END.length
    existing = `${existing.slice(0, currentStart)}${existing.slice(currentEnd)}`.replace(/\n{3,}/gu, '\n\n')
  }

  const currentProject = currentProjectInstructions(project)
  const insertion = currentProject ? `\n\n${currentProject}` : ''
  const defaultEnd = existing.indexOf(DEFAULT_AGENTS_END)
  if (defaultEnd < 0) {
    existing = `${defaultContent}${insertion}\n\n${existing}`
  } else {
    const end = defaultEnd + DEFAULT_AGENTS_END.length
    existing = `${existing.slice(0, end)}${insertion}${existing.slice(end)}`
  }

  // Preserve any user-authored session instructions while making the Luna
  // defaults visible to Harness's cwd-based instruction loader.
  const next = existing.trimEnd() + '\n'
  if (next !== (await fs.readFile(agentsPath, 'utf8').catch(() => ''))) {
    await writePrivateText(agentsPath, next)
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
      config: { registerBuiltInSkills: false },
    }],
  }])
  await ensureSessionAgents(sessionRoot, project)
  return patchPath
}
