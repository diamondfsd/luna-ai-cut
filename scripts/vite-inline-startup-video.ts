import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

export function inlineStartupVideo(): Plugin {
  return {
    name: 'inline-startup-video',
    enforce: 'pre',
    load(id) {
      if (!id.replace(/\\/g, '/').endsWith('/startup-animation/start-page.mp4?inline')) return null
      const video = readFileSync(id.slice(0, -'?inline'.length))
      return `export default ${JSON.stringify(`data:video/mp4;base64,${video.toString('base64')}`)}`
    },
  }
}
