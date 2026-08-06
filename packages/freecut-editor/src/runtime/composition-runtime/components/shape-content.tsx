import React, { useCallback, useContext, useId, useMemo } from 'react'
import {
  Rect,
  Circle,
  Triangle,
  Ellipse,
  Star,
  Polygon,
  Heart,
  ShapePath,
  buildBezierPathData,
} from '@freecut/shared/graphics/shapes'
import { flattenBezierPath } from '@freecut/shared/graphics/shapes/bezier-path'
import { hasActiveTaper } from '@freecut/shared/graphics/shapes/taper-path'
import {
  getLinearGradientUnitEndpoints,
  resolveShapeLinearGradient,
} from '@freecut/shared/graphics/shapes/linear-gradient'
import {
  buildTaperedOutline,
  getTaperedOutlineFillPath,
} from '@freecut/shared/graphics/shapes/taper-outline'
import { useItemGizmoPreview, useTimelineStore } from '@freecut/runtime/composition-runtime/deps/stores'
import type { ShapeItem } from '@freecut/types/timeline'
import { useCompositionSpace } from '../contexts/composition-space-context'
import { useItemVisualTransform } from '../contexts/item-visual-transform-context'
import { useSequenceContext } from '@freecut/runtime/composition-runtime/deps/player'
import { useItemKeyframesFromContext } from '../contexts/keyframes-context'
import { KeyframesContext } from '../contexts/keyframes-context-core'
import { resolveAnimatedShapeItem } from '@freecut/runtime/composition-runtime/deps/keyframes'

/**
 * Shape content with live property preview support.
 * Renders Composition shapes (Rect, Circle, Triangle, Ellipse, Star, Polygon).
 * Reads preview values from gizmo store for real-time updates during editing.
 */
