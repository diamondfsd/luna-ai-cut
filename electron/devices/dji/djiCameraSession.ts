import { getSettings, saveSettings } from '../../storage/fileService'
import net from 'node:net'
import type { CameraMediaSourceOptions, CameraMediaSourcePreparationResult, CameraMediaSourceStatus, ConnectionStatus, LunaFile } from '../../../src/shared/types'
import { djiProfileForDevice, type DjiModelProfile } from './djiModels'
import type { DjiWifiCredentials } from './djiBleSession'
import { encodeDjiMessage, hex, newInstallIdentity, packString } from './djiBytes'
import { isPrimaryMedia, isProxyMedia, mediaStem, parseCompositeManifest, type DjiManifestFile } from './djiManifest'
import { DjiUdpTransport, decodeDumlFromUdp } from './djiUdpTransport'
import { DefaultDjiWirelessPreparation, type DjiWirelessPreparation } from './djiWirelessPreparation'
import { mockTcpPortForHost, mockUdpPortForHost } from '../../devtools/mock/mockServerService'
import { captureDateFromMediaSource } from '../../media/mediaCaptureDate'
import { labelsFor } from '../../media/filePathUtils'
import { lunaMediaAdapter } from '../common/deviceMedia'

interface DjiEndpoint {
  host: string
  httpPort: number
  udpPort: number
  tcpPort: number
}

function endpointFor(host: string, profile: DjiModelProfile): DjiEndpoint {
  const normalized = host.includes('://') ? host : `http://${host}`
  const url = new URL(normalized)
  const isMock = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  const cameraHost = `${url.hostname}:${url.port || (isMock ? profile.mockHttpPort : profile.httpPort)}`
  return {
    host: url.hostname,
    httpPort: Number(url.port || (isMock ? profile.mockHttpPort : profile.httpPort)),
    udpPort: isMock ? (mockUdpPortForHost(cameraHost) ?? profile.mockUdpPort) : profile.udpPort,
    tcpPort: isMock ? (mockTcpPortForHost(cameraHost) ?? profile.mockTcpPort) : profile.tcpPort,
  }
}

function httpBase(endpoint: DjiEndpoint): string {
  return `http://${endpoint.host}:${endpoint.httpPort}`
}

function mediaUrl(endpoint: DjiEndpoint, storage: number, cameraPath: string): string {
  const params = new URLSearchParams({ storage: String(storage), path: cameraPath })
  return `${httpBase(endpoint)}/v2?${params.toString()}`
}

function sizeText(bytes: number | null): string {
  if (bytes === null) return '-'
  if (bytes >= 1024 ** 3) return `${Math.round(bytes / 1024 ** 3)}G`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)}M`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}K`
  return String(bytes)
}

function storageLabel(storageId: string): string {
  return storageId === 'sdcard' ? 'SD 卡' : '内置存储'
}

function storageNumber(storageId: string): number {
  return storageId === 'sdcard' ? 0 : 1
}

