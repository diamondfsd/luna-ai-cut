import { useMemo, type ReactNode } from 'react'

interface MarkdownViewerProps {
  content: string
  className?: string
}

type LineType =
  | { type: 'h2'; text: string }
  | { type: 'h3'; text: string }
  | { type: 'hr' }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'code'; lang: string; code: string }
  | { type: 'p'; text: string }

function parseInline(text: string): ReactNode[] {
  const parts: ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    // 粗体 **text**
    const boldMatch = remaining.match(/^(.+?)?\*\*(.+?)\*\*(.*)$/s)
    if (boldMatch) {
      if (boldMatch[1]) parts.push(<span key={key++}>{boldMatch[1]}</span>)
      parts.push(<strong key={key++}>{boldMatch[2]}</strong>)
      remaining = boldMatch[3]
      continue
    }
    // 行内代码 `code`
    const codeMatch = remaining.match(/^(.+?)?`(.+?)`(.*)$/s)
    if (codeMatch) {
      if (codeMatch[1]) parts.push(<span key={key++}>{codeMatch[1]}</span>)
      parts.push(<code key={key++}>{codeMatch[2]}</code>)
      remaining = codeMatch[3]
      continue
    }
    // 链接 [text](url)
    const linkMatch = remaining.match(/^(.+?)?\[(.+?)\]\((.+?)\)(.*)$/s)
    if (linkMatch) {
      if (linkMatch[1]) parts.push(<span key={key++}>{linkMatch[1]}</span>)
      parts.push(<a key={key++} href={linkMatch[3]} target="_blank" rel="noopener noreferrer">{linkMatch[2]}</a>)
      remaining = linkMatch[4]
      continue
    }
    // 普通文本
    parts.push(<span key={key++}>{remaining}</span>)
    break
  }

  return parts
}

function parseLines(content: string): LineType[] {
  const lines = content.split('\n')
  const blocks: LineType[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 水平线
    if (/^---+$/.test(line) || /^\*{3,}$/.test(line)) {
      blocks.push({ type: 'hr' })
      continue
    }

    // 标题 h2
    const h2Match = line.match(/^## (.+)/)
    if (h2Match) {
      blocks.push({ type: 'h2', text: h2Match[1] })
      continue
    }

    // 标题 h3
    const h3Match = line.match(/^### (.+)/)
    if (h3Match) {
      blocks.push({ type: 'h3', text: h3Match[1] })
      continue
    }

    // 代码块
    const codeStart = line.match(/^```(\w*)/)
    if (codeStart) {
      const lang = codeStart[1]
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') })
      continue
    }

    // 无序列表（收集连续项）
    if (/^[-*] /.test(line)) {
      const items: string[] = [line.replace(/^[-*] /, '')]
      i++
      while (i < lines.length && /^[-*] /.test(lines[i])) {
        items.push(lines[i].replace(/^[-*] /, ''))
        i++
      }
      i--
      blocks.push({ type: 'ul', items })
      continue
    }

    // 有序列表（收集连续项）
    if (/^\d+\. /.test(line)) {
      const items: string[] = [line.replace(/^\d+\. /, '')]
      i++
      while (i < lines.length && /^\d+\. /.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\. /, ''))
        i++
      }
      i--
      blocks.push({ type: 'ol', items })
      continue
    }

    // 空行跳过
    if (line.trim() === '') continue

    // 段落
    blocks.push({ type: 'p', text: line })
  }

  return blocks
}

export function MarkdownViewer({ content, className = '' }: MarkdownViewerProps) {
  const blocks = useMemo(() => parseLines(content), [content])

  return (
    <div className={`markdown-viewer ${className}`}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'h2':
            return <h2 key={i}>{parseInline(block.text)}</h2>
          case 'h3':
            return <h3 key={i}>{parseInline(block.text)}</h3>
          case 'hr':
            return <hr key={i} />
          case 'ul':
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{parseInline(item)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{parseInline(item)}</li>
                ))}
              </ol>
            )
          case 'code':
            return (
              <pre key={i}>
                <code>{block.code}</code>
              </pre>
            )
          case 'p':
            return <p key={i}>{parseInline(block.text)}</p>
          default:
            return null
        }
      })}
    </div>
  )
}
