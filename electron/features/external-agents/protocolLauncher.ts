/** URLs come from trusted adapters, never from renderer requests. */
export function createProtocolLauncher(
  url: string,
  host: {
    getApplicationNameForProtocol(url: string): string
    openExternal(url: string): Promise<void>
  },
) {
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^https?:/i.test(url)) {
    throw new Error('应用协议无效')
  }
  const isRegistered = (): boolean => {
    try { return Boolean(host.getApplicationNameForProtocol(url).trim()) }
    catch { return false }
  }
  return {
    isRegistered,
    open: async (): Promise<boolean> => {
      if (!isRegistered()) return false
      await host.openExternal(url)
      return true
    },
  }
}
