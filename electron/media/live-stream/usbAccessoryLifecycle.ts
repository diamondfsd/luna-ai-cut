export interface UsbAccessoryShutdownOperations {
  stopPolling: () => Promise<void>
  waitForControlWrites: () => Promise<void>
  releaseInterface: () => Promise<void>
  closeDevice: () => void
}

export function createUsbAccessoryShutdown(operations: UsbAccessoryShutdownOperations): () => Promise<void> {
  let shutdownTask: Promise<void> | null = null
  return () => {
    if (shutdownTask) return shutdownTask
    shutdownTask = (async () => {
      try { await operations.stopPolling() } catch { /* Continue releasing the device. */ }
      try { await operations.waitForControlWrites() } catch { /* Continue releasing the device. */ }
      try { await operations.releaseInterface() } catch { /* Close even after a release failure. */ }
      try { operations.closeDevice() } catch { /* Device may already be gone. */ }
    })()
    return shutdownTask
  }
}
