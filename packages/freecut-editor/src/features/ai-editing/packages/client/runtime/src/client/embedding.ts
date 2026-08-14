/** Browser markers supplied by the FreeCut host for the embedded Harness view. */
const EMBEDDED_MODE_ATTRIBUTE = 'data-luna-freecut'
const PROJECT_PATH_ATTRIBUTE = 'data-luna-freecut-cwd'

/**
 * Return whether the Harness is running inside the FreeCut AI dock.
 * @returns true for the FreeCut-embedded WebUI, otherwise false.
 */
export function isLunaFreeCutEmbedded(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.hasAttribute(EMBEDDED_MODE_ATTRIBUTE)
}

/**
 * Read the project directory selected by the FreeCut host.
 * @returns the canonical project directory, or undefined outside the embedded view.
 */
export function lunaFreeCutProjectPath(): string | undefined {
  if (!isLunaFreeCutEmbedded()) return undefined
  const path = document.documentElement.getAttribute(PROJECT_PATH_ATTRIBUTE)
  return path === null || path === '' ? undefined : path
}
