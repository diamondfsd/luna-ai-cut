export type DjiModelId = 'pocket3' | 'pocket4' | 'pocket4pro' | 'action5pro'

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
  playback: 'standard' | 'pocket3'
  ble: {
    namePrefixes: string[]
    excludedNamePrefixes: string[]
    serviceUuid: string
    writeCharacteristicUuid: string
    notifyCharacteristicUuid: string
  }
}

const POCKET_4_ADVERT = Buffer.from('210000be0000ee8dd9a000000000', 'hex')
const POCKET_4_PRO_ADVERT = Buffer.from('000000ee0004bd6e5620da000010', 'hex')
const POCKET_3_ADVERT = Buffer.from('2000', 'hex')
const ACTION_5_PRO_ADVERT = Buffer.from('1500', 'hex')

export const DJI_MODEL_PROFILES: Record<DjiModelId, DjiModelProfile> = {
  pocket3: {
    id: 'pocket3', deviceId: 'dji-pocket-3', name: 'Osmo Pocket 3', modelNumber: 0x20,
    productType: null, advertisement: POCKET_3_ADVERT, localName: 'OsmoPocket3',
    udpPort: 9004, tcpPort: 7001, httpPort: 80, mockUdpPort: 19006, mockTcpPort: 17004, mockHttpPort: 18084,
    storageIds: ['sdcard'], playback: 'pocket3',
    ble: {
      namePrefixes: ['OsmoPocket3'], excludedNamePrefixes: [],
      serviceUuid: '0000fff0-0000-1000-8000-00805f9b34fb',
      writeCharacteristicUuid: '0000fff5-0000-1000-8000-00805f9b34fb',
      notifyCharacteristicUuid: '0000fff4-0000-1000-8000-00805f9b34fb',
    },
  },
  pocket4: {
    id: 'pocket4', deviceId: 'dji-pocket-4', name: 'Osmo Pocket 4', modelNumber: 0x21,
    productType: null, advertisement: POCKET_4_ADVERT, localName: 'OsmoPocket4-ACPT',
    udpPort: 9004, tcpPort: 7001, httpPort: 80, mockUdpPort: 19004, mockTcpPort: 17002, mockHttpPort: 18082,
    storageIds: ['sdcard', 'storage_internal'], playback: 'standard',
    ble: {
      namePrefixes: ['OsmoPocket4'], excludedNamePrefixes: ['OsmoPocket4P'],
      serviceUuid: '0000fff0-0000-1000-8000-00805f9b34fb',
      writeCharacteristicUuid: '0000fff5-0000-1000-8000-00805f9b34fb',
      notifyCharacteristicUuid: '0000fff4-0000-1000-8000-00805f9b34fb',
    },
  },
  pocket4pro: {
    id: 'pocket4pro', deviceId: 'dji-pocket-4-pro', name: 'Osmo Pocket 4P', modelNumber: 0x22,
    productType: 218, advertisement: POCKET_4_PRO_ADVERT, localName: 'OsmoPocket4P-6E55',
    udpPort: 9004, tcpPort: 7001, httpPort: 80, mockUdpPort: 19005, mockTcpPort: 17003, mockHttpPort: 18083,
    storageIds: ['sdcard', 'storage_internal'], playback: 'standard',
    ble: {
      namePrefixes: ['OsmoPocket4P'], excludedNamePrefixes: [],
      serviceUuid: '0000fff0-0000-1000-8000-00805f9b34fb',
      writeCharacteristicUuid: '0000fff5-0000-1000-8000-00805f9b34fb',
      notifyCharacteristicUuid: '0000fff4-0000-1000-8000-00805f9b34fb',
    },
  },
  action5pro: {
    id: 'action5pro', deviceId: 'dji-action-5-pro', name: 'Osmo Action 5 Pro', modelNumber: 0x15,
    productType: 235, advertisement: ACTION_5_PRO_ADVERT, localName: 'OsmoAction5Pro',
    udpPort: 9004, tcpPort: 7001, httpPort: 80, mockUdpPort: 19007, mockTcpPort: 17005, mockHttpPort: 18085,
    storageIds: ['sdcard', 'storage_internal'], playback: 'standard',
    ble: {
      namePrefixes: ['OsmoAction5Pro'], excludedNamePrefixes: [],
      serviceUuid: '0000fff0-0000-1000-8000-00805f9b34fb',
      writeCharacteristicUuid: '0000fff5-0000-1000-8000-00805f9b34fb',
      notifyCharacteristicUuid: '0000fff4-0000-1000-8000-00805f9b34fb',
    },
  },
}

export function djiProfileForDevice(deviceId?: string): DjiModelProfile {
  if (deviceId === 'dji-pocket-3') return DJI_MODEL_PROFILES.pocket3
  if (deviceId === 'dji-action-5-pro') return DJI_MODEL_PROFILES.action5pro
  return deviceId === 'dji-pocket-4-pro' ? DJI_MODEL_PROFILES.pocket4pro : DJI_MODEL_PROFILES.pocket4
}

export function djiProfileForModel(model: DjiModelId | undefined): DjiModelProfile {
  if (model === 'pocket3') return DJI_MODEL_PROFILES.pocket3
  if (model === 'action5pro') return DJI_MODEL_PROFILES.action5pro
  return model === 'pocket4pro' ? DJI_MODEL_PROFILES.pocket4pro : DJI_MODEL_PROFILES.pocket4
}

export interface DjiAdvertisement {
  companyId: number
  modelNumber: number | null
  productType: number | null
  newFormat: boolean
  payload: Buffer
}

/** Mirrors Osmosis BleAdvert: newer DJI cameras store product type at payload[10:12]. */
export function decodeDjiAdvertisement(payload: Uint8Array): DjiAdvertisement {
  const bytes = Buffer.from(payload)
  const newFormat = bytes.length > 5 && (bytes[5] & 0x04) !== 0 && bytes.length >= 12
  const productType = newFormat ? bytes.readUInt16LE(10) : null
  const modelNumber = newFormat
    ? productType === 145 ? 0x20 : productType === 218 ? 0x22 : productType === 219 ? 0x21 : productType === 235 ? 0x15 : null
    : bytes.length >= 2 && bytes.readUInt16LE(0) !== 0 ? bytes.readUInt16LE(0) : null
  return { companyId: 0x08aa, modelNumber, productType, newFormat, payload: bytes }
}
