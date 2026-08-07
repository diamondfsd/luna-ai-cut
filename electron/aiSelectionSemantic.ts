import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { AI_SELECTION_CONTENT_TAG_VERSION, type AiSelectionItem } from '../src/shared/types'
import { getFfmpegPath } from './ffmpeg/pipeline'
import { loadModel } from './modelLoader'
import { segmentSpecializedInWorker } from './specializedSegmentationService'

export const CONTENT_TAG_VERSION = AI_SELECTION_CONTENT_TAG_VERSION

const execFileAsync = promisify(execFile)
const COCO_LABELS = [
  '人物', '自行车', '汽车', '摩托车', '飞机', '公交车', '火车', '卡车', '船只', '交通灯',
  '消防栓', '停车标志', '停车计时器', '长椅', '鸟', '猫', '狗', '马', '羊', '牛',
  '大象', '熊', '斑马', '长颈鹿', '背包', '雨伞', '手提包', '领带', '行李箱', '飞盘',
  '滑雪板', '单板滑雪', '球', '风筝', '棒球棒', '手套', '滑板', '冲浪板', '网球拍', '瓶子',
  '酒杯', '杯子', '叉子', '刀具', '勺子', '碗', '香蕉', '苹果', '三明治', '橙子',
  '西兰花', '胡萝卜', '热狗', '披萨', '甜甜圈', '蛋糕', '椅子', '沙发', '盆栽', '床',
  '餐桌', '马桶', '电视', '笔记本电脑', '鼠标', '遥控器', '键盘', '手机', '微波炉', '烤箱',
  '烤面包机', '水槽', '冰箱', '书', '时钟', '花瓶', '剪刀', '玩偶', '吹风机', '牙刷',
] as const

const ADE_LABELS = new Map<number, string>([
  [0, '墙面'], [1, '建筑'], [2, '天空'], [3, '地面'], [4, '树木'], [5, '天花板'],
  [6, '道路'], [7, '床'], [8, '窗户'], [9, '草地'], [10, '柜子'], [11, '人行道'],
  [12, '人物'], [13, '土地'], [14, '门'], [15, '桌子'], [16, '山体'], [17, '植物'],
  [19, '椅子'], [20, '车辆'], [21, '水面'], [22, '画作'], [23, '沙发'], [25, '房屋'],
  [26, '海洋'], [29, '田野'], [32, '围栏'], [34, '岩石'], [46, '沙地'], [48, '摩天大楼'],
  [52, '小路'], [53, '楼梯'], [60, '河流'], [61, '桥梁'], [66, '花朵'], [68, '山丘'],
  [69, '长椅'], [72, '棕榈树'], [76, '船只'], [80, '公交车'], [83, '卡车'], [84, '塔'],
  [90, '飞机'], [91, '土路'], [102, '厢式车'], [104, '喷泉'], [109, '游泳池'], [114, '帐篷'],
  [120, '食物'], [126, '动物'], [127, '自行车'], [128, '湖泊'], [132, '雕塑'], [140, '码头'], [149, '旗帜'],
])

async function decodeSquare(filePath: string, size: number, pad: boolean, signal?: AbortSignal, frameTime?: number): Promise<{ rgb: Buffer; scaledWidth: number; scaledHeight: number; padX: number; padY: number }> {
  const filter = pad
    ? `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=0x727272`
    : `scale=${size}:${size}:flags=bilinear`
  const { stdout } = await execFileAsync(getFfmpegPath(), [
    '-v', 'error',
    ...(frameTime === undefined ? [] : ['-ss', frameTime.toFixed(3)]),
    '-i', filePath, '-frames:v', '1', '-vf', filter, '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
  ], {
    encoding: 'buffer', maxBuffer: size * size * 3 + 1024, signal,
  })
  const rgb = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout)
  if (rgb.byteLength !== size * size * 3) throw new Error('无法读取用于内容识别的画面')
  if (!pad) return { rgb, scaledWidth: size, scaledHeight: size, padX: 0, padY: 0 }
  return { rgb, scaledWidth: size, scaledHeight: size, padX: 0, padY: 0 }
}

