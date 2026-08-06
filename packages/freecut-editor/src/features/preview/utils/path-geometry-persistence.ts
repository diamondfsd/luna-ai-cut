import type { AutoKeyframeOperation } from '@freecut/features/preview/deps/keyframes'
import {
  clonePathVertices,
  getAutoKeyframeOperation,
  getChangedPathVertexValues,
  hasPathVertexKeyframes,
  isFrameInTransitionRegion,
  resolveAnimatedShapeItem,
} from '@freecut/features/preview/deps/keyframes'
import { useTransitionsStore } from '@freecut/features/preview/deps/timeline-store'
import type { ItemKeyframes } from '@freecut/types/keyframe'
import type { MaskVertex } from '@freecut/types/masks'
import type { ShapeItem } from '@freecut/types/timeline'

export type PathGeometryPersistenceBlockReason = 'topology' | 'frame'

export interface PathGeometryPersistence {
  blocked: PathGeometryPersistenceBlockReason | null
  pathVertices: MaskVertex[] | undefined
  autoKeyframeOperations: AutoKeyframeOperation[]
}

export function buildPathGeometryPersistence(params: {
  item: ShapeItem
  itemKeyframes: ItemKeyframes | undefined
  nextVertices: MaskVertex[]
  currentFrame: number
}): PathGeometryPersistence {
  const { item, itemKeyframes, nextVertices, currentFrame } = params
  const relativeFrame = currentFrame - item.from
  const resolvedVertices =
    resolveAnimatedShapeItem(item, itemKeyframes, relativeFrame).pathVertices ??
    item.pathVertices ??
    []
  const pathIsAnimated = hasPathVertexKeyframes(itemKeyframes)

  if (pathIsAnimated && resolvedVertices.length !== nextVertices.length) {
    return { blocked: 'topology', pathVertices: undefined, autoKeyframeOperations: [] }
  }

  const changedValues = getChangedPathVertexValues(resolvedVertices, nextVertices)
  if (changedValues.length === 0) {
    return {
      blocked: null,
      pathVertices: clonePathVertices(nextVertices),
      autoKeyframeOperations: [],
    }
  }

  const normalOperations = changedValues.flatMap(({ property, value }) => {
    const operation = getAutoKeyframeOperation(
      item,
      itemKeyframes,
      property,
      value,
      currentFrame,
    )
    return operation ? [operation] : []
  })
  if (!pathIsAnimated && normalOperations.length === 0) {
    return {
      blocked: null,
      pathVertices: clonePathVertices(nextVertices),
      autoKeyframeOperations: [],
    }
  }

  const isWithinItemBounds = relativeFrame >= 0 && relativeFrame < item.durationInFrames
  const blockedByTransition =
    isWithinItemBounds &&
    isFrameInTransitionRegion(
      relativeFrame,
      item.id,
      item,
      useTransitionsStore.getState().transitions,
    )
  if (!isWithinItemBounds || blockedByTransition) {
    return { blocked: 'frame', pathVertices: undefined, autoKeyframeOperations: [] }
  }

  const autoKeyframeOperations: AutoKeyframeOperation[] = changedValues.map(
    ({ property, value }) => {
      const existing = itemKeyframes?.properties
        .find((entry) => entry.property === property)
        ?.keyframes.find((keyframe) => keyframe.frame === relativeFrame)
      return existing
        ? {
            type: 'update',
            itemId: item.id,
            property,
            keyframeId: existing.id,
            updates: { value },
          }
        : {
            type: 'add',
            itemId: item.id,
            property,
            frame: relativeFrame,
            value,
            easing: 'linear',
          }
    },
  )

  return {
    blocked: null,
    pathVertices: undefined,
    autoKeyframeOperations,
  }
}
