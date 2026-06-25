import { AppProvider } from './context/AppContext'
import { DeviceConnectionProvider } from './context/DeviceConnectionContext'
import { AppRoutes } from './routes/AppRoutes'
import { ToastProvider } from './ui'

function App() {
  return (
    <AppProvider>
      <DeviceConnectionProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </DeviceConnectionProvider>
    </AppProvider>
  )
}

export default App
