import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Check, Clapperboard, Copy, FileVideo, FolderKanban } from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import { cn } from '@freecut/shared/ui/cn'
import { describeAiEditingReference } from '../resource-references'
import type { AiEditingMessage } from '../store'

function ReferenceIcon({ kind }: { kind: NonNullable<AiEditingMessage['references']>[number]['kind'] }) {
  if (kind === 'project') return <FolderKanban className="h-3 w-3" aria-hidden="true" />
  if (kind === 'media') return <FileVideo className="h-3 w-3" aria-hidden="true" />
  return <Clapperboard className="h-3 w-3" aria-hidden="true" />
}

const markdownClassName = [
  'min-w-0 break-words',
  '[&_p]:my-0 [&_p+p]:mt-2',
  '[&_h1]:mb-2 [&_h1]:text-sm [&_h1]:font-semibold',
  '[&_h2]:mb-1.5 [&_h2]:text-[13px] [&_h2]:font-semibold',
  '[&_h3]:mb-1 [&_h3]:text-xs [&_h3]:font-semibold',
  '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:space-y-0.5 [&_ul]:pl-4',
  '[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:space-y-0.5 [&_ol]:pl-4',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[11px]',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-black/10 [&_pre]:p-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-left',
  '[&_th]:border [&_th]:border-border/70 [&_th]:px-1.5 [&_th]:py-1 [&_th]:font-medium',
  '[&_td]:border [&_td]:border-border/70 [&_td]:px-1.5 [&_td]:py-1',
].join(' ')

export const AiEditingMessageBubble = memo(function AiEditingMessageBubble({
  message,
  copied,
  onCopy,
}: {
  message: AiEditingMessage
  copied: boolean
  onCopy: (message: AiEditingMessage) => void
}) {
  const isUser = message.role === 'user'
  return (
    <div className={cn('group flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn('relative max-w-[88%] rounded-lg px-2.5 py-1.5 pr-8 text-xs leading-relaxed', isUser ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-foreground')}>
        <div className={markdownClassName}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
            {message.content}
          </ReactMarkdown>
        </div>
        {message.references && message.references.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1" aria-label="引用的编辑资源">
            {message.references.map((reference) => (
              <span
                key={`${reference.kind}:${reference.id}`}
                className={cn('inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px]', isUser ? 'border-primary-foreground/30 bg-primary-foreground/10' : 'border-border bg-background/50')}
                title={describeAiEditingReference(reference)}
              >
                <ReferenceIcon kind={reference.kind} />
                <span className="truncate">{reference.label}</span>
              </span>
            ))}
          </div>
        )}
        <Button
          size="icon"
          variant="ghost"
          className={cn('absolute right-1 top-1 h-6 w-6 opacity-55 transition-opacity hover:opacity-100 focus-visible:opacity-100', isUser ? 'text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground' : 'text-muted-foreground')}
          onClick={() => onCopy(message)}
          aria-label={copied ? '已复制聊天记录' : '复制聊天记录'}
          data-tooltip={copied ? '已复制' : '复制'}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  )
})
