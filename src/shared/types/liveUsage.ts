export type LiveUsageFeature = 'watermark' | 'lut' | 'color' | 'control'

export type LiveUsageMessage =
  | { kind: 'frame'; session: string }
  | { kind: 'snapshot'; session: string; frameRecent: boolean; watermark: boolean; lut: boolean; color: boolean }
  | { kind: 'opened' | 'changed'; session: string; feature: LiveUsageFeature }

export type LiveUsageProperties = Record<string, string | number | boolean | null>
