import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AlertsPage } from './pages/Alerts'
import { BoardPage } from './pages/Board'
import { CostsPage } from './pages/Costs'
import { DataPage } from './pages/Data'
import { ImportPage } from './pages/Import'
import { OptimizePage } from './pages/Optimize'
import { PrintPage } from './pages/Print'
import { SchoolsPage } from './pages/Schools'
import { SettingsPage } from './pages/Settings'
import { TeachersPage } from './pages/Teachers'
import { WeeksPage } from './pages/Weeks'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="print/:kind/:id?" element={<PrintPage />} />
        <Route element={<Layout />}>
          <Route index element={<BoardPage />} />
          <Route path="alerts" element={<AlertsPage />} />
          <Route path="optimize" element={<OptimizePage />} />
          <Route path="schools/:id?" element={<SchoolsPage />} />
          <Route path="teachers/:id?" element={<TeachersPage />} />
          <Route path="costs" element={<CostsPage />} />
          <Route path="weeks" element={<WeeksPage />} />
          <Route path="import" element={<ImportPage />} />
          <Route path="data" element={<DataPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
