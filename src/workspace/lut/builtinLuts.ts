/**
 * 内置滤镜 LUT — 从 public/luts/ 文件系统加载
 *
 * 目录结构：
 *   public/luts/
 *     manifest.json             ← 分类列表 ["日系","胶片",...]
 *     日系/
 *       manifest.json           ← 文件列表 ["SS_BlueArchitecture",...]
 *       SS_BlueArchitecture.cube
 *       SS_BlueArchitecture.cube.meta.json  ← { "name": "蓝调建筑", "description": "..." }
 */

export interface LutFileInfo {
  id: string
  name: string
  category: string
  /** public/luts/ 下的相对路径，用于 fetch */
  filePath: string
}

export interface LutMeta {
  name?: string
  description?: string
}

/** LUT 基目录 */
export const LUT_BASE = '/luts'

/** 加载并解析 JSON */
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

/** 发现所有内置 LUT（读取 manifest + meta.json） */
export async function getBuiltinLuts(): Promise<LutFileInfo[]> {
  const categories = await fetchJson<string[]>(`${LUT_BASE}/manifest.json`)
  if (!categories) return []

  const allLuts: LutFileInfo[] = []

  for (const category of categories) {
    const files = await fetchJson<string[]>(`${LUT_BASE}/${category}/manifest.json`)
    if (!files) continue

    for (const file of files) {
      const filePath = `${category}/${file}.cube`
      const meta = await fetchJson<LutMeta>(`${LUT_BASE}/${category}/${file}.cube.meta.json`)
      const name = meta?.name || file
      allLuts.push({ id: `builtin:${filePath}`, name, category, filePath })
    }
  }

  return allLuts
}

/** 通过 fetch 加载 .cube 数据 */
export async function loadBuiltinLutData(filePath: string): Promise<Uint8Array> {
  const url = `${LUT_BASE}/${filePath}`
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`加载 LUT 失败: ${response.status} ${url}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}
