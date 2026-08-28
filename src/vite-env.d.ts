/// <reference types="vite/client" />

import type { DeviceDebugApi, LunaApi, WifiDebugApi } from './shared/types'

declare global {
  const __APP_VERSION__: string
  const __DEBUG_STANDALONE__: boolean | undefined

  interface Window {
    luna: LunaApi
    wifiDebug: WifiDebugApi
    deviceDebug: DeviceDebugApi
  }
}
