import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT_CONFIG = 'tsdown.config.ts'
const UPSTREAM_ANCHOR = "    workspace: ['vendor/*', 'packages/*/*', 'apps/cli'],\n    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],"
const LUNA_ADAPTATION = "    workspace: ['vendor/*', 'packages/*/*', 'apps/cli'],\n    filter: /^(?!@deepseek-ai\\/dsh-root$)/,\n    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],"

export async function applyDeepSeekHarnessAdaptations(harnessRoot) {
  const configPath = join(harnessRoot, ROOT_CONFIG)
  const source = await readFile(configPath, 'utf8')
  if (source.includes(LUNA_ADAPTATION)) return false
  if (!source.includes(UPSTREAM_ANCHOR)) {
    throw new Error(`DeepSeek Harness 根 tsdown 配置格式已变化，无法应用 Luna 适配：${configPath}`)
  }
  await writeFile(configPath, source.replace(UPSTREAM_ANCHOR, LUNA_ADAPTATION))
  return true
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const harnessRoot = process.argv[2]
  if (!harnessRoot) throw new Error('缺少 DeepSeek Harness 根目录。')
  const changed = await applyDeepSeekHarnessAdaptations(harnessRoot)
  console.log(`[harness-adapt] root tsdown aggregate entry ${changed ? 'adapted' : 'already adapted'}`)
}
