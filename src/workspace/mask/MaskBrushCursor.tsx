interface Props {
  x: number
  y: number
  diameter: number
  subtract: boolean
}

export function MaskBrushCursor({ x, y, diameter, subtract }: Props) {
  return (
    <span
      className={`workspace-mask-brush-cursor${subtract ? ' is-subtract' : ''}`}
      style={{ left: x, top: y, width: diameter, height: diameter }}
    />
  )
}
