import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { i18n } from '@freecut/i18n'
import { ProjectNotFoundError } from './route-error-cause'
import { RouteErrorScreen } from './route-error'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  useRouter: () => ({ invalidate: vi.fn() }),
}))

describe('RouteErrorScreen', () => {
  const writeText = vi.fn<() => Promise<void>>()

  beforeEach(async () => {
    await i18n.changeLanguage('zh')
    writeText.mockReset()
    writeText.mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
  })

  it('turns a missing project into a recovery path with copyable diagnostics', async () => {
    render(<RouteErrorScreen error={new ProjectNotFoundError('project-123')} reset={vi.fn()} />)

    expect(screen.getByRole('heading', { name: '找不到此项目' })).toBeTruthy()
    expect(screen.queryByText('Project not found: project-123')).toBeNull()
    expect(screen.getByRole('link', { name: '返回项目列表' }).getAttribute('href')).toBe(
      '/projects',
    )

    fireEvent.click(screen.getByRole('button', { name: '复制错误详情' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('Error: ProjectNotFoundError: Project not found: project-123'),
    )
    expect(screen.getByRole('button', { name: '已复制错误详情' })).toBeTruthy()
  })
})
