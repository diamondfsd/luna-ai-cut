import { readAiOutput, writeAiOutput } from './ai-outputs'
import type { EditingEvidencePayload } from './ai-outputs/types'

export async function getEditingEvidence(mediaId: string): Promise<EditingEvidencePayload | undefined> {
  const envelope = await readAiOutput(mediaId, 'editing-evidence')
  return envelope?.data
}

export async function saveVisualEditingEvidence(
  mediaId: string,
  sourceFingerprint: string,
  visual: NonNullable<EditingEvidencePayload['visual']>,
): Promise<void> {
  await writeAiOutput({
    mediaId,
    kind: 'editing-evidence',
    service: 'luna-local-vision',
    model: visual.models.map((model) => `${model.id}@${model.version}`).join(', '),
    params: { sourceFingerprint, sampleCount: visual.samples.length },
    data: { sourceFingerprint, visual },
  })
}
