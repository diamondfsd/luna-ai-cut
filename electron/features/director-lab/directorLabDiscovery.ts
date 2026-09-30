import * as dgram from 'node:dgram'
import * as http from 'node:http'
import { networkInterfaces } from 'node:os'

import type {
  DirectorLabDiscoveredService,
  DirectorLabDiscoveryResult,
} from '../../../src/shared/types'

const SERVICE_NAME = 'luna-ka-director'
const DISCOVERY_PORT = 47822
const HTTP_PORT = 47821
const DISCOVERY_REQUEST = 'luna-ka-director.discover.v1'
const DISCOVERY_TIMEOUT_MS = 1_200
const SUBNET_SCAN_TIMEOUT_MS = 280
const SUBNET_SCAN_CONCURRENCY = 48

interface Ipv4Network {
  address: string
  broadcast: string
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
      })
    }
  }
  return [...networks.values()]
}

function parsePayload(value: Buffer): DiscoveryPayload | null {
  try {
    const payload = JSON.parse(value.toString('utf8')) as DiscoveryPayload
    return payload?.service === SERVICE_NAME ? payload : null
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
    let finished = false

    const finish = (): void => {
      if (finished) return
      finished = true
      if (timer) clearTimeout(timer)
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
    socket.on('error', finish)
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true)
        const targets = new Set(['255.255.255.255', ...localNetworks().map((network) => network.broadcast)])
        for (const target of targets) {
          socket.send(DISCOVERY_REQUEST, DISCOVERY_PORT, target)
        }
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
          resolve(payload.service === SERVICE_NAME
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
    const parts = network.address.split('.')
    if (parts.length !== 4) continue
    const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`
    for (let host = 1; host <= 254; host += 1) {
      const candidate = `${prefix}.${host}`
      if (!ownAddresses.has(candidate)) hosts.add(candidate)
    }
  }

  const candidates = [...hosts]
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

  const subnet = await scanSubnets()
  return {
    services: subnet.services.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    udpResponderCount: 0,
    scannedHostCount: subnet.scannedHostCount,
  }
}
