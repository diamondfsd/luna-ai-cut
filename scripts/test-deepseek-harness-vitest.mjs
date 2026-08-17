import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harnessRoot = join(root, 'packages/freecut-editor/src/features/ai-editing')
const executable = join(
  harnessRoot,
  'node_modules/.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest',
)

if (!existsSync(executable)) {
  console.error('DeepSeek Harness 测试依赖未安装，请先在 Harness 目录执行 pnpm install --frozen-lockfile。')
  process.exit(1)
}

const defaultFiles = [
  'packages/llm/llm-deepseek/tests/translate.spec.ts',
  'packages/llm/llm/tests/assembler.spec.ts',
]
const result = spawnSync(executable, ['run', ...(process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultFiles)], {
  cwd: harnessRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.error) {
  console.error(`DeepSeek Harness 测试启动失败：${result.error.message}`)
  process.exit(1)
}
process.exit(result.status ?? 1)