export const ShapeContent: React.FC<{ item: ShapeItem & { _sequenceFrameOffset?: number } }> = ({
  item,
}) => {
  const compositionSpace = useCompositionSpace()
  const renderScaleX = compositionSpace?.scaleX ?? 1
  const renderScaleY = compositionSpace?.scaleY ?? 1
  const renderScale = compositionSpace?.scale ?? 1
  const visualTransform = useItemVisualTransform()
  const sequenceContext = useSequenceContext()
  const keyframesContext = useContext(KeyframesContext)
  const contextKeyframes = useItemKeyframesFromContext(item.id)
  const storeKeyframes = useTimelineStore(
    useCallback((s) => s.keyframes.find((entry) => entry.itemId === item.id), [item.id]),
  )
  const sequenceFrameOffset =
    item._sequenceFrameOffset ??
    (sequenceContext ? item.from - (sequenceContext.from - sequenceContext.parentFrom) : 0)
  const relativeFrame = (sequenceContext?.localFrame ?? 0) - sequenceFrameOffset
  const resolvedItem = useMemo(
    () =>
      resolveAnimatedShapeItem(
        item,
        contextKeyframes ?? storeKeyframes,
        relativeFrame,
        keyframesContext?.canvas
          ? {
              globalFrame: item.from + relativeFrame,
              canvas: keyframesContext.canvas,
              getItem: keyframesContext.getItem,
              getKeyframes: keyframesContext.getItemKeyframes,
            }
          : undefined,
      ),
    [contextKeyframes, item, keyframesContext, relativeFrame, storeKeyframes],
  )

  const { activeGizmo, previewTransform, itemPreview } = useItemGizmoPreview(item.id, {
    imperativeTranslate: true,
  })
  const gradientId = `shape-gradient-${useId().replaceAll(':', '')}`

  // Use preview values if available, otherwise use item's stored values
  const shapePropsPreview = itemPreview?.properties
  const fillColor = shapePropsPreview?.fillColor ?? resolvedItem.fillColor ?? '#3b82f6'
  const fillType = shapePropsPreview?.fillType ?? resolvedItem.fillType ?? 'solid'
  const gradientStartColor =
    shapePropsPreview?.gradientStartColor ?? resolvedItem.gradientStartColor
  const gradientEndColor = shapePropsPreview?.gradientEndColor ?? resolvedItem.gradientEndColor
  const gradientAngle = shapePropsPreview?.gradientAngle ?? resolvedItem.gradientAngle
  const strokeColor = shapePropsPreview?.strokeColor ?? resolvedItem.strokeColor
  const strokeWidth =
    (shapePropsPreview?.strokeWidth ?? resolvedItem.strokeWidth ?? 0) * renderScale
  const cornerRadius =
    (shapePropsPreview?.cornerRadius ?? resolvedItem.cornerRadius ?? 0) * renderScale
  const direction = shapePropsPreview?.direction ?? resolvedItem.direction ?? 'up'
  const points = shapePropsPreview?.points ?? resolvedItem.points ?? 5
  const innerRadius = shapePropsPreview?.innerRadius ?? resolvedItem.innerRadius ?? 0.5
  const shapeType = shapePropsPreview?.shapeType ?? resolvedItem.shapeType
  const pathClosed = shapePropsPreview?.pathClosed ?? resolvedItem.pathClosed ?? true
  const fillEnabled =
    shapeType === 'path' && !pathClosed
      ? false
      : (shapePropsPreview?.fillEnabled ?? resolvedItem.fillEnabled ?? true)
  const strokeEnabled =
    shapePropsPreview?.strokeEnabled ??
    resolvedItem.strokeEnabled ??
    (strokeWidth > 0 && strokeColor !== undefined)
  const strokeLineCap = shapePropsPreview?.strokeLineCap ?? resolvedItem.strokeLineCap ?? 'butt'
  const strokeLineJoin = shapePropsPreview?.strokeLineJoin ?? resolvedItem.strokeLineJoin ?? 'miter'
  const strokeMiterLimit = shapePropsPreview?.strokeMiterLimit ?? resolvedItem.strokeMiterLimit ?? 4
  const trimPathStart = shapePropsPreview?.trimPathStart ?? resolvedItem.trimPathStart ?? 0
  const trimPathEnd = shapePropsPreview?.trimPathEnd ?? resolvedItem.trimPathEnd ?? 100
  const trimPathOffset = shapePropsPreview?.trimPathOffset ?? resolvedItem.trimPathOffset ?? 0
  const taperStartWidth = shapePropsPreview?.taperStartWidth ?? resolvedItem.taperStartWidth ?? 100
  const taperEndWidth = shapePropsPreview?.taperEndWidth ?? resolvedItem.taperEndWidth ?? 100
  const taperStartLength = shapePropsPreview?.taperStartLength ?? resolvedItem.taperStartLength ?? 0
  const taperEndLength = shapePropsPreview?.taperEndLength ?? resolvedItem.taperEndLength ?? 0
  const linearGradient = resolveShapeLinearGradient({
    fillType,
    fillColor,
    gradientStartColor,
    gradientEndColor,
    gradientAngle,
  })
  const gradientEndpoints = linearGradient
    ? getLinearGradientUnitEndpoints(linearGradient.angle)
    : null
  const fillPaint = fillEnabled ? (linearGradient ? `url(#${gradientId})` : fillColor) : 'none'
  const fallbackBackground = linearGradient
    ? `linear-gradient(${linearGradient.angle + 90}deg, ${linearGradient.startColor}, ${linearGradient.endColor})`
    : fillColor

  // Get dimensions with preview support for real-time gizmo scaling
  // Priority: Unified preview (group/properties) > Single gizmo preview > Base transform
  let width = (visualTransform?.width ?? item.transform?.width ?? 200) * renderScaleX
  let height = (visualTransform?.height ?? item.transform?.height ?? 200) * renderScaleY

  const itemPreviewTransform = itemPreview?.transform
  const isGizmoPreviewActive = activeGizmo?.itemId === item.id && previewTransform !== null

  if (!visualTransform && itemPreviewTransform) {
    width = (itemPreviewTransform.width ?? width / renderScaleX) * renderScaleX
    height = (itemPreviewTransform.height ?? height / renderScaleY) * renderScaleY
  } else if (!visualTransform && isGizmoPreviewActive && previewTransform) {
    width = previewTransform.width * renderScaleX
    height = previewTransform.height * renderScaleY
  }
  const fillDefinition =
    linearGradient && gradientEndpoints ? (
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1={gradientEndpoints.start.x * width}
          y1={gradientEndpoints.start.y * height}
          x2={gradientEndpoints.end.x * width}
          y2={gradientEndpoints.end.y * height}
        >
          <stop offset="0%" stopColor={linearGradient.startColor} />
          <stop offset="100%" stopColor={linearGradient.endColor} />
        </linearGradient>
      </defs>
    ) : undefined

  // Common stroke props
  const strokeProps =
    strokeEnabled && strokeWidth > 0 && strokeColor
      ? {
          stroke: strokeColor,
          strokeWidth,
          strokeLinecap: strokeLineCap,
          strokeLinejoin: strokeLineJoin,
          strokeMiterlimit: strokeMiterLimit,
        }
      : {}
  const trimPathProps = { trimPathStart, trimPathEnd, trimPathOffset }
  const taperProps = {
    taperStartWidth,
    taperEndWidth,
    taperStartLength,
    taperEndLength,
  }

  // Check if aspect ratio is locked (for squish/squash behavior)
  // Read from preview transforms if available, otherwise from item
  let aspectLocked = item.transform?.aspectRatioLocked ?? true
  if (itemPreviewTransform?.aspectRatioLocked !== undefined) {
    aspectLocked = itemPreviewTransform.aspectRatioLocked
  } else if (isGizmoPreviewActive && previewTransform?.aspectRatioLocked !== undefined) {
    aspectLocked = previewTransform.aspectRatioLocked
  }

  // Centering wrapper style for SVG shapes
  const centerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  // For shapes that need to squish/squash when aspect is unlocked,
  // we render at base size and apply CSS scale transform
  const baseSize = Math.min(width, height)
  const scaleX = aspectLocked ? 1 : width / baseSize
  const scaleY = aspectLocked ? 1 : height / baseSize
  const needsScale = !aspectLocked && (scaleX !== 1 || scaleY !== 1)

  const scaleStyle: React.CSSProperties = needsScale
    ? {
        transform: `scale(${scaleX}, ${scaleY})`,
      }
    : {}

  // Render appropriate shape based on shapeType
  switch (shapeType) {
    case 'rectangle':
      // Rectangle fills the entire container (naturally supports non-proportional)
      return (
        <div style={centerStyle}>
          <Rect
            width={width}
            height={height}
            fill={fillPaint}
            fillDefinition={fillDefinition}
            cornerRadius={cornerRadius}
            {...strokeProps}
            {...trimPathProps}
            {...taperProps}
          />
        </div>
      )

    case 'circle': {
      // Circle: squish/squash when aspect unlocked
      const radius = baseSize / 2
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Circle
              radius={radius}
              fill={fillPaint}
              fillDefinition={fillDefinition}
              {...strokeProps}
              {...trimPathProps}
              {...taperProps}
            />
          </div>
        </div>
      )
    }

    case 'triangle': {
      // Triangle: squish/squash when aspect unlocked
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Triangle
              length={baseSize}
              direction={direction}
              fill={fillPaint}
              fillDefinition={fillDefinition}
              cornerRadius={cornerRadius}
              {...strokeProps}
              {...trimPathProps}
              {...taperProps}
            />
          </div>
        </div>
      )
    }

    case 'ellipse': {
      // Ellipse naturally supports non-proportional via rx/ry
      const rx = width / 2
      const ry = height / 2
      return (
        <div style={centerStyle}>
          <Ellipse
            rx={rx}
            ry={ry}
            fill={fillPaint}
            fillDefinition={fillDefinition}
            {...strokeProps}
            {...trimPathProps}
            {...taperProps}
          />
        </div>
      )
    }

    case 'star': {
      // Star: squish/squash when aspect unlocked
      const outerRadius = baseSize / 2
      const innerRadiusValue = outerRadius * innerRadius
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Star
              points={points}
              outerRadius={outerRadius}
              innerRadius={innerRadiusValue}
              fill={fillPaint}
              fillDefinition={fillDefinition}
              cornerRadius={cornerRadius}
              {...strokeProps}
              {...trimPathProps}
              {...taperProps}
            />
          </div>
        </div>
      )
    }

    case 'polygon': {
      // Polygon: squish/squash when aspect unlocked
      const radius = baseSize / 2
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Polygon
              points={points}
              radius={radius}
              fill={fillPaint}
              fillDefinition={fillDefinition}
              cornerRadius={cornerRadius}
              {...strokeProps}
              {...trimPathProps}
              {...taperProps}
            />
          </div>
        </div>
      )
    }

    case 'heart': {
      // Heart: use Composition's Heart component for consistency with mask path generation
      // Heart output width = 1.1 × input height, so we scale input to fit within baseSize
      // Using height = baseSize / 1.1 ensures output width = baseSize (fits container)
      const heartHeight = baseSize / 1.1
      return (
        <div style={centerStyle}>
          <div style={scaleStyle}>
            <Heart
              height={heartHeight}
              fill={fillPaint}
              fillDefinition={fillDefinition}
              {...strokeProps}
              {...trimPathProps}
              {...taperProps}
            />
          </div>
        </div>
      )
    }

    case 'path': {
      // Custom bezier path drawn with pen tool
      const pathVerts = resolvedItem.pathVertices
      if (!pathVerts || pathVerts.length < 2) {
        return <div style={{ width: '100%', height: '100%', background: fallbackBackground }} />
      }
      const pathData = buildBezierPathData(pathVerts, width, height, pathClosed)
      const taperedOutline =
        strokeEnabled && strokeColor && hasActiveTaper(taperProps)
          ? buildTaperedOutline(flattenBezierPath(pathVerts, width, height, pathClosed), {
              strokeWidth,
              lineCap: strokeLineCap,
              ...trimPathProps,
              ...taperProps,
            })
          : null
      return (
        <div style={centerStyle}>
          <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} overflow="visible">
            {fillDefinition}
            {taperedOutline ? (
              <>
                <path d={pathData} fill={fillPaint} />
                <path
                  d={getTaperedOutlineFillPath(taperedOutline)}
                  fill={strokeColor}
                  data-taper-outline="true"
                  data-taper-cap-count={taperedOutline.caps.length}
                />
              </>
            ) : (
              <ShapePath
                d={pathData}
                fill={fillPaint}
                {...strokeProps}
                {...trimPathProps}
                {...taperProps}
              />
            )}
          </svg>
        </div>
      )
    }

    default:
      // Fallback to simple colored div for unknown types
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            background: fallbackBackground,
            borderRadius: cornerRadius,
          }}
        />
      )
  }
}
