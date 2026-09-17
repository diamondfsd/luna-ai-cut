import type { SocialMediaCategory } from "@openreel/core";

const SOCIAL_CATEGORY_LABELS: Partial<Record<SocialMediaCategory, string>> = {
  tiktok: "TikTok",
  "instagram-reels": "Reels",
  "instagram-stories": "快拍",
  "instagram-post": "帖子",
  "youtube-shorts": "Shorts",
  "youtube-video": "视频",
  facebook: "Facebook",
  twitter: "Twitter/X",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  intro: "片头",
  outro: "片尾",
  promo: "推广",
  "lower-third": "下三分之一字幕",
  slideshow: "幻灯片",
  custom: "自定义",
};

const PLATFORM_LABELS: Record<string, string> = {
  General: "通用",
  "Vertical (9:16)": "竖屏（9:16）",
  "Square (1:1)": "方形（1:1）",
  "Horizontal (16:9)": "横屏（16:9）",
  Other: "其他",
};

export function getSocialCategoryLabel(
  category: SocialMediaCategory,
  fallback?: string,
): string {
  return SOCIAL_CATEGORY_LABELS[category] ?? fallback ?? category;
}

export function getPlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}
