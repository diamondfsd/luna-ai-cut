import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'luna-downloaded-library-'))

try {
  const modulePath = path.join(root, 'downloaded-library.mjs')
  await build({
    entryPoints: ['electron/media/downloadedLibraryService.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: modulePath,
    plugins: [{
      name: 'headless-logger',
      setup(builder) {
        builder.onResolve({ filter: /\/loggerService$/ }, () => ({ path: 'logger', namespace: 'test' }))
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const logMainWarn = () => {};' }))
      },
    }],
  })
  const { listDownloadedFiles } = await import(pathToFileURL(modulePath).href)
  const downloads = path.join(root, 'downloads')
  const cache = path.join(downloads, 'cache')
  const mediaPaths = [
    'download.jpg',
    '2026-10-01/dated.mp4',
    'cache/previews/preview.jpg',
    'cache/previews/nested/preview.mp4',
    'cache/metadata/metadata.jpg',
    'cache/ai-selection/avatar.jpg',
    'cache/shared-download.jpg',
    'cache/2026-10-01/shared-dated.mp4',
    'cache-other/keep.jpg',
    'album/cache/keep-too.jpg',
    'cache_previews/legacy.jpg',
  ]
  for (const relative of mediaPaths) {
    const filePath = path.join(downloads, relative)
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, 'media')
  }
  const relativePaths = (files, directory) => files.map((file) => path.relative(directory, file.localPath)).sort()

  assert.deepEqual(relativePaths(await listDownloadedFiles(downloads, cache), downloads), [
    '2026-10-01/dated.mp4', 'album/cache/keep-too.jpg', 'cache-other/keep.jpg', 'download.jpg',
  ], '下载目录包含缓存目录时应跳过整棵缓存子树，不误排除同名或同前缀的普通目录')
  assert.deepEqual(relativePaths(await listDownloadedFiles(cache, cache), cache), [
    '2026-10-01/shared-dated.mp4', 'shared-download.jpg',
  ], '下载与缓存共用目录时应保留下载文件并排除生成的缓存子目录')
  assert.deepEqual(await listDownloadedFiles(path.join(cache, 'previews'), cache), [], '直接扫描缓存子目录也不能展示缓存文件')
  assert.deepEqual(relativePaths(await listDownloadedFiles([downloads, path.join(cache, 'previews')], path.join(cache, '..', 'cache')), downloads), [
    '2026-10-01/dated.mp4', 'album/cache/keep-too.jpg', 'cache-other/keep.jpg', 'download.jpg',
  ], '多个扫描入口与路径规范化不能绕过缓存排除')
  assert.equal((await listDownloadedFiles(downloads)).some((file) => file.name === 'download.jpg'), true, '未提供缓存目录时仍能扫描普通媒体')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}

console.log('downloaded library tests passed')
