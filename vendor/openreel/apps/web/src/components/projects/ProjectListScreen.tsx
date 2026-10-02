import { useCallback, useState } from "react";
import { Plus } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useRouter } from "../../hooks/use-router";
import { RecentProjects } from "../welcome/RecentProjects";
import { StartFromScratch } from "../welcome/StartFromScratch";

export const ProjectListScreen: React.FC = () => {
  const { navigate } = useRouter();
  const [showCreateForm, setShowCreateForm] = useState(false);

  const handleProjectSelected = useCallback((projectId?: string) => {
    navigate(projectId ? "luna-editor" : "editor", projectId ? { projectId } : undefined);
  }, [navigate]);

  const handleProjectCreated = useCallback((projectId?: string) => {
    navigate(projectId ? "luna-editor" : "editor", projectId ? { projectId } : undefined);
  }, [navigate]);

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      <main className="flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto w-full max-w-5xl">
          {showCreateForm ? (
            <section className="rounded-xl border border-border bg-background-secondary p-6">
              <div className="mb-6 flex items-center justify-between gap-4">
                <Text type="body" color="primary" weight="semibold" className="text-lg text-text-primary">
                  新建项目
                </Text>
                <Button
                  label="取消"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateForm(false)}
                />
              </div>
              <StartFromScratch onProjectCreated={handleProjectCreated} />
            </section>
          ) : (
            <section>
              <div className="mb-6 flex items-end justify-between gap-4">
                <div>
                  <Text type="body" color="primary" weight="semibold" className="text-2xl text-text-primary">
                    我的项目
                  </Text>
                  <Text type="supporting" color="secondary" className="text-sm text-text-muted mt-1">
                    选择一个项目继续编辑
                  </Text>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    label="新建项目"
                    variant="secondary"
                    size="sm"
                    icon={<Plus size={16} aria-hidden />}
                    onClick={() => setShowCreateForm(true)}
                  />
                </div>
              </div>
              <RecentProjects onProjectSelected={handleProjectSelected} />
            </section>
          )}
        </div>
      </main>
    </div>
  );
};

export default ProjectListScreen;
