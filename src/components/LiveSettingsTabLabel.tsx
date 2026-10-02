import './LiveSettingsTabLabel.css'

export function LiveSettingsTabLabel({ label, modified }: { label: string; modified: boolean }) {
  return <span className="live-settings-tab-label" aria-label={modified ? `${label}，已调整` : undefined}>
    {label}
    {modified && <span className="live-settings-tab-dot" aria-hidden="true" />}
  </span>
}
