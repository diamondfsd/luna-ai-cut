export interface HtmlRenderRequest {
  html: string
  css: string
  width: number
  height: number
  timeMs: number
}

export interface HtmlRenderResult {
  png: ArrayBuffer
  width: number
  height: number
  warnings: string[]
}

export interface HtmlRenderApi {
  render(request: HtmlRenderRequest): Promise<HtmlRenderResult>
}
