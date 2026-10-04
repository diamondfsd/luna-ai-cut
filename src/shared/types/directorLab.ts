export interface DirectorLabDownloadRequest {
  operationId?: string
  url: string
  fileName: string
  planTitle: string
  plan?: DirectorLanPlanSummary
  takeId?: string
  metadata?: Record<string, DirectorLabMediaMetadata>
  shotOrder?: number
  shotName?: string
  takeIndex?: number
}

export interface DirectorLabDownloadResult {
  path: string
  fileName: string
}

export interface DirectorLabDownloadPlanRequest {
  operationId?: string
  plan: DirectorLanPlanSummary
  metadata?: Record<string, DirectorLabMediaMetadata>
}

export interface DirectorLabDownloadPlanResult {
  directory: string
  fileCount: number
}

export interface DirectorLabPreviewRequest {
  url: string
  cacheKey: string
}

export interface DirectorLabPreviewResult {
  url: string
  cached: boolean
}

export interface DirectorLabProbeRequest {
  takeId: string
  url: string
}

export interface DirectorLabMediaMetadata {
  takeId: string
  durationMs: number | null
  capturedAt: string | null
  width: number | null
  height: number | null
  codec: string | null
  error: string | null
}

export interface DirectorLabDiscoveredService {
  id: string
  name: string
  host: string
  port: number
  baseUrl: string
  discoveryMethod: 'udp' | 'subnet'
}

export interface DirectorLabDiscoveryResult {
  services: DirectorLabDiscoveredService[]
  udpResponderCount: number
  scannedHostCount: number
}

export interface DirectorLabDownloadProgress {
  operationId: string
  planId: string
  kind: 'plan' | 'take'
  phase: 'preparing' | 'downloading' | 'writing' | 'done'
  completedFiles: number
  totalFiles: number
  currentFile?: string
  percent: number
}

export interface DirectorMaterialSyncProgress {
  operationId: string
  endpoint: string
  planId: string
  takeId: string
  fileName: string
  direction: 'upload' | 'download'
  status: 'pending' | 'transferring' | 'done' | 'failed'
  transferred: number
  total: number | null
}

export interface DirectorLabApi {
  download(request: DirectorLabDownloadRequest): Promise<DirectorLabDownloadResult>
  downloadPlan(request: DirectorLabDownloadPlanRequest): Promise<DirectorLabDownloadPlanResult>
  discover(): Promise<DirectorLabDiscoveryResult>
  listLocalPlans(): Promise<DirectorLanPlanSummary[]>
  reconcilePlanDeletions(endpoint: string, remotePlanIds: string[]): Promise<string[]>
  addLocalShot(plan: DirectorLanPlanSummary, shot: DirectorLanShot): Promise<DirectorLanPlanSummary>
  importShots(plan: DirectorLanPlanSummary, text?: string): Promise<DirectorLanPlanSummary | null>
  importPlan(): Promise<DirectorLanPlanSummary | null>
  importPlanText(text: string): Promise<DirectorLanPlanSummary>
  saveLocalPlan(plan: DirectorLanPlanSummary, expectedSignature?: string): Promise<DirectorLanPlanSummary>
  importMaterials(plan: DirectorLanPlanSummary, shotId: string): Promise<DirectorLanPlanSummary | null>
  deleteLocalPlan(planId: string, expectedSignature: string): Promise<void>
  deleteLocalMaterial(planId: string, takeId: string): Promise<DirectorLanPlanSummary>
  syncMaterials(endpoint: string, planId: string, operationId?: string): Promise<void>
  onMaterialSyncProgress(callback: (progress: DirectorMaterialSyncProgress) => void): () => void
  acknowledgeLocalPlan(remote: DirectorLanPlanSummary, signature: string): Promise<void>
  prepareThumbnail(url: string, positionMs?: number): Promise<DirectorLabPreviewResult>
  reconcileLocalPlan(plan: DirectorLanPlanSummary, resolveConflict?: boolean): Promise<boolean>
  onDownloadProgress(callback: (progress: DirectorLabDownloadProgress) => void): () => void
  preparePreview(request: DirectorLabPreviewRequest): Promise<DirectorLabPreviewResult>
  probeMedia(requests: DirectorLabProbeRequest[]): Promise<DirectorLabMediaMetadata[]>
}

export interface DirectorLanPlanSummary {
  id: string
  title: string
  main_content?: string
  created_at: string
  updated_at: string
  revision?: number
  synced_revision?: number
  synced_signature?: string
  remote_origin?: string
  pending_shot_ids?: string[]
  pending_create?: boolean
  /** Local Agent write receipts; never part of phone synchronization. */
  agent_creation_receipt?: { keyHash: string; inputHash: string }
  agent_write_receipt?: { keyHash: string; inputHash: string }
  pending_take_ids?: string[]
  deleted_local_take_ids?: string[]
  /** 属性名由计划统一定义，所有镜头共用。 */
  attributes: DirectorLanPlanAttribute[]
  shot_count: number
  completed_shot_count: number
  take_count: number
  archive_url: string
  source: 'remote' | 'local'
  local_directory?: string
  local_updated_at?: string
  local_content_signature?: string
  remote_plan?: DirectorLanPlanSummary
  update_available?: boolean
  shots: DirectorLanShot[]
}

/** Opaque mobile recipe: retain every field; interpretation belongs to shot analysis. */
export type DirectorShotRecipe = Record<string, unknown>

export interface DirectorLanShot {
  id: string
  order: number
  name: string
  attributes: DirectorLanShotAttribute[]
  /** 镜头额外备注，不属于计划属性。 */
  remark: string
  visual_description?: string
  movement_description?: string
  duration_ms: number
  shot_recipe?: DirectorShotRecipe | null
  completed_takes: number
  takes: DirectorLanTake[]
}

export interface DirectorLanShotAttribute {
  id: string
  name: string
  description: string
}

export interface DirectorLanPlanAttribute {
  id: string
  name: string
}

export interface DirectorShotFieldDefinition {
  id: string
  label: string
  storage_name: string
  kind: 'text' | 'multiline'
  max_length: number
}

export interface DirectorPlanSchema {
  schema_version: number
  shot_fields: DirectorShotFieldDefinition[]
}

export interface DirectorTakeMarker {
  id: string
  start_ms: number
  end_ms: number | null
  text: string
}

export interface DirectorLanTake {
  id: string
  kind: 'photo' | 'video'
  source_camera_path?: string | null
  location?: Record<string, unknown> | null
  created_at: string
  captured_at?: string | null
  duration_ms?: number | null
  width?: number | null
  height?: number | null
  codec?: string | null
  file_name: string
  mime_type: string
  size_bytes: number | null
  available: boolean
  selected_range: { start_ms: number; end_ms: number; note?: string } | null
  markers?: DirectorTakeMarker[]
  stream_path: string | null
  stream_url: string | null
  download_path: string | null
  download_url: string | null
}

export interface DirectorLanPlansResponse {
  service: string
  api_version: number
  generated_at: string
  plan_count: number
  plans: DirectorLanPlanSummary[]
}
