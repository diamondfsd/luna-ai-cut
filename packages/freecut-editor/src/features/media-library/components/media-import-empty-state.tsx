import { FileAudio, Film, Image, Loader2, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@freecut/components/ui/button'
import { getSupportedMediaFormatLabels } from '../utils/media-file-picker'
import './media-import-empty-state.css'

interface MediaImportEmptyStateProps {
  importing: boolean
  onImport: () => void
}

export function MediaImportEmptyState({ importing, onImport }: MediaImportEmptyStateProps) {
  const { t } = useTranslation()

  return (
    <div className="media-import-empty-state" aria-busy={importing}>
      <div className="media-import-empty-state__visual" aria-hidden="true">
        {importing ? (
          <Loader2 className="media-import-empty-state__loader" />
        ) : (
          <Upload className="media-import-empty-state__upload" />
        )}
        <div className="media-import-empty-state__types">
          <Film />
          <FileAudio />
          <Image />
        </div>
      </div>

      <div className="media-import-empty-state__copy">
        <h3>
          {importing ? t('media.grid.importingTitle') : t('media.grid.emptyTitle')}
        </h3>
        <p>
          {importing ? t('media.grid.importingHint') : t('media.grid.emptyHint')}
        </p>
      </div>

      <Button
        type="button"
        variant="editorAction"
        size="sm"
        disabled={importing}
        onClick={onImport}
        className="media-import-empty-state__button"
      >
        {importing ? <Loader2 className="animate-spin" /> : <Upload />}
        {importing ? t('media.grid.importingButton') : t('media.grid.importButton')}
      </Button>

      <div className="media-import-empty-state__formats" aria-label={t('media.grid.supportedFormats')}>
        {getSupportedMediaFormatLabels().map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  )
}

export function MediaImportDropOverlay() {
  const { t } = useTranslation()

  return (
    <div className="media-import-drop-overlay" aria-hidden="true">
      <div className="media-import-drop-overlay__icon">
        <Upload />
      </div>
      <h3>{t('media.library.dropFilesHere')}</h3>
      <p>{t('media.library.dropFilesHint')}</p>
      <div className="media-import-empty-state__formats">
        {getSupportedMediaFormatLabels().map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
    </div>
  )
}
