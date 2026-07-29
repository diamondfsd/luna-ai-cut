import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import AdmZip from 'adm-zip'

const DXC_VERSION = '1.9.2602.24'
const DXC_PACKAGE_SHA256 = '4e4cef12283f7875a3602b9f5dc04f153c77cfa216559f58881305f59f8f7e2f'
const DXC_PACKAGE_URL = `https://api.nuget.org/v3-flatcontainer/microsoft.direct3d.dxc/${DXC_VERSION}/microsoft.direct3d.dxc.${DXC_VERSION}.nupkg`

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function ensurePackage(packagePath) {
  if (existsSync(packagePath) && sha256(packagePath) === DXC_PACKAGE_SHA256) return

  const partialPath = `${packagePath}.download`
  rmSync(partialPath, { force: true })
  const response = await fetch(DXC_PACKAGE_URL)
  if (!response.ok) throw new Error(`DXC download failed: HTTP ${response.status}`)
  writeFileSync(partialPath, Buffer.from(await response.arrayBuffer()))
  const actualHash = sha256(partialPath)
  if (actualHash !== DXC_PACKAGE_SHA256) {
    rmSync(partialPath, { force: true })
    throw new Error(`DXC package checksum mismatch: ${actualHash}`)
  }
  renameSync(partialPath, packagePath)
}

function extract(zip, entryName, destination) {
  const entry = zip.getEntry(entryName)
  if (!entry) throw new Error(`DXC package entry is missing: ${entryName}`)
  const temporary = `${destination}.tmp`
  rmSync(temporary, { force: true })
  writeFileSync(temporary, entry.getData())
  rmSync(destination, { force: true })
  renameSync(temporary, destination)
}

export async function prepareDxcRuntime({ rootDir, outputDir, arch }) {
  const packageArch = arch === 'arm64' ? 'arm64' : arch === 'ia32' ? 'x86' : 'x64'
  const cacheDir = join(rootDir, '.dxc-cache')
  const packagePath = join(cacheDir, `microsoft.direct3d.dxc.${DXC_VERSION}.nupkg`)
  mkdirSync(cacheDir, { recursive: true })
  mkdirSync(outputDir, { recursive: true })
  await ensurePackage(packagePath)

  const zip = new AdmZip(packagePath)
  extract(zip, `build/native/bin/${packageArch}/dxcompiler.dll`, join(outputDir, 'dxcompiler.dll'))
  extract(zip, `build/native/bin/${packageArch}/dxil.dll`, join(outputDir, 'dxil.dll'))

  for (const [source, destination] of [
    ['LICENCE-MIT.txt', 'DXC-LICENSE-MIT.txt'],
    ['LICENSE-LLVM.txt', 'DXC-LICENSE-LLVM.txt'],
    ['LICENSE-MS.txt', 'DXC-LICENSE-MS.txt'],
  ]) {
    extract(zip, source, join(outputDir, destination))
  }

  console.log(`[prepare-dxc] DXC ${DXC_VERSION} ready (${packageArch})`)
}
