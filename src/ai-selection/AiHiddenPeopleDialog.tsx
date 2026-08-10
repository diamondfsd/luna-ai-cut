import type { AiHiddenPerson } from '../shared/types'
import { Button, Dialog } from '../ui'
import { AiPersonIdentityAvatar } from './AiPersonIdentityAvatar'
import './AiHiddenPeopleDialog.css'

interface AiHiddenPeopleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  people: AiHiddenPerson[]
  busy: boolean
  onRestore: (personId: string) => Promise<boolean>
}

export function AiHiddenPeopleDialog({ open, onOpenChange, people, busy, onRestore }: AiHiddenPeopleDialogProps) {
  return <Dialog
    open={open}
    onOpenChange={onOpenChange}
    title="已隐藏人物"
    description="恢复后，人物会重新出现在所有选片任务的分组中。"
    className="ai-hidden-people-dialog"
    footer={<Button variant="secondary" onClick={() => onOpenChange(false)}>关闭</Button>}
  >
    <div className="ai-hidden-people-list">
      {people.map((person) => <div key={person.id} className="ai-hidden-people-row">
        <AiPersonIdentityAvatar {...person} className="ai-hidden-people-avatar" />
        <strong title={person.name}>{person.name}</strong>
        <Button variant="secondary" size="mini" disabled={busy} onClick={() => void onRestore(person.id)}>恢复</Button>
      </div>)}
      {people.length === 0 && <span className="ai-hidden-people-empty">没有已隐藏的人物</span>}
    </div>
  </Dialog>
}
