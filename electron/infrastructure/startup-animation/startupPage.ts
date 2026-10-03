import videoUrl from './start-page.mp4?inline'
import styles from './startup-page.css?inline'

export function startupPage(failed = false): string {
  const title = failed ? 'Luna AI Cut 暂时无法启动' : 'Luna AI Cut'
  const content = failed
    ? `<main><h1>${title}</h1><p>请关闭应用后重试。若仍无法打开，请重新安装最新版。</p></main>`
    : `<video src="${videoUrl}" autoplay muted loop playsinline aria-label="Luna AI Cut 启动动画"></video><div class="startup-loading" role="status" aria-label="正在加载"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 9 9" /></svg></div>`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; media-src data:"><style>${styles}</style><title>${title}</title></head><body>${content}</body></html>`
}
