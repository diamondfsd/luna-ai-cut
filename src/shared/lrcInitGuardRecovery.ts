export const LRC_INIT_GUARD_FILE = '.lrc-init-running.json'
export const LRC_INIT_RECOVERY_FILE = '.lrc-init-recovery-v2.json'

export function shouldRecoverLrcInitGuard(options: {
  packaged: boolean
  guardExists: boolean
  recoveryAttempted: boolean
}): boolean {
  return options.packaged && options.guardExists && !options.recoveryAttempted
}
