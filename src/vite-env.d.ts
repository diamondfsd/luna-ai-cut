/// <reference types="vite/client" />

import type { LunaApi, WifiDebugApi } from './shared/types'

declare global {
  const __APP_VERSION__: string

  interface Window {
    luna: LunaApi
    wifiDebug: WifiDebugApi
  }
}
