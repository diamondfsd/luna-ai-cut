import type { HtmlItem } from '@freecut/types/timeline'

export interface HtmlFrameRequest {
  item: HtmlItem
  width: number
  height: number
  timeMs: number
}

export type HtmlFrameProvider = (request: HtmlFrameRequest) => Promise<ImageBitmap | null>

let activeHtmlFrameProvider: HtmlFrameProvider | undefined

export function setHtmlFrameProvider(provider: HtmlFrameProvider | undefined): void {
  activeHtmlFrameProvider = provider
}

export function getHtmlFrameProvider(): HtmlFrameProvider | undefined {
  return activeHtmlFrameProvider
}
