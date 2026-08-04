import './PreviewStageError.css'

interface PreviewStageErrorProps {
  detail: string
}

export function PreviewStageError({ detail }: PreviewStageErrorProps) {
  return (
    <section className="preview-stage-error" role="alert" aria-live="assertive">
      <strong>预览加载失败</strong>
      <pre>{detail}</pre>
    </section>
  )
}
