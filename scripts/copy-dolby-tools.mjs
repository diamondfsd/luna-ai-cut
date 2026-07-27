import { createHash } from 'node:crypto'
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import AdmZip from 'adm-zip'

const targetIndex = process.argv.indexOf('--target')
const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : process.platform
const archIndex = process.argv.indexOf('--arch')
const arch = archIndex >= 0 ? process.argv[archIndex + 1] : process.arch
const version = '2.3.3'
const bentoVersion = '1-6-0-641'
const destination = path.join(process.cwd(), 'resources', 'dolby-vision')
const cache = path.join(process.cwd(), '.dolby-tools-cache')

const releases = {
  darwin: {
    dovi: {
      url: `https://github.com/quietvoid/dovi_tool/releases/download/${version}/dovi_tool-${version}-universal-macOS.zip`,
      sha256: 'b113c83fed2d8d7ed9e43f0428d02fa0d0030e20965fc24a3cd4d48597d88685',
      binary: 'dovi_tool',
    },
    bento: {
      url: `https://www.bok.net/Bento4/binaries/Bento4-SDK-${bentoVersion}.universal-apple-macosx.zip`,
      sha256: '0570cf0dd59f362904d6f1cb472cbf4cdd37928fb0fe28e4c7f98c460e8e0ced',
      binary: 'mp4mux',
    },
  },
  win32: {
    dovi: {
      url: `https://github.com/quietvoid/dovi_tool/releases/download/${version}/dovi_tool-${version}-x86_64-pc-windows-msvc.zip`,
      sha256: '37ae198f2a535c910befad39fc09c21cded76bf3ef2d5459d542e58c2c158311',
      binary: 'dovi_tool.exe',
    },
    bento: {
      url: `https://www.bok.net/Bento4/binaries/Bento4-SDK-${bentoVersion}.x86_64-microsoft-win32.zip`,
      sha256: '6916a390f75878872594be74554b8b54ab220bb29812424441a8e1ecc9a6ac5e',
      binary: 'mp4mux.exe',
    },
  },
}

if (!(target in releases) || (target === 'win32' && arch !== 'x64')) {
  throw new Error(`Dolby Vision tools do not support target ${target}-${arch}`)
}

mkdirSync(destination, { recursive: true })
mkdirSync(cache, { recursive: true })
for (const binary of ['dovi_tool', 'dovi_tool.exe', 'mp4mux', 'mp4mux.exe']) {
  rmSync(path.join(destination, binary), { force: true })
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects > 0) {
        response.resume()
        resolve(get(new URL(response.headers.location, url).href, redirects - 1))
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`download failed: HTTP ${response.statusCode}`))
        return
      }
      resolve(response)
    }).on('error', reject)
  })
}

async function archiveFor(name, release) {
  const archive = path.join(cache, `${name}-${target}-${arch}.zip`)
  if (existsSync(archive) && sha256(archive) !== release.sha256) rmSync(archive, { force: true })
  if (!existsSync(archive)) {
    const partial = `${archive}.partial`
    let lastError
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      rmSync(partial, { force: true })
      try {
        const response = await get(release.url)
        await pipeline(response, createWriteStream(partial))
        if (sha256(partial) !== release.sha256) throw new Error(`${name} SHA256 verification failed`)
        renameSync(partial, archive)
        lastError = undefined
        break
      } catch (error) {
        lastError = error
        rmSync(partial, { force: true })
        console.warn(`[copy-dolby-tools] ${name} download attempt ${attempt} failed`)
      }
    }
    if (lastError) throw lastError
  }
  return archive
}

async function install(name, release) {
  const archive = await archiveFor(name, release)
  const zip = new AdmZip(archive)
  const entry = zip.getEntries().find((candidate) => path.basename(candidate.entryName) === release.binary)
  if (!entry) throw new Error(`${release.binary} is missing from ${path.basename(archive)}`)
  const output = path.join(destination, release.binary)
  writeFileSync(output, entry.getData())
  if (target !== 'win32') chmodSync(output, 0o755)
  console.log(`[copy-dolby-tools] ${release.binary} -> ${output}`)
}

const selected = releases[target]
await install('dovi-tool', selected.dovi)
await install('bento4', selected.bento)
