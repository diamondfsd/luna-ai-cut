import { isIP } from 'node:net'

const MAX_BROWSER_URL_LENGTH = 2_048

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true
  }
  const [first, second] = octets
  return first === 0 || first === 10 || first === 127 || first === 169 && second === 254
    || first === 172 && second >= 16 && second <= 31
    || first === 192 && second === 168
    || first === 100 && second >= 64 && second <= 127
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%', 1)[0]
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8')
    || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
    return true
  }
  if (normalized.startsWith('::ffff:')) return isPrivateIpv4(normalized.slice('::ffff:'.length))
  return false
}

export function isPrivateIpAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isPrivateIpv4(address)
  if (version === 6) return isPrivateIpv6(address)
  return true
}

export function isBlockedBrowserHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '')
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.local')
    || normalized === 'broadcasthost'
    || (isIP(normalized) > 0 && isPrivateIpAddress(normalized))
}

export function validateBrowserUrl(input: string): URL {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_BROWSER_URL_LENGTH) {
    throw new Error('浏览器只接受长度不超过 2048 个字符的网址。')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error('浏览器网址格式无效。')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('浏览器只允许打开 HTTP 或 HTTPS 网页。')
  }
  if (url.username || url.password) throw new Error('浏览器网址不能包含登录凭据。')
  if (!url.hostname || isBlockedBrowserHostname(url.hostname)) {
    throw new Error('浏览器不能访问本机、局域网或其他内部地址。')
  }
  return url
}

export function isAllowedBrowserRequestUrl(input: string): boolean {
  if (input === 'about:blank' || input.startsWith('data:') || input.startsWith('blob:')) return true
  try {
    const url = validateBrowserUrl(input)
    return !isBlockedBrowserHostname(url.hostname)
  } catch {
    return false
  }
}
