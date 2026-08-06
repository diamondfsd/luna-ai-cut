/**
 * Luna mounts FreeCut under its own `/video-editor` HashRouter route while
 * FreeCut uses an isolated in-memory router. Every embedded FreeCut route can
 * access project storage, so the workspace gate must finish before its router
 * is mounted.
 */
export function usePathname(): string {
  return '/projects'
}
