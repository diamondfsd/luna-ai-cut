/**
 * Timeline Engine — 计算指定时间点的活跃 Clip
 *
 * 对于水印 Demo，时间线非常简单：
 * 所有媒体始终活跃，水印也始终活跃。
 * 未来扩展：支持多 clip 时间线、关键帧等。
 */

import type { Project, Clip } from './types'

export interface ActiveClip {
  clip: Clip
  /** 当前时间点在素材中的源时间 */
  sourceTime: number
}

/**
 * 评估时间线，返回当前时间点的活跃 Clip 集合。
 *
 * @param project 项目数据
 * @param _time 当前时间（未来可支持视频时间线）
 * @returns 活跃的 Clip 列表
 */
export function evaluateTimeline(project: Project, _time: number = 0): ActiveClip[] {
  const result: ActiveClip[] = []

  for (const track of project.timeline.tracks) {
    for (const clip of track.clips) {
      result.push({
        clip,
        sourceTime: 0, // 图片始终是 0，视频将来扩展
      })
    }
  }

  return result
}
