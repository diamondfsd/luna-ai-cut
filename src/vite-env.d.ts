/// <reference types="vite/client" />

import type { LunaApi, WifiDebugApi, GoUltraDebugApi } from './shared/types'

declare global {
  const __APP_VERSION__: string

  interface Window {
    luna: LunaApi
    wifiDebug: WifiDebugApi
    goUltraDebug: GoUltraDebugApi
  }
}
