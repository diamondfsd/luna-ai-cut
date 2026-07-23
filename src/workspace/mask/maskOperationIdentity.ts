export interface MaskOperationIdentity {
  projectId?: string
  assetId?: string
  active: boolean
}

export interface MaskOperation {
  generation: number
  kind: 'load' | 'save' | 'segmentation'
  projectId: string
  assetId: string
  requestId?: string
}

export function createMaskOperation(
  generation: number,
  kind: MaskOperation['kind'],
  projectId: string,
  assetId: string,
  requestId?: string,
): MaskOperation {
  return { generation: generation + 1, kind, projectId, assetId, requestId }
}

export function isMatchingMaskOperation(
  active: MaskOperation | null,
  operation: MaskOperation,
  identity: MaskOperationIdentity,
): boolean {
  return active?.generation === operation.generation
    && identity.active
    && active.projectId === operation.projectId
    && active.assetId === operation.assetId
    && identity.projectId === operation.projectId
    && identity.assetId === operation.assetId
}

export function isMatchingSegmentationRequest(operation: MaskOperation | null, requestId: string): boolean {
  return operation?.kind === 'segmentation' && operation.requestId === requestId
}
