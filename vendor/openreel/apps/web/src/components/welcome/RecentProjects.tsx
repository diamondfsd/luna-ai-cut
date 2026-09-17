import React, { useState, useEffect, useCallback } from "react";
import { Clock, Trash2, Film } from "@/icons/lucide-compat";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { checkForRecovery, type AutoSaveMetadata } from "../../services/auto-save";
import { projectManager } from "../../services/project-manager";
import { useProjectStore } from "../../stores/project-store";
import { useAnalytics, AnalyticsEvents } from "../../hooks/useAnalytics";

interface RecentProject {
  id: string;
  saveId: string;
  name: string;
  lastModified: number;
}

interface RecentProjectsProps {
  onProjectSelected?: (projectId?: string) => void;
}

export const RecentProjects: React.FC<RecentProjectsProps> = ({
  onProjectSelected,
}) => {
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<RecentProject | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const recoverFromAutoSave = useProjectStore(
    (state) => state.recoverFromAutoSave,
  );
  const { track } = useAnalytics();

  useEffect(() => {
    async function loadProjects() {
      try {
        if (window.openreel?.lunaProject) {
          const projects = await projectManager.getRecentProjects();
          setRecentProjects(projects.map((project) => ({
            id: project.id,
            saveId: project.id,
            name: project.name,
            lastModified: project.lastOpened,
          })));
          return;
        }

        const saves = await checkForRecovery();
        const projectMap = new Map<string, AutoSaveMetadata>();

        for (const save of saves) {
          if (!projectMap.has(save.projectId)) {
            projectMap.set(save.projectId, save);
          }
        }

        const projects: RecentProject[] = Array.from(projectMap.values())
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 10)
          .map((save) => ({
            id: save.projectId,
            saveId: save.id,
            name: save.projectName,
            lastModified: save.timestamp,
          }));

        setRecentProjects(projects);
      } catch (error) {
        console.error("Failed to load recent projects:", error);
      } finally {
        setIsLoading(false);
      }
    }

    loadProjects();
  }, []);

  const handleSelectProject = useCallback(
    async (project: RecentProject) => {
      setLoadingProjectId(project.id);
      try {
        let success = false;
        if (window.openreel?.lunaProject) {
          const loaded = await projectManager.loadLunaProject(project.id);
          if (loaded) {
            useProjectStore.getState().loadProject(loaded);
            success = true;
          }
        } else {
          success = await recoverFromAutoSave(project.saveId);
        }
        if (success) {
          track(AnalyticsEvents.PROJECT_OPENED, {
            source: "recent_projects",
          });
          onProjectSelected?.(window.openreel?.lunaProject ? project.id : undefined);
        }
      } catch (error) {
        console.error("Failed to load project:", error);
      } finally {
        setLoadingProjectId(null);
      }
    },
    [recoverFromAutoSave, onProjectSelected, track],
  );

  const handleRequestDelete = useCallback(
    (project: RecentProject, event: React.MouseEvent) => {
      event.stopPropagation();
      setProjectToDelete(project);
    },
    [],
  );

  const handleDeleteProject = useCallback(async () => {
    if (!projectToDelete || isDeleting) return;
    setIsDeleting(true);
    try {
      await projectManager.deleteProject(projectToDelete.id);
      setRecentProjects((prev) => prev.filter((project) => project.id !== projectToDelete.id));
      setProjectToDelete(null);
    } catch (error) {
      console.error("Failed to delete project:", error);
    } finally {
      setIsDeleting(false);
    }
  }, [isDeleting, projectToDelete]);

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffDays = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (diffDays === 0) return "今天";
    if (diffDays === 1) return "昨天";
    if (diffDays < 7) return `${diffDays} 天前`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} 周前`;

    return date.toLocaleDateString("zh-CN");
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
        <Text type="supporting" color="secondary" className="text-sm text-text-secondary">
          正在加载最近项目…
        </Text>
      </div>
    );
  }

  if (recentProjects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <div className="w-14 h-14 rounded-2xl bg-background-tertiary flex items-center justify-center mb-4">
          <Clock size={24} className="text-text-muted" />
        </div>
        <Text type="body" color="primary" weight="medium" className="text-base text-text-primary mb-2">
         暂无最近项目
        </Text>
        <Text type="supporting" color="secondary" className="text-sm text-text-muted text-center max-w-md">
          最近打开的项目会显示在这里。创建新项目或使用模板开始创作。
        </Text>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Text type="label" color="primary" weight="medium" className="text-sm text-text-primary">
          最近项目（{recentProjects.length}）
        </Text>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {recentProjects.map((project) => {
          const isLoadingThis = loadingProjectId === project.id;
          return (
            <div
              key={project.id}
              className="group relative flex flex-col bg-background-tertiary rounded-xl border border-border hover:border-primary/40 hover:bg-background-elevated transition-all overflow-hidden"
            >
              <ClickableCard
                label={`打开 ${project.name}`}
                onClick={() => handleSelectProject(project)}
                isDisabled={isLoadingThis}
                padding={0}
                variant="muted"
                className="flex flex-col flex-1 text-left disabled:opacity-70"
              >
                <div className="aspect-video w-full bg-background flex items-center justify-center border-b border-border">
                  {isLoadingThis ? (
                    <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  ) : (
                    <Film size={32} className="text-text-muted/50 group-hover:text-primary/50 transition-colors" />
                  )}
                </div>

                <div className="p-3 flex-1">
                  <Text type="supporting" color="primary" weight="medium" className="text-sm text-text-primary truncate group-hover:text-primary transition-colors">
                    {project.name}
                  </Text>
                  <div className="flex items-center gap-1.5 mt-1.5 text-xs text-text-muted">
                    <Clock size={11} />
                    <span>{formatDate(project.lastModified)}</span>
                  </div>
                </div>
              </ClickableCard>

              <IconButton
                label="删除项目"
                onClick={(e) => handleRequestDelete(project, e)}
                icon={<Trash2 size={14} aria-hidden />}
                isDisabled={isDeleting}
                size="sm"
                variant="ghost"
                className="absolute top-2 right-2 p-1.5 text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all rounded-lg bg-background/80 hover:bg-red-500/10 backdrop-blur-sm"
              />
            </div>
          );
        })}
      </div>

      {projectToDelete && (
        <Dialog
          isOpen
          onOpenChange={(open) => {
            if (!open && !isDeleting) setProjectToDelete(null);
          }}
          width={448}
          purpose="form"
        >
          <Layout
            header={(
              <DialogHeader
                title="删除项目"
                subtitle={`确认删除“${projectToDelete.name}”？此操作无法恢复。`}
                onOpenChange={(open) => !open && !isDeleting && setProjectToDelete(null)}
                startContent={<Trash2 className="h-5 w-5 text-status-error" aria-hidden />}
              />
            )}
            footer={(
              <LayoutFooter>
                <Button
                  label="取消"
                  variant="secondary"
                  isDisabled={isDeleting}
                  onClick={() => setProjectToDelete(null)}
                />
                <Button
                  label="删除"
                  variant="destructive"
                  isLoading={isDeleting}
                  isDisabled={isDeleting}
                  onClick={() => void handleDeleteProject()}
                />
              </LayoutFooter>
            )}
          />
        </Dialog>
      )}

    </div>
  );
};

export default RecentProjects;
