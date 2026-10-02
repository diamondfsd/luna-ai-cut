let root: HTMLElement | null = null
let hash = '#/projects'

export function setEmbeddedRoot(element: HTMLElement | null): void { root = element }
export function editorRoot(): HTMLElement { return root ?? (globalThis as typeof globalThis & { __lunaOpenreelRoot?: HTMLElement }).__lunaOpenreelRoot ?? document.documentElement }
export function editorPortalRoot(): HTMLElement { return root ?? document.body }
export function editorHash(): string { return root ? hash : window.location.hash }
export function setEditorHash(value: string): void {
  if (!root) { window.location.hash = value; return }
  hash = value
  window.dispatchEvent(new Event('luna-openreel-route'))
}
export function editorRouteEvent(): string { return root ? 'luna-openreel-route' : 'hashchange' }

export function editorOwnsKeyEvent(event: KeyboardEvent): boolean {
  return !root || (event.target instanceof Node && root.contains(event.target) && root.getClientRects().length > 0)
}
