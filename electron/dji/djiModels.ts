export type DjiModelId = 'pocket4' | 'pocket4pro'

export interface DjiModelProfile {
  id: DjiModelId
  deviceId: string
  name: string
  modelNumber: number
  productType: number | null
  advertisement: Buffer
  localName: string
  udpPort: number
  tcpPort: number
  httpPort: number
  mockUdpPort: number
  mockTcpPort: number
  mockHttpPort: number
  storageIds: string[]
}

const POCKET_4_ADVERT = Buffer.from('210000be0000ee8dd9a000000000', 'hex')
const POCKET_4_PRO_ADVERT = Buffer.from('000000ee0004bd6e5620da000010', 'hex')

export const DJI_MODEL_PROFILES: Record<DjiModelId, DjiModelProfile> = {
  pocket4: {
    id: 'pocket4', deviceId: 'dji-pocket-4', name: 'Osmo Pocket 4', modelNumber: 0x21,
    productType: null, advertisement: POCKET_4_ADVERT, localName: 'OsmoPocket4-ACPT',
    udpPort: 9004, tcpPort: 7001, httpPort: 80, mockUdpPort: 19004, mockTcpPort: 17001, mockHttpPort: 18080,
    storageIds: ['sdcard', 'storage_internal'],
  },
  pocket4pro: {
    id: 'pocket4pro', deviceId: 'dji-pocket-4-pro', name: 'Osmo Pocket 4 Pro', modelNumber: 0x22,
    productType: 218, advertisement: POCKET_4_PRO_ADVERT, localName: 'OsmoPocket4P-6E55',
    udpPort: 9004, tcpPort: 7001, httpPort: 80, mockUdpPort: 19004, mockTcpPort: 17001, mockHttpPort: 18080,
    storageIds: ['sdcard', 'storage_internal'],
  },
}

export function djiProfileForDevice(deviceId?: string): DjiModelProfile {
  return deviceId === 'dji-pocket-4-pro' ? DJI_MODEL_PROFILES.pocket4pro : DJI_MODEL_PROFILES.pocket4
}

export function djiProfileForModel(model: DjiModelId | undefined): DjiModelProfile {
  return model === 'pocket4pro' ? DJI_MODEL_PROFILES.pocket4pro : DJI_MODEL_PROFILES.pocket4
}

export interface DjiAdvertisement {
  companyId: number
  modelNumber: number | null
  productType: number | null
  newFormat: boolean
  payload: Buffer
}

/** Mirrors Osmosis BleAdvert: Pocket 4 Pro stores product type at payload[10:12]. */
export function decodeDjiAdvertisement(payload: Uint8Array): DjiAdvertisement {
  const bytes = Buffer.from(payload)
  const newFormat = bytes.length > 5 && (bytes[5] & 0x04) !== 0 && bytes.length >= 12
  const productType = newFormat ? bytes.readUInt16LE(10) : null
  const modelNumber = newFormat
    ? productType === 218 ? 0x22 : productType === 219 ? 0x21 : null
    : bytes.length >= 2 && bytes.readUInt16LE(0) !== 0 ? bytes.readUInt16LE(0) : null
  return { companyId: 0x08aa, modelNumber, productType, newFormat, payload: bytes }
}

