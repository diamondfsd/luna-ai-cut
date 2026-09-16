const lifecycleEvents = new Set(['start', 'ready', 'stop'])
const warningEvents = new Set(['error', 'invalid', 'drop'])

export function configureMockLogging(server, verbose = false) {
  if (verbose) return
  const write = server.log.bind(server)
  const warnings = new Map()
  server.log = (event, details = {}) => {
    if (lifecycleEvents.has(event)) return write(event, details)
    if (!warningEvents.has(event) && !(event === 'command' && details.valid === false)) return
    // Repeated invalid traffic must not turn a protocol fault into a log flood.
    const now = Date.now()
    const previous = warnings.get(event)
    if (previous && now - previous.time < 5000) {
      previous.suppressed += 1
      return
    }
    warnings.set(event, { time: now, suppressed: 0 })
    write(event, { ...details, ...(previous?.suppressed ? { suppressed: previous.suppressed } : {}) })
  }
}
