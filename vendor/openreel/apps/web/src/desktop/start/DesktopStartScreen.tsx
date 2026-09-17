import type { JSX } from "react";
import { useState, useEffect, useCallback } from "react";
import { ToolcraftBadge } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftHeading as Heading } from "@openreel/ui";
import { ToolcraftSelectableCard as SelectableCard } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { Box, Smartphone, Monitor, Square, Film } from "@/icons/lucide-compat";

import { OpenReelMark } from "../brand/OpenReelMark";
import { Icon } from "@/icons/Icon";
import {
  DESKTOP_FORMATS,
  startNewProject,
  startNewMotionProject,
  listRecentProjects,
  openRecentProject,
  type NewProjectFormat,
  type RecentEntry,
} from "./desktop-project-actions";
import { useUIStore } from "../../stores/ui-store";

const FORMAT_ICONS: Record<string, React.ElementType> = {
  vertical: Smartphone,
  horizontal: Monitor,
  square: Square,
};

function formatDimensions(format: NewProjectFormat): string {
  return `${format.width} × ${format.height} · ${format.frameRate}fps`;
}

function formatSavedAt(savedAt: number): string {
  const date = new Date(savedAt);
  const diffDays = Math.floor((Date.now() - savedAt) / (1000 * 60 * 60 * 24));
  if (diffDays <= 0) return "今天";
  if (diffDays === 1) return "昨天";
  if (diffDays < 7) return `${diffDays} 天前`;
  return date.toLocaleDateString("zh-CN");
}

const FORMAT_LABELS: Record<string, string> = {
  vertical: "竖屏",
  horizontal: "横屏",
  square: "方形",
};

function formatDisplayLabel(format: NewProjectFormat): string {
  return FORMAT_LABELS[format.id] ?? format.label;
}

type ProjectMode = "edit" | "motion";

export function DesktopStartScreen(): JSX.Element {
  const [recents, setRecents] = useState<RecentEntry[]>([]);
  const [loadingRecents, setLoadingRecents] = useState<boolean>(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [projectMode, setProjectMode] = useState<ProjectMode>("edit");
  const setDesktopPage = useUIStore((state) => state.setDesktopPage);

  useEffect(() => {
    let active = true;
    listRecentProjects()
      .then((entries) => {
        if (active) setRecents(entries);
      })
      .catch(() => {
        if (active) setRecents([]);
      })
      .finally(() => {
        if (active) setLoadingRecents(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleOpenRecent = useCallback(async (saveId: string) => {
    setOpeningId(saveId);
    try {
      setDesktopPage("edit");
      await openRecentProject(saveId);
    } finally {
      setOpeningId(null);
    }
  }, [setDesktopPage]);

  const handleStartProject = useCallback((format: NewProjectFormat) => {
    if (projectMode === "motion") {
      setDesktopPage("motion");
      startNewMotionProject(format);
      return;
    }

    setDesktopPage("edit");
    startNewProject(format);
  }, [projectMode, setDesktopPage]);

  const formatModeLabel = projectMode === "motion" ? "动效设计" : "视频编辑";

  return (
    <div className="h-full overflow-y-auto bg-bg text-fg">
      <div className="mx-auto flex max-w-4xl flex-col gap-10 px-8 py-12">
        <section>
          <div className="flex items-center gap-3">
            <OpenReelMark size={28} className="text-accent" />
            <Heading level={1}>新建项目</Heading>
          </div>
          <Text type="supporting" display="block" className="mt-1">
            选择工作区和格式，之后仍可更改。
          </Text>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectableCard
              label="视频编辑"
              isSelected={projectMode === "edit"}
              onChange={() => setProjectMode("edit")}
              padding={5}
            >
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-md bg-accent-soft text-accent">
                  <Film size={22} aria-hidden />
                </span>
                <span>
                  <Text type="large" weight="bold" display="block">
                    视频编辑
                  </Text>
                  <Text type="supporting" display="block" className="mt-1">
                    快速剪辑、裁切、添加字幕、调色和导出。
                  </Text>
                </span>
              </div>
            </SelectableCard>
            <SelectableCard
              label="动效设计"
              isSelected={projectMode === "motion"}
              onChange={() => setProjectMode("motion")}
              padding={5}
            >
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-md bg-accent text-accent-fg">
                  <Box size={22} aria-hidden />
                </span>
                <span>
                  <Text type="large" weight="bold" display="block">
                    动效设计
                  </Text>
                  <Text type="supporting" display="block" className="mt-1">
                    设计动画广告、下三分之一字幕、应用演示和场景图形。
                  </Text>
                </span>
              </div>
            </SelectableCard>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {DESKTOP_FORMATS.map((format) => {
              const FormatIcon = FORMAT_ICONS[format.id] ?? Film;
              const displayLabel = formatDisplayLabel(format);
              return (
                <ClickableCard
                  key={format.id}
                  label={`${displayLabel} ${formatModeLabel}`}
                  onClick={() => handleStartProject(format)}
                  padding={5}
                >
                  <div className="relative flex flex-col items-start gap-3">
                    <Icon
                      name="plus.square"
                      size={16}
                      ariaHidden
                      className="absolute right-0 top-0 text-fg-muted"
                    />
                    <span className="flex h-11 w-11 items-center justify-center rounded-md bg-accent-soft text-accent">
                      <FormatIcon size={22} aria-hidden />
                    </span>
                    <Text type="large" weight="bold" display="block">
                      {displayLabel}
                    </Text>
                    <Text type="code" color="secondary" display="block">
                      {formatDimensions(format)}
                    </Text>
                    <ToolcraftBadge variant="success" label={formatModeLabel} />
                  </div>
                </ClickableCard>
              );
            })}
          </div>
        </section>

        <section>
          <Heading level={2} color="secondary">最近项目</Heading>
          <Card className="mt-3" padding={0}>
            {loadingRecents ? (
              <Text type="supporting" display="block" className="px-4 py-6">
                正在加载最近项目…
              </Text>
            ) : recents.length === 0 ? (
              <Text type="supporting" display="block" className="px-4 py-6">
                暂无最近项目，请先在上方创建新项目。
              </Text>
            ) : (
              <ul className="divide-y divide-border">
                {recents.map((entry) => (
                  <li key={entry.id} className="p-1.5">
                    <ClickableCard
                      label={`打开 ${entry.name}`}
                      isDisabled={openingId === entry.id}
                      onClick={() => handleOpenRecent(entry.id)}
                      padding={2}
                      variant="transparent"
                    >
                      <div className="flex items-center gap-3">
                        <Icon name="clock" size={14} ariaHidden className="text-fg-muted" />
                        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-bg-3 text-fg-muted">
                          <Film size={16} aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <Text type="body" weight="bold" display="block" maxLines={1}>
                            {entry.name}
                          </Text>
                          <Text type="supporting" display="block" className="mt-0.5">
                            {formatSavedAt(entry.savedAt)}
                          </Text>
                        </span>
                      </div>
                    </ClickableCard>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
