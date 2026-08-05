import { Navigate, Route, Routes } from 'react-router-dom'
import { ConnectScreen } from './auth/ConnectScreen'
import { RequireAuth } from './auth/RequireAuth'
import { ScopePicker } from './features/scope-picker/ScopePicker'
import { OrgDashboard, RepoDashboard } from './features/dashboard/Dashboard'

function App() {
  return (
    <Routes>
      <Route path="/connect" element={<ConnectScreen />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <ScopePicker />
          </RequireAuth>
        }
      />
      <Route
        path="/o/:org"
        element={
          <RequireAuth>
            <OrgDashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/r/:owner/:repo"
        element={
          <RequireAuth>
            <RepoDashboard />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
