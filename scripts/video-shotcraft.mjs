import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

// The skill source is vendored beside DeepSeek Harness and is copied into the
// packaged runtime during the normal application build. Keep this commit in
// source control so the prompt and demo assets change together.
export const VIDEO_SHOTCRAFT_COMMIT = '0d6f0b57f0d4d6700761644c07f7ef03c3e50234'
export const VIDEO_SHOTCRAFT_VENDOR_PATH = 'vendor/video-shotcraft'

/**
 * Check whether a directory contains the vendored skill entry point.
 *
 * @param {string} directory Candidate skill directory.
 * @returns {boolean} Whether the candidate contains SKILL.md.
 */
export function isVideoShotcraftRoot(directory) {
  return typeof directory === 'string' && existsSync(join(directory, 'SKILL.md'))
}

/**
 * Resolve the local skill source or the copied packaged runtime resource.
 * No network or user-provided directory is consulted at runtime.
 *
 * @param {string} repoRoot Application source or runtime parent directory.
 * @param {string | undefined} packagedRoot Runtime directory copied into the bundle.
 * @returns {string | undefined} First valid local bundle directory.
 */
export function resolveVideoShotcraftRoot(repoRoot, packagedRoot) {
  const candidates = [
    packagedRoot,
    join(resolve(repoRoot), VIDEO_SHOTCRAFT_VENDOR_PATH),
  ].filter(Boolean)
  return candidates.find(isVideoShotcraftRoot)
}
