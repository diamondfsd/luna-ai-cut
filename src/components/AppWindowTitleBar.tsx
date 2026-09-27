import '../styles/app-window-titlebar.css'

export function AppWindowTitleBar() {
  return (
    <div className="app-window-titlebar" aria-hidden="true">
      Luna AI Cut v{__APP_VERSION__}
    </div>
  )
}