function coverageByClass(bytes: Buffer): Array<{ classId: number; coverage: number }> {
  const counts = new Map<number, number>()
  for (const value of bytes) {
    if (value === 0) continue
    const classId = value - 1
    counts.set(classId, (counts.get(classId) ?? 0) + 1)
  }
  return [...counts].map(([classId, count]) => ({ classId, coverage: count / bytes.length }))
    .sort((a, b) => b.coverage - a.coverage)
}

function objectTags(bytes: Buffer): string[] {
  const detections = coverageByClass(bytes)
    .filter((entry) => entry.coverage >= (entry.classId === 0 ? 0.015 : 0.001))
    .slice(0, 8)
  const tags: string[] = detections.map((entry) => COCO_LABELS[entry.classId]).filter((label): label is typeof COCO_LABELS[number] => Boolean(label))
  if (detections.some(({ classId }) => classId >= 1 && classId <= 8)) tags.push('车辆')
  if (detections.some(({ classId }) => classId >= 14 && classId <= 23)) tags.push('动物')
  if (detections.some(({ classId }) => classId === 15 || classId === 16)) tags.push('宠物')
  if (detections.some(({ classId }) => classId >= 46 && classId <= 55)) tags.push('美食')
  if (detections.some(({ classId }) => classId >= 29 && classId <= 38)) tags.push('运动')
  return tags
}

function sceneTags(bytes: Buffer): string[] {
  const tags = coverageByClass(bytes)
    .filter((entry) => entry.coverage >= 0.015 && ADE_LABELS.has(entry.classId))
    .slice(0, 6)
    .map((entry) => ADE_LABELS.get(entry.classId)!)
  const has = (...values: string[]): boolean => values.some((value) => tags.includes(value))
  if (has('建筑', '摩天大楼', '道路', '桥梁', '塔')) tags.push('城市')
  if (has('天空') && has('建筑', '水面', '海洋', '山体', '树木', '湖泊')) tags.push('风景')
  if (has('树木', '草地', '植物', '山体', '水面', '海洋', '田野', '湖泊') && !has('建筑', '道路')) tags.push('自然风景')
  if (has('墙面', '地面', '天花板') && has('桌子', '椅子', '床', '沙发', '柜子')) tags.push('室内')
  return tags
}

export async function analyzeContentTags(item: AiSelectionItem, signal?: AbortSignal): Promise<string[]> {
  if (item.kind !== 'image' || item.analysisState !== 'ready') return []
  return analyzeContentTagsForFrame(item.path, undefined, signal)
}

/**
 * Returns compact local-model tags for one source frame. The caller receives
 * neither frame bytes nor masks, which keeps this safe to pass into an AI
 * editing evidence layer.
 */
export async function analyzeContentTagsForFrame(
  filePath: string,
  frameTime: number | undefined,
  signal?: AbortSignal,
): Promise<string[]> {
  const [yoloModel, sceneModel] = await Promise.all([
    loadModel('yolo26s-seg', undefined, signal),
    loadModel('segformer-b5-ade20k', undefined, signal),
  ])
  const yoloInput = await decodeSquare(filePath, 640, true, signal, frameTime)
  const yolo = await segmentSpecializedInWorker({
    backend: 'yolo26-labels', modelPath: yoloModel.path, ...yoloInput, outputSize: 128,
  }, signal)
  const sceneInput = await decodeSquare(filePath, 512, false, signal, frameTime)
  const scene = await segmentSpecializedInWorker({
    backend: 'segformer-labels', modelPath: sceneModel.path, ...sceneInput, outputSize: 128,
  }, signal)
  return [...new Set([...objectTags(yolo.bytes), ...sceneTags(scene.bytes)])]
}
