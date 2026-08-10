import { memo } from 'react'

const MAX_VISIBLE_LINES = 4
const MAX_VISIBLE_CHARACTERS = 1_200

function recentOutput(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .slice(-MAX_VISIBLE_LINES)
    .join('\n')
    .slice(-MAX_VISIBLE_CHARACTERS)
}

export const AiEditingStreamPreview = memo(function AiEditingStreamPreview({
  text,
}: {
  text: string
}) {
  const output = recentOutput(text)
  if (!output) return null

  return (
    <pre
      className="mt-2 max-h-20 overflow-hidden whitespace-pre-wrap break-words border-t border-border/70 pt-2 font-sans text-[11px] leading-5 text-foreground/75"
      aria-label="剪辑助手实时输出"
    >
      {output}
    </pre>
  )
})
