export type LunaBuildChannel = 'stable' | 'test'

declare const __LUNA_BUILD_CHANNEL__: string | undefined

/** The installer channel is replaced by Vite; source-only scripts use stable. */
export const LUNA_BUILD_CHANNEL: LunaBuildChannel = typeof __LUNA_BUILD_CHANNEL__ === 'string'
  && __LUNA_BUILD_CHANNEL__ === 'test'
  ? 'test'
  : 'stable'

export const isTestBuild = LUNA_BUILD_CHANNEL === 'test'
