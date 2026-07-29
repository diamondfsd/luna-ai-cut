import type { WorkspaceRemovalOperation } from '../../shared/types'

export function activeRemovalOperation(operations: WorkspaceRemovalOperation[]): WorkspaceRemovalOperation | undefined {
  return [...operations].reverse().find((operation) => operation.enabled)
}

export function latestReadyRemovalOperation(operations: WorkspaceRemovalOperation[]): WorkspaceRemovalOperation | undefined {
  return [...operations].reverse().find((operation) => operation.enabled && operation.status !== 'needs-regeneration')
}

function invalidateAfter(operations: WorkspaceRemovalOperation[], index: number): WorkspaceRemovalOperation[] {
  return operations.map((operation, operationIndex) => operationIndex > index
    ? { ...operation, status: 'needs-regeneration', failureReason: '前序消除步骤已经改变' }
    : operation)
}

export function setRemovalOperationEnabled(
  operations: WorkspaceRemovalOperation[],
  operationId: string,
  enabled: boolean,
): WorkspaceRemovalOperation[] {
  const index = operations.findIndex((operation) => operation.id === operationId)
  if (index < 0 || (enabled && operations[index].status === 'needs-regeneration')) return operations
  const next = operations.map((operation, operationIndex) => operationIndex === index ? { ...operation, enabled } : operation)
  return invalidateAfter(next, index)
}

export function deleteRemovalOperation(
  operations: WorkspaceRemovalOperation[],
  operationId: string,
): WorkspaceRemovalOperation[] {
  const index = operations.findIndex((operation) => operation.id === operationId)
  if (index < 0) return operations
  return invalidateAfter(operations.filter((operation) => operation.id !== operationId), index - 1)
}
