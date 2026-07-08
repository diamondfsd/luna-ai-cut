export function createHttpAuthGate(delayMs = 0) {
  const authorizedSockets = new Set()
  const pendingTimers = new Map()

  return {
    isAuthorized() {
      return authorizedSockets.size > 0
    },
    authorize(socket) {
      if (authorizedSockets.has(socket) || pendingTimers.has(socket)) return
      const timer = setTimeout(() => {
        pendingTimers.delete(socket)
        if (!socket.destroyed) authorizedSockets.add(socket)
      }, delayMs)
      pendingTimers.set(socket, timer)
    },
    revoke(socket) {
      const timer = pendingTimers.get(socket)
      if (timer) clearTimeout(timer)
      pendingTimers.delete(socket)
      authorizedSockets.delete(socket)
    },
  }
}
