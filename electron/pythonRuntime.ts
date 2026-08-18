import { app } from 'electron'
import { access } from 'node:fs/promises'
import path from 'node:path'

const RUNTIME_FOLDER = 'python-runtime'
const PYTHON_VERSION = '3.12'

export interface PythonCommand {
  command: string
  args: string[]
}

function appRoot(): string {
  return process.env.APP_ROOT ?? path.resolve(__dirname, '..')
}

export function bundledPythonRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, RUNTIME_FOLDER)
    : path.join(appRoot(), 'resources', RUNTIME_FOLDER)
}

function bundledPythonCandidates(): string[] {
  const root = bundledPythonRoot()
  if (process.platform === 'win32') {
    return [
      path.join(root, 'python.exe'),
      path.join(root, 'bin', 'python.exe'),
      path.join(root, 'python', 'python.exe'),
    ]
  }
  return [
    path.join(root, 'bin', `python${PYTHON_VERSION}`),
    path.join(root, 'bin', 'python3'),
    path.join(root, 'bin', 'python'),
    path.join(root, 'python', 'bin', `python${PYTHON_VERSION}`),
  ]
}

async function firstExisting(paths: string[]): Promise<string | null> {
  for (const filePath of paths) {
    if (await access(filePath).then(() => true).catch(() => false)) return filePath
  }
  return null
}

export async function hasPythonRuntime(): Promise<boolean> {
  return Boolean(await firstExisting(bundledPythonCandidates()))
}

export async function resolvePythonCommand(): Promise<PythonCommand> {
  const bundled = await firstExisting(bundledPythonCandidates())
  if (bundled) return { command: bundled, args: [] }
  throw new Error('应用内置的音频运行环境缺失，请先执行完整构建流程。')
}
