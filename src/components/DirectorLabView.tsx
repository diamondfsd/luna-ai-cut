import { useEffect } from 'react'
import { ArrowLeft, Box, FolderSync, FolderDown, FolderOpen, ListFilter, Pencil, RefreshCw, Save, Search, WandSparkles, X, FileUp } from 'lucide-react'
import { DirectorMaterialSyncControl } from './DirectorMaterialSyncControl'
import { Button, IconButton, Input, LoadingIndicator, Select, Tooltip } from '../ui'
import { DirectorMediaPreviewDialog } from './DirectorMediaPreviewDialog'
import { DirectorPlanDeleteControl } from './DirectorPlanDeleteControl'
import { DirectorLabPlanList } from './DirectorLabPlanList'
import { DirectorLabShotList } from './DirectorLabShotList'
import { DirectorPlanConflictDialog } from './DirectorPlanConflictDialog'
import { DirectorPlanImportDialog } from './DirectorPlanImportDialog'
import { DirectorPlanMainContent } from './DirectorPlanMainContent'
import { useDirectorLab } from '../hooks/useDirectorLab'
import '../styles/lab.css'
import './DirectorLabView.css'

interface DirectorLabViewProps {
  active: boolean
}

function formatPlanCreatedAt(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}


export function DirectorLabView({ active }: DirectorLabViewProps) {
  const {
    handlePlanDeleted,
    connectedEndpoint,
    schema,
    importOpen,
    setImportOpen,
    plans,
    setActivePlanId,
    shotQuery,
    setShotQuery,
    shotSort,
    setShotSort,
    editingPlanTitle,
    setEditingPlanTitle,
    planTitleDraft,
    setPlanTitleDraft,
    savingPlanTitle,
    setPreviewTakeId,
    loading,
    downloading,
    downloadProgress,
    activePlan,
    previewTake,
    previewShot,
    planShotCount,
    availableShotCount,
    availableTakeCount,
    missingTakeCount,
    visibleShots,
    setPlanWritePending,
    refreshLocalPlans,
    mergeLocalPlanCopies,
    conflictsOpen,
    setConflictsOpen,
    materialSyncControl,
    syncStatus,
    retrySynchronization,
    writeFailures,
    conflicts,
    resolvingPlanId,
    resolveConflict,
    handleLocalPlanChange,
    loadPlans,
    download,
    downloadPlan,
    copyAiPrompt,
    beginPlanTitleEdit,
    savePlanTitleEdit,
    openLocalPlanDirectory,
    syncStatusLabel,
  } = useDirectorLab(active)

  useEffect(() => {
    if (!active) return
    const refresh = () => { void refreshLocalPlans() }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [active, refreshLocalPlans])

  return (
    <div className="lab-page lab-director-page">
      <header className="lab-director-page-header">
        <div className="lab-title-block">
          {activePlan && <Tooltip content="返回计划列表">
            <IconButton
              variant="ghost"
              size="compact"
              icon={<ArrowLeft size={15} />}
              aria-label="返回计划列表"
              onClick={() => {
                setActivePlanId(null)
                setEditingPlanTitle(false)
                setPreviewTakeId(null)
                setShotQuery('')
                setShotSort('order')
              }}
            />
          </Tooltip>}
          <h1>AI导拍</h1>
        </div>
        <div className="lab-director-sync-actions">
          {!activePlan && <Button size="compact" variant="secondary" icon={<FileUp size={15} />}
            onClick={() => setImportOpen(true)}>新建计划</Button>}
          {connectedEndpoint && (
            <>
            <Tooltip content={writeFailures.length ? writeFailures.map((failure) => `${failure.title}：${failure.message}`).join('\n') : syncStatusLabel}><span
              className={`lab-sync-status is-${syncStatus}`}
              aria-live="polite"
            >
              {syncStatusLabel}
            </span></Tooltip>
            {conflicts.length > 0 && <Button size="compact" onClick={() => setConflictsOpen(true)}>
              处理冲突 ({conflicts.length})
            </Button>}
            <Tooltip content="刷新导演计划">
              <IconButton
                variant="outline"
                size="compact"
                icon={<RefreshCw size={15} />}
                aria-label="刷新导演计划"
                disabled={loading}
                onClick={() => void loadPlans(connectedEndpoint).then(() => retrySynchronization())}
              />
            </Tooltip>
            </>
          )}
        </div>
      </header>

      {loading && plans.length === 0 && (
        <div className="lab-director-state">
          <LoadingIndicator label="正在同步导演计划" />
        </div>
      )}

      {!loading && plans.length === 0 && (
        <div className="lab-director-state">
          <Box size={24} />
          <strong>暂无导演计划</strong>
        </div>
      )}

      {!activePlan && plans.length > 0 && (
        <DirectorLabPlanList
          plans={plans}
          onDeleted={handlePlanDeleted}
          deletingDisabled={downloading != null || syncStatus === 'syncing'}
          onSelect={(planId) => {
            setActivePlanId(planId)
            setShotQuery('')
            setShotSort('order')
            setEditingPlanTitle(false)
          }}
        />
      )}

      {activePlan && (
        <section className="lab-plan-shell">
          <header className="lab-plan-header">
            <div className="lab-plan-heading-main">
              <div className="lab-plan-title-row">
                {editingPlanTitle ? (
                  <Input
                    aria-label="计划名称"
                    variant="compact"
                    className="lab-plan-title-input"
                    value={planTitleDraft}
                    maxLength={120}
                    onChange={(event) => setPlanTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void savePlanTitleEdit()
                      if (event.key === 'Escape') setEditingPlanTitle(false)
                    }}
                  />
                ) : <h2>{activePlan.title}</h2>}
                {schema && (
                  editingPlanTitle ? (
                    <>
                      <Tooltip content="保存计划名称">
                        <IconButton
                          variant="outline"
                          size="compact"
                          icon={<Save size={14} />}
                          aria-label="保存计划名称"
                          disabled={savingPlanTitle || !planTitleDraft.trim()}
                          onClick={() => void savePlanTitleEdit()}
                        />
                      </Tooltip>
                      <Tooltip content="取消重命名">
                        <IconButton
                          variant="ghost"
                          size="compact"
                          icon={<X size={14} />}
                          aria-label="取消重命名"
                          disabled={savingPlanTitle}
                          onClick={() => setEditingPlanTitle(false)}
                        />
                      </Tooltip>
                    </>
                  ) : (
                    <Tooltip content="重命名计划">
                      <IconButton
                        variant="ghost"
                        size="compact"
                        icon={<Pencil size={14} />}
                        aria-label="重命名计划"
                        onClick={beginPlanTitleEdit}
                      />
                    </Tooltip>
                  )
                )}
              </div>
              <div className="lab-plan-meta">
                <span>{availableShotCount}/{planShotCount} 个镜头已有素材</span>
                <span>{missingTakeCount > 0
                  ? `${availableTakeCount} 段可用 · ${missingTakeCount} 段缺失`
                  : `${availableTakeCount} 段可用素材`}</span>
                <span>创建于 {formatPlanCreatedAt(activePlan.created_at)}</span>
                <DirectorPlanMainContent key={activePlan.id} plan={activePlan} onSaved={handleLocalPlanChange}
                  onWriteStateChange={setPlanWritePending} refreshPlans={async () => {
                    const local = await refreshLocalPlans()
                    mergeLocalPlanCopies(local)
                    return local
                  }} />
              </div>
            </div>
            <div className="lab-director-actions">
              <DirectorPlanDeleteControl plan={activePlan} onDeleted={handlePlanDeleted}
                disabled={downloading != null || savingPlanTitle || syncStatus === 'syncing'} />
              {activePlan.local_directory && (
                <IconButton
                  variant="outline"
                  size="compact"
                  icon={<FolderOpen size={15} />}
                  aria-label="打开素材文件夹"
                  title="打开素材文件夹"
                  onClick={() => void openLocalPlanDirectory()}
                />
              )}
              <DirectorMaterialSyncControl {...materialSyncControl} />
              {connectedEndpoint && (!activePlan.local_directory || activePlan.update_available) && (
                <Button
                  variant={activePlan.update_available ? 'primary' : 'secondary'}
                  size="compact"
                  icon={<FolderDown size={15} />}
                  disabled={downloading != null}
                  onClick={() => void downloadPlan(activePlan)}
                >
                  {downloading === `plan:${activePlan.id}`
                    ? '下载中'
                    : activePlan.update_available
                      ? '更新本地副本'
                      : '下载到文件夹'}
                </Button>
              )}
              <Button
                variant="secondary"
                size="compact"
                icon={<WandSparkles size={15} />}
                onClick={() => void copyAiPrompt()}
              >
                AI 提示词
              </Button>
              {activePlan.update_available && (
                <span className="lab-update-badge">
                  <FolderSync size={13} /> 本地副本待更新
                </span>
              )}
            </div>
          </header>
          {downloadProgress && (downloadProgress.phase !== 'done' || downloading != null) && (
            <div className="lab-download-progress">
              <span>{downloadProgress.currentFile ?? '正在准备素材'}</span>
              <strong>{downloadProgress.percent}%</strong>
              <div><i style={{ width: `${downloadProgress.percent}%` }} /></div>
            </div>
          )}
          <div className="lab-director-workspace">
            <div className="lab-director-content">
              <DirectorLabShotList
                onImportShots={() => setImportOpen(true)}
                tools={
                  <div className="lab-director-tools">
                    <Input
                      aria-label="搜索镜头、属性或素材"
                      variant="compact"
                      icon={<Search size={14} />}
                      wrapperClassName="lab-shot-search"
                      placeholder="搜索镜头 / 属性 / 素材"
                      value={shotQuery}
                      onChange={(event) => setShotQuery(event.target.value)}
                    />
                    <Select
                      variant="compact"
                      icon={<ListFilter size={14} />}
                      placeholder="排序方式"
                      value={shotSort}
                      onValueChange={setShotSort}
                      options={[
                        { value: 'order', label: '按镜头序号' },
                        { value: 'name', label: '按名称' },
                        { value: 'takes', label: '按素材数量' },
                      ]}
                      className="lab-shot-sort"
                    />
                  </div>
                }
                schema={schema}
                plan={activePlan}
                phoneConnected={Boolean(connectedEndpoint)}
                shots={visibleShots}
                onLocalPlanChange={handleLocalPlanChange}
                refreshPlans={async () => {
                  const local = await refreshLocalPlans()
                  mergeLocalPlanCopies(local)
                  return local
                }}
                onWriteStateChange={setPlanWritePending}
                onOpenTake={(take) => setPreviewTakeId(take.id)}
              />
            </div>
          </div>
        </section>
      )}
      <DirectorPlanImportDialog open={importOpen} targetPlan={activePlan} onOpenChange={setImportOpen} onImported={(plan) => {
        handleLocalPlanChange(plan)
        setActivePlanId(plan.id)
        setShotQuery('')
        setShotSort('order')
        setEditingPlanTitle(false)
        setPreviewTakeId(null)
      }} />
      <DirectorPlanConflictDialog
        open={conflictsOpen}
        onOpenChange={setConflictsOpen}
        conflicts={conflicts}
        resolvingPlanId={resolvingPlanId}
        onResolve={resolveConflict}
      />
      {previewTake && previewShot && activePlan && (
        <DirectorMediaPreviewDialog
          plan={activePlan}
          onLocalPlanChange={handleLocalPlanChange}
          onWriteStateChange={setPlanWritePending}
          take={previewTake}
          shot={previewShot}
          takes={previewShot.takes}
          planTitle={activePlan.title}
          phoneConnected={Boolean(connectedEndpoint)}
          downloading={downloading === `take:${previewTake.id}`}
          downloadProgress={downloadProgress}
          onSelectTake={(take) => {
            setPreviewTakeId(take.id)
          }}
          onDownload={(take) => {
            const shotIndex = activePlan.shots.findIndex((shot) =>
              shot.takes.some((item) => item.id === take.id))
            const shot = activePlan.shots[shotIndex]
            const takeIndex = shot?.takes.findIndex((item) => item.id === take.id) ?? -1
            void download(
              `take:${take.id}`,
              take.download_url,
              take.file_name,
              activePlan.title,
              {
                shotOrder: shot?.order ?? shotIndex + 1,
                shotName: shot?.name ?? 'shot',
                takeIndex: takeIndex + 1,
                takeId: take.id,
                plan: activePlan,
              },
            )
          }}
          onClose={() => setPreviewTakeId(null)}
        />
      )}
    </div>
  )
}
