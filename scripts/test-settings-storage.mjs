import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { readStoredSettings, readStoredSettingsSync, stableSettingsPath } from '../electron/storage/settingsStorage.ts'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-settings-storage-'))
try {
  const appDataPath = path.join(root, 'app-data')
  const primaryPath = stableSettingsPath(appDataPath)
  const legacyPath = path.join(root, 'legacy-user-data', 'settings.json')
  const legacySettings = { baseDir: 'D:\\Luna', cameraHost: '192.168.42.1' }

  await fs.mkdir(path.dirname(legacyPath), { recursive: true })
  await fs.writeFile(legacyPath, JSON.stringify(legacySettings), 'utf8')

  const legacyResult = await readStoredSettings(primaryPath, legacyPath)
  assert.deepEqual(legacyResult.value, legacySettings, '应读取旧用户目录中的设置')
  assert.equal(legacyResult.fromLegacyPath, true, '旧设置应标记为待迁移')
  assert.ok(primaryPath.endsWith(path.join('LunaAI-Cut', 'settings.json')), '设置应写入固定目录')

  const primarySettings = { baseDir: 'E:\\Luna', cameraHost: '192.168.42.2' }
  await fs.mkdir(path.dirname(primaryPath), { recursive: true })
  await fs.writeFile(primaryPath, JSON.stringify(primarySettings), 'utf8')

  const primaryResult = readStoredSettingsSync(primaryPath, legacyPath)
  assert.deepEqual(primaryResult.value, primarySettings, '固定位置的设置应优先于旧位置')
  assert.equal(primaryResult.fromLegacyPath, false, '固定位置的设置不应被标记为旧设置')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}

console.log('settings storage tests passed')
