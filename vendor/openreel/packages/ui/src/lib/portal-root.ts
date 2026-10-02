export function editorPortalContainer(): HTMLElement | undefined {
  return (globalThis as typeof globalThis & { __lunaOpenreelRoot?: HTMLElement }).__lunaOpenreelRoot
}
