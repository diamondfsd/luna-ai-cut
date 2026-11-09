export type LayoutId =
  | '19'
  | '22'
  | '24'
  | '24-rings'
  | '25'
  | '27-rings'
  | '32'
  | '32-rings'
  | '35-rings'
  | '36-visual'

export const PANORAMA_LAYOUTS = {
  '19': { rows: 3, columns: 6, photoCount: 19, pitchTop: 45, pitchStep: 45, pitchBottom: undefined, zenith: true },
  '22': { rows: 3, columns: 7, photoCount: 22, pitchTop: 45, pitchStep: 45, pitchBottom: undefined, zenith: true },
  '24': { rows: 4, columns: 6, photoCount: 24, pitchTop: 63, pitchStep: 40, pitchBottom: undefined, zenith: false },
  '24-rings': { rows: 3, columns: 8, photoCount: 24, pitchTop: 50, pitchStep: 50, pitchBottom: -57, zenith: true },
  '25': { rows: 3, columns: 9, photoCount: 25, pitchTop: 45, pitchStep: 45, pitchBottom: -45, zenith: true },
  '27-rings': { rows: 3, columns: 8, photoCount: 27, pitchTop: 45, pitchStep: 45, pitchBottom: -45, zenith: true },
  '32': { rows: 4, columns: 8, photoCount: 32, pitchTop: 72, pitchStep: 43, pitchBottom: undefined, zenith: false },
  '32-rings': { rows: 3, columns: 8, photoCount: 32, pitchTop: 45, pitchStep: 45, pitchBottom: -45, zenith: true },
  '35-rings': { rows: 3, columns: 8, photoCount: 35, pitchTop: 45, pitchStep: 45, pitchBottom: -45, zenith: true },
  '36-visual': { rows: 4, columns: 8, photoCount: 36, pitchTop: 70, pitchStep: 35, pitchBottom: -35, zenith: true },
} as const

export const PAN_MIN = -57
export const PAN_MAX = 235

export const MODE_ROWS: Record<string, number[]> = {
  sphere_7x3_manual3_zenith: [3, 7, 7, 7],
  sphere_887_manual3_zenith_v2: [3, 8, 8, 7],
  sphere_visual_8888_manual3_top_v1: [3, 8, 8, 8, 8],
  sphere_9x10x9_manual3_zenith_v1: [3, 9, 10, 9],
  sphere_10x11x10_manual3_zenith_v1: [3, 10, 11, 10],
  grid_666: [6, 6, 6],
  rings_675: [6, 7, 5],
  rings_585: [5, 8, 5],
  rings_675_plus3: [6, 7, 8],
  rings_788_plus_zenith: [7, 8, 8],
  rings_887_plus_zenith: [8, 8, 7],
}

export function rowMajorFromCaptureOrder<T>(
  captureOrder: T[],
  rows: number,
  columns: number,
  zenith: boolean,
): T[] {
  const rowMajor = Array<T>(rows * columns)
  const gridCaptureOrder = zenith ? captureOrder.slice(0, rows * columns) : captureOrder
  gridCaptureOrder.forEach((item, index) => {
    const column = Math.floor(index / rows)
    const step = index % rows
    const row = column % 2 === 0 ? step : rows - 1 - step
    rowMajor[row * columns + column] = item
  })
  return zenith ? [...rowMajor, ...captureOrder.slice(rows * columns)] : rowMajor
}

export function poseForGridIndex(
  index: number,
  rows: number,
  columns: number,
  pitchTop: number,
  pitchStep: number,
  pitchBottom: number | undefined,
  zenith: boolean,
): number[] {
  if (zenith && index === rows * columns) {
    return [PAN_MAX, 90, 0]
  }
  const row = Math.floor(index / columns)
  const column = index % columns
  const yaw = PAN_MIN + ((PAN_MAX - PAN_MIN) * column) / (columns - 1)
  const pitch = row === rows - 1 && pitchBottom !== undefined
    ? pitchBottom
    : pitchTop - row * pitchStep
  return [yaw, pitch, 0]
}
