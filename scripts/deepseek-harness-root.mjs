import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Resolve the standalone DeepSeek Harness checkout used by Luna.
 *
 * The local checkout normally lives beside the Luna repositories. The
 * environment override keeps CI, packaged builds, and other worktree layouts
 * explicit without coupling the application to one developer's home path.
 */
export function resolveDeepSeekHarnessRoot(repoRoot) {
  const configured = process.env.LUNA_DEEPSEEK_HARNESS_ROOT?.trim()
  const candidates = [
    configured,
    join(repoRoot, 'vendor/deepseek-harness'),
  ].filter(Boolean)

  return candidates.find((candidate) => existsSync(join(candidate, 'package.json'))) ?? null
}
