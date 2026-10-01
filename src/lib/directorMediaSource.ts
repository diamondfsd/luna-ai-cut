export function directorPreviewPath(source: string): string {
  if (!source.startsWith('file:')) return source
  const url = new URL(source)
  const pathname = decodeURIComponent(url.pathname)
  if (url.hostname) return `//${url.hostname}${pathname}`
  return /^\/[a-z]:\//i.test(pathname) ? pathname.slice(1) : pathname
}
