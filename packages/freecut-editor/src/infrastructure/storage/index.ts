/**
 * Storage barrel — re-exports the workspace-fs layer.
 *
 * All storage now lives in the app-managed or user-granted workspace folder via
 * `workspace-fs/*`. Legacy `video-editor-db` IndexedDB reads live under
 * `legacy-idb/` and are only touched by the one-time migration banner.
 */

// Projects
export {
  getAllProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  getDBStats,
} from '@freecut/infrastructure/storage/workspace-fs/projects'

// Media
export {
  getAllMedia,
  getAllMediaMetadata,
  getMedia,
  createMedia,
  updateMedia,
  deleteMedia,
  validateMediaHandle,
  type MediaHandleValidation,
} from '@freecut/infrastructure/storage/workspace-fs/media'

// Thumbnails
export {
  saveThumbnail,
  getThumbnailByMediaId,
  getThumbnailsByMediaIds,
  deleteThumbnailsByMediaId,
  saveProjectThumbnail,
  loadProjectThumbnail,
} from '@freecut/infrastructure/storage/workspace-fs/thumbnails'

// Content-addressable blob references
export {
  incrementContentRef,
  decrementContentRef,
  deleteContent,
} from '@freecut/infrastructure/storage/workspace-fs/content'

// Project-media associations
export {
  associateMediaWithProject,
  removeMediaFromProject,
  removeMediaBatchFromProject,
  getProjectMediaIds,
  getProjectsUsingMedia,
  getMediaForProject,
} from '@freecut/infrastructure/storage/workspace-fs/project-media'

// Waveforms
export {
  getWaveform,
  getWaveformRecord,
  getWaveformMeta,
  getWaveformBins,
  saveWaveformMeta,
  saveWaveformBin,
  deleteWaveform,
} from '@freecut/infrastructure/storage/workspace-fs/waveforms'

// GIF frames
export {
  saveGifFrames,
  getGifFrames,
  deleteGifFrames,
  clearAllGifFrames,
} from '@freecut/infrastructure/storage/workspace-fs/gif-frames'

// Decoded preview audio
export {
  getDecodedPreviewAudio,
  saveDecodedPreviewAudio,
  deleteDecodedPreviewAudio,
} from '@freecut/infrastructure/storage/workspace-fs/decoded-preview-audio'

// Transcripts
export {
  getTranscript,
  getTranscriptMediaIds,
  saveTranscript,
  deleteTranscript,
} from '@freecut/infrastructure/storage/workspace-fs/transcripts'

// AI captions (vision-language-model frame descriptions)
export {
  getCaptionsByContentHash,
  saveCaptions,
  adoptCaptionsFromCache,
  deleteCaptions,
  saveCaptionThumbnail,
  getCaptionThumbnailBlob,
  probeCaptionThumbnail,
  deleteCaptionThumbnails,
  saveCaptionEmbeddings,
  getCaptionEmbeddings,
  getCaptionsEmbeddingsMeta,
  deleteCaptionEmbeddings,
  saveCaptionImageEmbeddings,
  getCaptionImageEmbeddings,
} from '@freecut/infrastructure/storage/workspace-fs/captions'

// Media source files
export {
  hasMediaSource,
  readMediaSource,
  writeMediaSource,
} from '@freecut/infrastructure/storage/workspace-fs/media-source'

// Workspace cache mirror helpers
export {
  mirrorBlobToWorkspace,
  mirrorJsonToWorkspace,
  readWorkspaceBlob,
  removeWorkspaceCacheEntry,
} from '@freecut/infrastructure/storage/workspace-fs/cache-mirror'

// Workspace cache path helpers
export { proxyDir, proxyFilePath, proxyMetaPath } from '@freecut/infrastructure/storage/workspace-fs/paths'

// Embedded text-subtitle track cache (parsed once per source fingerprint)
export {
  getEmbeddedSubtitleSidecar,
  saveEmbeddedSubtitleSidecar,
} from '@freecut/infrastructure/storage/workspace-fs/embedded-subtitles'

// Scene-detection results
export { deleteScenes } from '@freecut/infrastructure/storage/workspace-fs/scenes'

// Generic AI-output envelope (use these directly for new AI services)
export { readAiOutput } from '@freecut/infrastructure/storage/workspace-fs/ai-outputs'
export {
  getEditingEvidence,
  saveVisualEditingEvidence,
} from '@freecut/infrastructure/storage/workspace-fs/editing-evidence'

// Orphan cache sweep
export {
  sweepWorkspaceOrphans,
  type OrphanSweepReport,
  type OrphanSweepOptions,
} from '@freecut/infrastructure/storage/workspace-fs/orphan-sweep'

// Final render outputs (export queue)
export {
  saveExportFile,
  listExportFiles,
  readExportFile,
  deleteExportFile,
  workspaceFolderName,
  type ExportFileEntry,
} from '@freecut/infrastructure/storage/workspace-fs/exports'

// Per-project render-queue persistence
export {
  loadRenderQueue,
  saveRenderQueue,
} from '@freecut/infrastructure/storage/workspace-fs/render-queue'

// Project-scoped AI editing assistant conversation history
export {
  loadAiEditingConversation,
  loadAiEditingConversationState,
  saveAiEditingConversation,
  saveAiEditingConversationState,
  clearAiEditingConversation,
  listAiEditingConversationHistory,
  archiveAiEditingConversation,
  resumeAiEditingConversation,
  type AiEditingConversationMessage,
  type AiEditingConversationContext,
  type AiEditingConversationWorkflow,
  type AiEditingConversationState,
  type AiEditingConversationHistorySession,
} from '@freecut/infrastructure/storage/workspace-fs/ai-editing-conversation'
export {
  loadAiEditingSkills,
  saveAiEditingSkills,
  type AiEditingSkillsSettings,
  type StoredAiEditingCustomSkill,
} from '@freecut/infrastructure/storage/workspace-fs/ai-editing-skills'
export {
  listAiEditingRuns,
  saveAiEditingRun,
  type AiEditingRunEvent,
  type AiEditingRunRecord,
} from '@freecut/infrastructure/storage/workspace-fs/ai-editing-runs'

// Soft-delete / trash for projects
export {
  softDeleteProject,
  restoreProject,
  listTrashedProjects,
  getTrashedProjectMediaIds,
  sweepTrashOlderThan,
  DEFAULT_TRASH_TTL_MS,
  type TrashedProjectEntry,
} from '@freecut/infrastructure/storage/workspace-fs/trash'

// User-saved effect presets (grades)
export {
  readUserEffectPresets,
  saveUserEffectPresets,
  type UserEffectPreset,
} from '@freecut/infrastructure/storage/workspace-fs/effect-presets'

// Per-project animation presets
export {
  readAnimationPresets,
  saveAnimationPresets,
  sanitizeAnimationPresets,
  type AnimationPreset,
  type AnimationPresetProperty,
  type AnimationPresetVectorProperty,
} from '@freecut/infrastructure/storage/workspace-fs/animation-presets'
