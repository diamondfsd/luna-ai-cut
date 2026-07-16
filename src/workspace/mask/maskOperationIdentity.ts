export interface MaskOperationIdentity {
  projectId?: string
  assetId?: string
}

export interface MaskOperation {
  generation: number
  kind: 'load' | 'save' | 'segmentation'
  projectId: string
  assetId: string
}

export function createMaskOperation(
  generation: number,
  kind: MaskOperation['kind'],
  projectId: string,
  assetId: string,
): MaskOperation {
  return { generation: generation + 1, kind, projectId, assetId }
}

export function isMatchingMaskOperation(
  active: MaskOperation | null,
  operation: MaskOperation,
  identity: MaskOperationIdentity,
): boolean {
  return active?.generation === operation.generation
    && active.projectId === operation.projectId
    && active.assetId === operation.assetId
    && identity.projectId === operation.projectId
    && identity.assetId === operation.assetId
}
