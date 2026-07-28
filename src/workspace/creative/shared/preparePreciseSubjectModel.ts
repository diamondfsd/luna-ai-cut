import { toast } from '../../../ui'

const PRECISE_SUBJECT_MODEL_ID = 'birefnet-general-lite'

let pendingPreparation: Promise<void> | null = null

async function prepareIfNeeded(): Promise<void> {
  const status = await window.luna.workspace.getSegmentationModelStatus(PRECISE_SUBJECT_MODEL_ID)
  if (status.cached) return

  toast.show('正在准备精准识别，完成后即可使用')
  try {
    await window.luna.workspace.prepareSegmentationModels([PRECISE_SUBJECT_MODEL_ID])
    toast.success('精准识别已准备好')
  } catch (error) {
    toast.error(error instanceof Error ? error.message : '精准识别准备失败，请稍后重试')
    throw error
  }
}

export function preparePreciseSubjectModelIfNeeded(): Promise<void> {
  if (pendingPreparation) return pendingPreparation
  pendingPreparation = prepareIfNeeded().finally(() => {
    pendingPreparation = null
  })
  return pendingPreparation
}
