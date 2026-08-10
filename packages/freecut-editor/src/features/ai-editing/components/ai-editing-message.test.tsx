import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { AiEditingMessageBubble } from './ai-editing-message'

describe('AiEditingMessageBubble', () => {
  it('shows the message creation time and preserves the copy action', () => {
    const message = {
      id: 'message-1',
      role: 'assistant' as const,
      content: '已完成开场片段整理。',
      createdAt: Date.UTC(2026, 7, 10, 2, 5),
    }
    const onCopy = vi.fn()
    const { container } = render(
      <AiEditingMessageBubble message={message} copied={false} onCopy={onCopy} />,
    )

    const timestamp = container.querySelector('time')
    expect(timestamp).not.toBeNull()
    expect(timestamp).toHaveAttribute('dateTime', '2026-08-10T02:05:00.000Z')
    expect(timestamp).toHaveTextContent(
      new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(message.createdAt)),
    )

    fireEvent.click(screen.getByRole('button', { name: '复制聊天记录' }))
    expect(onCopy).toHaveBeenCalledWith(message)
  })
})
