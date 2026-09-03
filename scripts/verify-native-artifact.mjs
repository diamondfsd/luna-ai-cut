#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const windowsNativeFiles = [
  'luna-render-core.node',
  'sam-segmentation-worker.exe',
  'semantic-segmentation-worker.exe',
  'specialized-segmentation-worker.exe',
  'luna-inpaint-worker.exe',
  'luna-punctuation-worker.exe',
  'luna-asr-worker.exe',
  'dxcompiler.dll',
  'dxil.dll',
]

function parsePeHeader(buffer, filePath) {
  if (buffer.length < 0x40 || buffer.toString('ascii', 0, 2) !== 'MZ') {
    throw new Error(`${filePath} 不是 Windows PE 文件（缺少 MZ 头）`)
  }

  const peOffset = buffer.readUInt32LE(0x3c)
  if (peOffset + 6 > buffer.length || buffer.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') {
    throw new Error(`${filePath} 不是有效的 Windows PE 文件`)
  }

  const machine = buffer.readUInt16LE(peOffset + 4)
  if (machine !== 0x8664) {
    throw new Error(`${filePath} 架构不匹配：需要 Windows x64，实际 machine=0x${machine.toString(16)}`)
  }
}

export function verifyWindowsNativeArtifact(nativeDir = join(projectRoot, 'luna-render-core')) {
  for (const fileName of windowsNativeFiles) {
    const filePath = join(nativeDir, fileName)
    try {
      parsePeHeader(readFileSync(filePath), filePath)
    } catch (error) {
      throw new Error(`Windows 原生组件校验失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  console.log(`[native-check] Windows x64 原生组件校验通过：${nativeDir}`)
}

export default async function beforePack(context) {
  if (context.electronPlatformName !== 'win32') return
  verifyWindowsNativeArtifact(join(context.packager.projectDir, 'luna-render-core'))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  verifyWindowsNativeArtifact()
}