function listQuery(counter: number, cursor: number): Buffer {
  const query = hex('4a002a10010000000000010000002d000d0100ffffffffffffffff000100000000000000000000000000')
  query[4] = counter & 0xff
  query.writeUInt32LE(cursor >>> 0, 10)
  return query
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

export class DjiCameraSession {
  readonly profile: DjiModelProfile
  private readonly endpoint: DjiEndpoint
  private readonly udp: DjiUdpTransport
  private readonly wirelessPreparation: DjiWirelessPreparation
  private credentials: DjiWifiCredentials | null = null
  private connected = false

  constructor(private readonly deviceId: string, host: string, private readonly installIdentity: string, wirelessPreparation?: DjiWirelessPreparation) {
    this.profile = djiProfileForDevice(deviceId)
    this.endpoint = endpointFor(host, this.profile)
    this.udp = new DjiUdpTransport(this.endpoint.host, this.endpoint.udpPort)
    this.wirelessPreparation = wirelessPreparation ?? new DefaultDjiWirelessPreparation(deviceId, host, installIdentity)
  }

  get host(): string {
    return `${this.endpoint.host}:${this.endpoint.httpPort}`
  }

  async connect(options: CameraMediaSourceOptions = { mode: 'wireless', deviceId: this.deviceId, host: this.host }): Promise<CameraMediaSourceStatus> {
    if (!this.connected) {
      const preparation = await this.wirelessPreparation.prepare(options)
      this.credentials = preparation.credentials ?? null
      await this.tcpPoke()
      await this.udp.handshake()
      await this.registerCamera()
      this.connected = true
      return this.status(`${preparation.message}，UDP 会话已建立`)
    }
    return this.status('DJI 相机连接已保持')
  }

  async prepareConnection(options: CameraMediaSourceOptions): Promise<CameraMediaSourcePreparationResult> {
    const preparation = await this.wirelessPreparation.prepare(options)
    this.credentials = preparation.credentials ?? null
    return {
      mode: 'wireless',
      preparation: preparation.mode,
      credentials: preparation.credentials,
      capabilities: this.wirelessPreparation.capabilities,
      message: preparation.message,
    }
  }

  async check(options?: CameraMediaSourceOptions): Promise<CameraMediaSourceStatus> {
    try {
      await this.connect(options)
      return this.status('DJI 相机连接正常')
    } catch (error) {
      return this.status(error instanceof Error ? error.message : String(error), false)
    }
  }

  async listFiles(storageId = 'all', options?: CameraMediaSourceOptions): Promise<LunaFile[]> {
    if (!this.connected) await this.connect(options)
    const storageIds = storageId === 'all' ? this.profile.storageIds : [storageId]
    const files: DjiManifestFile[] = []
    for (const [index, id] of storageIds.entries()) {
      const cursor = id === 'sdcard' ? 0x00000001 : 0x40000001
      const manifest = await this.requestManifest(index + 1, cursor, id)
      files.push(...manifest)
    }
    const primary = files.filter(isPrimaryMedia)
    const proxies = files.filter(isProxyMedia)
    return mapWithConcurrency(primary, 4, (file) => this.toLunaFile(file, proxies))
  }

  async close(): Promise<void> {
    this.connected = false
    this.udp.close()
    await this.wirelessPreparation.close()
  }

  private async registerCamera(): Promise<void> {
    await this.udp.sendCommand({ target: 0x0802, id: 0x8001, cmdSet: 0x00, cmdId: 0x81, flags: 0x40, payload: hex('00415050000000000000000000000000000000000000000000000000000000000000000000000200000000000000020800000000000000000000') })
    await this.udp.sendCommand({ target: 0x0102, id: 0x8002, cmdSet: 0x00, cmdId: 0x88, flags: 0x40, payload: hex('170046237c415050000000000002') })
    await this.udp.sendCommand({ target: 0x0302, id: 0x8003, cmdSet: 0x03, cmdId: 0xda, flags: 0x40, payload: hex('05ffffffff') })
  }

  private async tcpPoke(): Promise<void> {
    const frame = encodeDjiMessage({
      target: 0x0702,
      id: 0x8092,
      cmdSet: 0x07,
      cmdId: 0x45,
      flags: 0x40,
      payload: Buffer.concat([packString(this.installIdentity), packString('osmo')]),
    })
    await new Promise<void>((resolve) => {
      const socket = net.createConnection({ host: this.endpoint.host, port: this.endpoint.tcpPort })
      const finish = (): void => { socket.destroy(); resolve() }
      socket.setTimeout(1200, finish)
      socket.once('error', finish)
      socket.once('connect', () => {
        socket.write(frame, () => setTimeout(finish, 40))
      })
    })
  }

  private async requestManifest(counter: number, cursor: number, storageId: string): Promise<DjiManifestFile[]> {
    const packets = await this.udp.commandAndCollect({ target: 0x0102, id: 0x8026, cmdSet: 0x00, cmdId: 0x26, flags: 0x40, payload: listQuery(counter, cursor) }, 1200)
    const chunks: Buffer[] = []
    for (const packet of packets) {
      const message = decodeDumlFromUdp(packet)
      if (!message || message.cmdSet !== 0x00 || message.cmdId !== 0x27 || message.payload.length < 10) continue
      const payload = message.payload
      if (payload[0] === 0x4a && payload[1] === 0x01 && payload[4] === counter) chunks.push(payload.subarray(10))
    }
    if (chunks.length === 0) return []
    return parseCompositeManifest(Buffer.concat(chunks), storageId)
  }

  private async toLunaFile(file: DjiManifestFile, proxies: DjiManifestFile[]): Promise<LunaFile> {
    const storageNumberValue = storageNumber(file.storageId)
    const sourceUrl = mediaUrl(this.endpoint, storageNumberValue, file.path)
    const head = await fetch(sourceUrl, { method: 'HEAD' }).catch(() => null)
    const length = head?.ok ? Number(head.headers.get('content-length') ?? NaN) : NaN
    const bytes = Number.isFinite(length) ? length : null
    const proxy = proxies.find((candidate) => mediaStem(candidate.name) === mediaStem(file.name) && candidate.storageId === file.storageId)
    const previewUrl = proxy ? mediaUrl(this.endpoint, storageNumberValue, proxy.path) : null
    const kind = file.extension === 'JPG' || file.extension === 'JPEG' || file.extension === 'DNG' || file.extension === 'HEIC' ? 'image' : 'video'
    const capturedAt = await captureDateFromMediaSource(sourceUrl, kind)
      ?? lunaMediaAdapter.capturedAt(file.name)
    const labels = labelsFor(capturedAt)
    const baseId = `dji:${this.profile.id}:${file.storageId}:${file.path}`
    return {
      id: baseId,
      storageId: file.storageId,
      storageLabel: storageLabel(file.storageId),
      sourceDeviceId: this.profile.deviceId,
      sourceDeviceName: this.profile.name,
      cameraType: this.profile.name,
      name: file.name,
      href: sourceUrl,
      sourceUrl,
      url: sourceUrl,
      dateText: labels.dateText,
      timeText: labels.timeText,
      sizeText: sizeText(bytes),
      bytes,
      kind,
      extension: file.extension.toLowerCase(),
      capturedAt: labels.capturedAt,
      groupDay: labels.groupDay,
      groupHour: labels.groupHour,
      videoKey: null,
      previewName: proxy?.name ?? null,
      previewUrl,
      cacheFilePath: null,
      downloadFilePath: null,
      thumbnailUrl: null,
      isLivePhoto: false,
      livePhotoVideoName: null,
      livePhotoVideoUrl: null,
      livePhotoCacheFilePath: null,
      downloadName: file.name,
      canPreview: true,
      rawCompanion: null,
    }
  }

  private status(message: string, connected = true): CameraMediaSourceStatus {
    const base: ConnectionStatus = {
      deviceId: this.profile.deviceId,
      deviceName: this.profile.name,
      host: this.host,
      httpOk: connected,
      controlOk: connected,
      message,
      deviceInfo: this.credentials ? { deviceName: this.profile.name, ssid: this.credentials.ssid, rawStrings: [] } : { deviceName: this.profile.name, rawStrings: [] },
    }
    return {
      ...base,
      mode: 'wireless',
      connected,
      sourceId: `dji:${this.profile.id}:${this.host}`,
      capabilities: {
        list: true,
        preview: true,
        copyToLocal: true,
        create: false,
        update: false,
        delete: false,
        watch: true,
        connection: this.wirelessPreparation.capabilities,
      },
    }
  }
}

const djiSessions = new Map<string, DjiCameraSession>()

async function installIdentity(): Promise<string> {
  const settings = await getSettings()
  if (settings.djiInstallIdentity) return settings.djiInstallIdentity
  const identity = newInstallIdentity()
  await saveSettings({ djiInstallIdentity: identity })
  return identity
}

export async function djiSessionFor(deviceId: string, host: string): Promise<DjiCameraSession> {
  const key = `${deviceId}:${host}`
  const existing = djiSessions.get(key)
  if (existing) return existing
  const session = new DjiCameraSession(deviceId, host, await installIdentity())
  djiSessions.set(key, session)
  return session
}

export async function disconnectDjiSession(deviceId: string, host: string): Promise<void> {
  const key = `${deviceId}:${host}`
  const session = djiSessions.get(key)
  djiSessions.delete(key)
  if (session) await session.close()
}
