import * as dgram from 'node:dgram'
import * as http from 'node:http'
import { networkInterfaces } from 'node:os'

import type {
  DirectorLabDiscoveredService,
  DirectorLabDiscoveryResult,
} from '../../../src/shared/types'

const SERVICE_NAMES = new Set(['luna-ka-api', 'luna-ka-director'])
const DISCOVERY_PORT = 47822
const HTTP_PORT = 47821
const DISCOVERY_REQUEST = 'luna-ka-api.discover.v1'
const LEGACY_DISCOVERY_REQUEST = 'luna-ka-director.discover.v1'
const DISCOVERY_TIMEOUT_MS = 1_800
const DISCOVERY_RETRY_INTERVAL_MS = 350
const SUBNET_SCAN_TIMEOUT_MS = 800
const SUBNET_SCAN_CONCURRENCY = 48
const SUBNET_SCAN_MAX_HOSTS = 4_096

interface Ipv4Network {
  address: string
  broadcast: string
  netmask: string
}

interface DiscoveryPayload {
  service?: unknown
  api_version?: unknown
  name?: unknown
  port?: unknown
}

function ipv4ToInt(value: string): number | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  let result = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null
    result = (result << 8) | octet
  }
  return result >>> 0
}

function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.')
}

function localNetworks(): Ipv4Network[] {
  const networks = new Map<string, Ipv4Network>()
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || String(entry.family) !== 'IPv4') continue
      const address = ipv4ToInt(entry.address)
      const netmask = ipv4ToInt(entry.netmask)
      if (address == null || netmask == null || (address & 0xffff0000) === 0xa9fe0000) continue
      networks.set(entry.address, {
        address: entry.address,
        broadcast: intToIpv4((address | (~netmask >>> 0)) >>> 0),
        netmask: entry.netmask,
      })
    }
  }
  return [...networks.values()]
}

function parsePayload(value: Buffer): DiscoveryPayload | null {
  try {
    const payload = JSON.parse(value.toString('utf8')) as DiscoveryPayload
    return typeof payload?.service === 'string' && SERVICE_NAMES.has(payload.service)
      ? payload
      : null
  } catch {
    return null
  }
}

function serviceFromPayload(
  payload: DiscoveryPayload,
  host: string,
  discoveryMethod: DirectorLabDiscoveredService['discoveryMethod'],
): DirectorLabDiscoveredService | null {
  const port = typeof payload.port === 'number' ? payload.port : HTTP_PORT
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null
  return {
    id: `${host}:${port}`,
    name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : 'Luna咔',
    host,
    port,
    baseUrl: `http://${host}:${port}`,
    discoveryMethod,
  }
}

function discoverUdp(): Promise<DirectorLabDiscoveredService[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4')
    const services = new Map<string, DirectorLabDiscoveredService>()
    let timer: ReturnType<typeof setTimeout> | null = null
    let retryTimer: ReturnType<typeof setInterval> | null = null
    let finished = false
    let lastSocketError = ''

    const finish = (): void => {
      if (finished) return
      finished = true
      if (timer) clearTimeout(timer)
      if (retryTimer) clearInterval(retryTimer)
      try {
        socket.close()
      } catch {
        // The socket may not have reached the bound state if setup failed.
      }
      resolve([...services.values()])
    }

    socket.on('message', (message, remote) => {
      const payload = parsePayload(message)
      if (!payload) return
      const service = serviceFromPayload(payload, remote.address, 'udp')
      if (service) services.set(service.id, service)
    })
    socket.on('error', (error) => {
      const errorMessage = error.message
      if (errorMessage === lastSocketError) return
      lastSocketError = errorMessage
      console.warn('[director-lab] UDP discovery socket error', error)
    })
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true)
        const targets = new Set(['255.255.255.255', ...localNetworks().map((network) => network.broadcast)])
        console.info('[director-lab] sending UDP discovery', {
          targets: [...targets],
          retryIntervalMs: DISCOVERY_RETRY_INTERVAL_MS,
          timeoutMs: DISCOVERY_TIMEOUT_MS,
        })
        const sendDiscovery = (): void => {
          for (const target of targets) {
            for (const request of [DISCOVERY_REQUEST, LEGACY_DISCOVERY_REQUEST]) {
              try {
                socket.send(request, DISCOVERY_PORT, target)
              } catch (error) {
                console.warn('[director-lab] UDP discovery send failed', {
                  target,
                  error,
                })
              }
            }
          }
        }
        sendDiscovery()
        retryTimer = setInterval(sendDiscovery, DISCOVERY_RETRY_INTERVAL_MS)
        timer = setTimeout(finish, DISCOVERY_TIMEOUT_MS)
      } catch {
        finish()
      }
    })
  })
}

