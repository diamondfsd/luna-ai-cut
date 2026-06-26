import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, Accordion } from '../ui'
import { MarkdownViewer } from '../ui/MarkdownViewer'
import type { ReleaseNoteItem } from '../shared/types'

interface ReleaseNotesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  latestVersion?: string
  latestReleaseNotes?: string
}

export function ReleaseNotesDialog({ open, onOpenChange, latestVersion, latestReleaseNotes }: ReleaseNotesDialogProps) {
  const [notes, setNotes] = useState<ReleaseNoteItem[]>([])

  useEffect(() => {
    if (open) {
      window.luna.listReleaseNotes().then(setNotes).catch(() => setNotes([]))
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="release-notes-dialog-content">
        <DialogHeader>
          <DialogTitle>更新说明</DialogTitle>
        </DialogHeader>
        <div className="release-notes-body">
          {latestReleaseNotes && (
            <Accordion
              title={`v${latestVersion ?? '?'}（最新）`}
              defaultOpen={true}
              headerClassName="release-notes-accordion-header"
            >
              <MarkdownViewer content={latestReleaseNotes} />
            </Accordion>
          )}
          {notes.map((note, i) => (
            <Accordion
              key={note.version}
              title={`v${note.version}`}
              defaultOpen={!latestReleaseNotes && i === 0}
              headerClassName="release-notes-accordion-header"
            >
              <MarkdownViewer content={note.content} />
            </Accordion>
          ))}
          {!latestReleaseNotes && notes.length === 0 && (
            <p className="release-notes-empty">暂无更新说明</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
