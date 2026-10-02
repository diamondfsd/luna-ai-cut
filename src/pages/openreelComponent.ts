export interface OpenReelComponent {
  setActive(active: boolean): void
  openProject(projectId?: string): void
  dispose(): void
}
interface EmbeddedModule {
  styles: string[]
  mount(element: HTMLElement): OpenReelComponent
}
let loading: Promise<EmbeddedModule> | null = null

export function loadOpenReelComponent(): Promise<EmbeddedModule> {
  if (loading) return loading
  loading = (async () => {
    const base = new URL('./ai-editor/', window.location.href)
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = new URL('luna-openreel-bridge.js', base).href
      script.onload = () => resolve()
      script.onerror = () => { script.remove(); reject(new Error('打开失败')) }
      document.head.appendChild(script)
    })
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = new URL('luna-openreel-locale.js', base).href
      script.onload = () => resolve()
      script.onerror = () => { script.remove(); reject(new Error('打开失败')) }
      document.head.appendChild(script)
    })
    const moduleUrl = new URL('embedded-loader.js', base).href
    const module: EmbeddedModule = await import(/* @vite-ignore */ moduleUrl)
    await Promise.all(module.styles.map(file => new Promise<void>((resolve, reject) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = new URL(file, base).href
      link.onload = () => resolve()
      link.onerror = () => { link.remove(); reject(new Error('打开失败')) }
      document.head.appendChild(link)
    })))
    return module
  })().catch(error => { loading = null; throw error })
  return loading
}