function checkService(host: string): Promise<DirectorLabDiscoveredService | null> {
  return new Promise((resolve) => {
    const request = http.get(`http://${host}:${HTTP_PORT}/health`, { timeout: SUBNET_SCAN_TIMEOUT_MS }, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        resolve(null)
        return
      }
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as DiscoveryPayload
          resolve(typeof payload.service === 'string' && SERVICE_NAMES.has(payload.service)
            ? serviceFromPayload({ ...payload, port: HTTP_PORT, name: 'Luna咔' }, host, 'subnet')
            : null)
        } catch {
          resolve(null)
        }
      })
    })
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolve(null))
  })
}

async function scanSubnets(): Promise<{ services: DirectorLabDiscoveredService[]; scannedHostCount: number }> {
  const interfaces = localNetworks()
  const ownAddresses = new Set(interfaces.map((network) => network.address))
  const hosts = new Set<string>()
  for (const network of interfaces) {
    const address = ipv4ToInt(network.address)
    const netmask = ipv4ToInt(network.netmask)
    const broadcast = ipv4ToInt(network.broadcast)
    if (address == null || netmask == null || broadcast == null) continue
    const firstHost = ((address & netmask) >>> 0) + 1
    const lastHost = broadcast - 1
    const hostCount = lastHost - firstHost + 1
    if (hostCount <= 0) continue

    const scanCount = Math.min(hostCount, SUBNET_SCAN_MAX_HOSTS)
    const scanStart = Math.max(
      firstHost,
      Math.min(address - Math.floor(scanCount / 2), lastHost - scanCount + 1),
    )
    for (let host = scanStart; host < scanStart + scanCount; host += 1) {
      const candidate = intToIpv4(host >>> 0)
      if (!ownAddresses.has(candidate)) hosts.add(candidate)
    }
  }

  const candidates = [...hosts]
  console.info('[director-lab] scanning local IPv4 ranges', {
    interfaces: interfaces.map(({ address, broadcast, netmask }) => ({ address, broadcast, netmask })),
    hostCount: candidates.length,
    timeoutPerHostMs: SUBNET_SCAN_TIMEOUT_MS,
  })
  const services = new Map<string, DirectorLabDiscoveredService>()
  let cursor = 0
  const workers = Array.from({ length: Math.min(SUBNET_SCAN_CONCURRENCY, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor]
      cursor += 1
      const service = await checkService(candidate)
      if (service) services.set(service.id, service)
    }
  })
  await Promise.all(workers)
  return { services: [...services.values()], scannedHostCount: candidates.length }
}

export async function discoverDirectorServices(): Promise<DirectorLabDiscoveryResult> {
  const udpServices = await discoverUdp()
  if (udpServices.length > 0) {
    return {
      services: udpServices.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
      udpResponderCount: udpServices.length,
      scannedHostCount: 0,
    }
  }

  console.info('[director-lab] UDP discovery found no responders; scanning local subnets')
  const subnet = await scanSubnets()
  console.info('[director-lab] subnet scan completed', {
    scannedHostCount: subnet.scannedHostCount,
    serviceCount: subnet.services.length,
  })
  return {
    services: subnet.services.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    udpResponderCount: 0,
    scannedHostCount: subnet.scannedHostCount,
  }
}
