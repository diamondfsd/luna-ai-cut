import type { NasSyncSettings } from './types/settings'

export const DEFAULT_NAS_DEBUG_CONFIG: NasSyncSettings = {
  enabled: true,
  autoSync: true,
  server: '127.0.0.1',
  port: 1445,
  share: 'lunaaicut',
  remotePath: '/',
  username: 'demo',
  password: 'demo',
  concurrency: 3,
}
