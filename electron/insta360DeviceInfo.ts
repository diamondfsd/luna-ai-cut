export interface Insta360TcpDeviceInfo {
  serial?: string
  deviceName?: string
  firmware?: string
  ssid?: string
  wifiPassword?: string
  rawStrings: string[]
}

export function extractAsciiStrings(data: Buffer): string[] {
  const strings: string[] = []
  let current = ''
  for (const byte of data) {
    if (byte >= 0x20 && byte <= 0x7e) current += String.fromCharCode(byte)
    else {
      if (current.length >= 4) strings.push(current)
      current = ''
    }
  }
  if (current.length >= 4) strings.push(current)
  return strings
}

export function parseDeviceInfo(responses: Array<{ body: Buffer }>): Insta360TcpDeviceInfo | null {
  const rawStrings = [...new Set(responses.flatMap((response) => extractAsciiStrings(response.body)))]
  if (rawStrings.length === 0) return null
  const deviceName = rawStrings.find((text) => /Insta360|Luna|Ultra|GO Ultra/i.test(text))
  const serial = rawStrings.find((text) => /^[A-Z0-9]{8,}$/.test(text) && !text.includes(' '))
  const firmware = rawStrings.find((text) => /^v?\d+\.\d+\.\d+/.test(text))
  const ssid = rawStrings.find((text) => /Luna|Ultra|\.OSC|GO/i.test(text) && text !== deviceName)
  const wifiPassword = rawStrings.find((text) => /^[A-Z0-9]{8}$/.test(text) && text !== serial)
  return { serial, deviceName, firmware, ssid, wifiPassword, rawStrings }
}
