import type { TransitionType } from "@openreel/core";

export interface TransitionDisplayInfo {
  name: string;
  description: string;
}

export const TRANSITION_DISPLAY: Record<TransitionType, TransitionDisplayInfo> = {
  crossfade: { name: "交叉淡化", description: "平滑混合两个片段" },
  dipToBlack: { name: "淡入黑场", description: "通过黑场完成淡化" },
  dipToWhite: { name: "淡入白场", description: "通过白场完成淡化" },
  wipe: { name: "擦除", description: "从一个片段擦除到另一个片段" },
  slide: { name: "滑动", description: "新片段滑入覆盖原片段" },
  zoom: { name: "缩放", description: "片段之间的缩放转场" },
  push: { name: "推入", description: "新片段推入替换原片段" },
  circleReveal: { name: "圆形展开", description: "从中心向外展开" },
  blur: { name: "模糊溶解", description: "模糊淡出并进入下一个片段" },
  whipPan: { name: "快速摇移", description: "快速运动模糊摇移" },
  radialWipe: { name: "放射擦除", description: "时钟式角度扫过画面" },
  pixelate: { name: "像素化", description: "以像素马赛克完成切换" },
  glitch: { name: "故障切换", description: "数字切片位移" },
  blinds: { name: "百叶窗", description: "重复条带展开" },
  diamondReveal: { name: "菱形展开", description: "从中心以几何形状展开" },
  spin: { name: "旋转", description: "旋转缩放切换" },
  flip: { name: "翻转", description: "水平或垂直卡片式翻转" },
  splitReveal: { name: "分割展开", description: "从中心向外展开" },
  flash: { name: "闪白切换", description: "高能白色闪光切换" },
  filmBurn: { name: "胶片灼烧", description: "暖色模拟漏光" },
  mosaic: { name: "马赛克展开", description: "打乱方块在片段之间展开" },
  ripple: { name: "波纹", description: "流动的水平波纹变形" },
  pageTurn: { name: "翻页", description: "像翻页一样折叠离开" },
  colorSplit: { name: "色彩分离", description: "色彩通道在切换中产生残影" },
};

export const getTransitionDisplay = (
  type: TransitionType | string,
): TransitionDisplayInfo =>
  TRANSITION_DISPLAY[type as TransitionType] ?? {
    name: "转场",
    description: "片段之间的切换效果",
  };
