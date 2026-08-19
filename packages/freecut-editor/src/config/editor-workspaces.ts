import { EDITOR_LAYOUT } from './editor-layout'

/**
 * Editor workspaces (DaVinci-style pages): named layout presets that
 * rearrange existing panels for a task. Switching workspaces never changes
 * project state — only which panels are visible and which tabs are active.
 *
 * Presets are starting points, not locks: the user can still toggle any
 * panel inside a workspace, and their per-workspace tweaks are persisted
 * by the editor store (`editor:workspaceLayout:<id>` in localStorage).
 */
export type EditorWorkspaceId = 'edit' | 'color' | 'motion'

export type EditorSidebarTab =
  | 'media'
  | 'audio'
  | 'text'
  | 'shapes'
  | 'effects'
  | 'transitions'
  | 'lottie'
  | 'transcript'
  | 'ai'
export type EditorClipInspectorTab = 'video' | 'motion' | 'audio' | 'effects'

/** The slice of editor UI state that a workspace controls. */
export interface EditorWorkspaceLayout {
  schemaVersion: number
  colorScopesOpen: boolean
  clipInspectorTab: EditorClipInspectorTab
  activeTab: EditorSidebarTab
  propertiesFullColumn: boolean
  mediaFullColumn: boolean
  sidebarWidth: number
  rightSidebarWidth: number
}

export const EDITOR_WORKSPACE_LAYOUT_SCHEMA_VERSION = 2

const EDITOR_WORKSPACE_PRESETS: Record<EditorWorkspaceId, EditorWorkspaceLayout> = {
  edit: {
    schemaVersion: EDITOR_WORKSPACE_LAYOUT_SCHEMA_VERSION,
    colorScopesOpen: false,
    clipInspectorTab: 'video',
    activeTab: 'media',
    propertiesFullColumn: false,
    mediaFullColumn: false,
    sidebarWidth: EDITOR_LAYOUT.leftSidebarDefaultWidth,
    rightSidebarWidth: EDITOR_LAYOUT.rightSidebarDefaultWidth,
  },
  color: {
    schemaVersion: EDITOR_WORKSPACE_LAYOUT_SCHEMA_VERSION,
    colorScopesOpen: true,
    clipInspectorTab: 'effects',
    activeTab: 'effects',
    // The grade panel stacks wheels + curves + the effect list — give it
    // the full column height by default.
    propertiesFullColumn: true,
    mediaFullColumn: true,
    sidebarWidth: EDITOR_LAYOUT.leftSidebarDefaultWidth,
    rightSidebarWidth: EDITOR_LAYOUT.rightSidebarDefaultWidth,
  },
  motion: {
    schemaVersion: EDITOR_WORKSPACE_LAYOUT_SCHEMA_VERSION,
    colorScopesOpen: false,
    clipInspectorTab: 'video',
    activeTab: 'media',
    propertiesFullColumn: false,
    mediaFullColumn: true,
    sidebarWidth: EDITOR_LAYOUT.leftSidebarDefaultWidth,
    rightSidebarWidth: EDITOR_LAYOUT.rightSidebarDefaultWidth,
  },
}

/**
 * Timeline split (percent of vertical space) a workspace starts with.
 * `null` means "use the density preset default" — grading navigates clips
 * rather than editing them, so the color workspace shrinks the timeline.
 */
export const EDITOR_WORKSPACE_TIMELINE_SIZE: Record<EditorWorkspaceId, number | null> = {
  edit: 36,
  color: 18,
  // Keep Motion's established split while Edit adopts the larger timeline.
  motion: 28,
}

const DEFAULT_EDITOR_WORKSPACE: EditorWorkspaceId = 'edit'

export function normalizeEditorWorkspaceId(value: unknown): EditorWorkspaceId {
  if (value === 'color') return 'color'
  // Animate and Compose were separate historical surfaces. Both now migrate
  // into the single Motion workspace so persisted sessions cannot reopen the
  // disconnected legacy editor.
  if (value === 'animate' || value === 'motion' || value === 'compose') return 'motion'
  return DEFAULT_EDITOR_WORKSPACE
}

const SIDEBAR_TABS: readonly EditorSidebarTab[] = [
  'media',
  'audio',
  'text',
  'shapes',
  'effects',
  'transitions',
  'lottie',
  'transcript',
  'ai',
]
const CLIP_INSPECTOR_TABS: readonly EditorClipInspectorTab[] = [
  'video',
  'motion',
  'audio',
  'effects',
]

function isSidebarTab(value: unknown): value is EditorSidebarTab {
  return SIDEBAR_TABS.includes(value as EditorSidebarTab)
}

function isClipInspectorTab(value: unknown): value is EditorClipInspectorTab {
  return CLIP_INSPECTOR_TABS.includes(value as EditorClipInspectorTab)
}

/** Validate a persisted workspace layout, falling back per-field to the preset. */
export function normalizeEditorWorkspaceLayout(
  value: unknown,
  workspace: EditorWorkspaceId,
): EditorWorkspaceLayout {
  const preset = EDITOR_WORKSPACE_PRESETS[workspace]
  if (!value || typeof value !== 'object') return preset
  const candidate = value as Partial<Record<keyof EditorWorkspaceLayout, unknown>>

  return {
    schemaVersion: EDITOR_WORKSPACE_LAYOUT_SCHEMA_VERSION,
    colorScopesOpen:
      typeof candidate.colorScopesOpen === 'boolean'
        ? candidate.colorScopesOpen
        : preset.colorScopesOpen,
    clipInspectorTab: isClipInspectorTab(candidate.clipInspectorTab)
      ? candidate.clipInspectorTab
      : preset.clipInspectorTab,
    activeTab: isSidebarTab(candidate.activeTab) ? candidate.activeTab : preset.activeTab,
    propertiesFullColumn:
      typeof candidate.propertiesFullColumn === 'boolean'
        ? candidate.propertiesFullColumn
        : preset.propertiesFullColumn,
    mediaFullColumn:
      typeof candidate.mediaFullColumn === 'boolean'
        ? candidate.mediaFullColumn
        : preset.mediaFullColumn,
    sidebarWidth:
      typeof candidate.sidebarWidth === 'number' && Number.isFinite(candidate.sidebarWidth)
        ? candidate.sidebarWidth
        : preset.sidebarWidth,
    rightSidebarWidth:
      typeof candidate.rightSidebarWidth === 'number' && Number.isFinite(candidate.rightSidebarWidth)
        ? candidate.rightSidebarWidth
        : preset.rightSidebarWidth,
  }
}
