import OpenCC from 'opencc-js/t2cn'

let traditionalToSimplified: ((text: string) => string) | null = null

export function simplifyChineseText(text: string): string {
  traditionalToSimplified ??= OpenCC.Converter({ from: 't', to: 'cn' })
  return traditionalToSimplified(text)
}
