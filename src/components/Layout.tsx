import clsx from 'clsx'
import { ArchiveRestore, Bell, CalendarOff, Calculator, CalendarRange, Database, GraduationCap, LayoutDashboard, Lock, ScanLine, RotateCcw, School, Settings, ShieldAlert, WandSparkles } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'
import { shortDate } from '../domain/time'
import { useActiveWeek, useStore } from '../store'
import { ISSUE_META } from '../domain/issues'
import { useWeekContext, useWeekIssues } from '../hooks'
import { LeaveDialog, openLeaveDialog } from './LeaveDialog'
import { LessonEditor } from './LessonEditor'
import { ReassignConfirm } from './CostExplanation'
import { openResetDialog, ResetDataDialog } from './ResetDataDialog'
import { NewSchoolDialog } from './NewSchoolDialog'
import { TeacherProfileDialog } from './TeacherProfileDialog'
import { Button, Toaster } from './ui'

const NAV = [
  { to: '/', label: 'Bảng tổng quan', icon: LayoutDashboard, end: true },
  { to: '/alerts', label: 'Cảnh báo', icon: Bell },
  { to: '/optimize', label: 'Tối ưu', icon: WandSparkles },
  { to: '/schools', label: 'Theo trường', icon: School },
  { to: '/teachers', label: 'Theo giáo viên', icon: GraduationCap },
  { to: '/costs', label: 'Chi phí di chuyển', icon: Calculator },
  { to: '/weeks', label: 'Lịch tuần & lưu trữ', icon: CalendarRange },
  { to: '/import', label: 'Nhập ảnh lịch (OCR)', icon: ScanLine },
  { to: '/data', label: 'Nguồn dữ liệu', icon: Database },
  { to: '/settings', label: 'Cấu hình', icon: Settings },
]

export function Layout() {
  const weeks = useStore((s) => s.weeks)
  const setActiveWeek = useStore((s) => s.setActiveWeek)
  const anonymized = useStore((s) => s.anonymized)
  const week = useActiveWeek()
  const archived = week.status === 'archived'
  const issues = useWeekIssues(useWeekContext())
  const urgent = issues.filter((i) => ISSUE_META[i.kind].severity !== 'info').length
  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-5">
          <div className="text-[15px] font-semibold tracking-tight text-emerald-800">Gaia</div>
          <div className="text-xs text-slate-500">Điều phối lịch dạy · Vũng Tàu</div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => clsx('flex items-center gap-3 rounded-md px-3 py-2 font-medium', isActive ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-100')}>
              <Icon size={15} />
              <span className="flex-1">{label}</span>
              {to === '/alerts' && urgent > 0 && <span data-testid="alert-count" className="tnum rounded-full bg-red-600 px-1.5 text-[11px] font-semibold text-white">{urgent}</span>}
            </NavLink>
          ))}
        </nav>
        <button onClick={openResetDialog} data-testid="reset-data" className="mx-3 mb-2 flex items-center gap-3 rounded-md px-3 py-2 text-left font-medium text-slate-600 hover:bg-slate-100">
          <RotateCcw size={15} />Về dữ liệu mới nhất
        </button>
        {anonymized && (
          <div className="m-3 flex gap-2 rounded-md bg-slate-100 p-3 text-xs leading-relaxed text-slate-600">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            Bản demo: không có SĐT và địa chỉ nhà giáo viên.
          </div>
        )}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-8 py-3.5">
          <label className="text-xs font-medium text-slate-500" htmlFor="week-select">Tuần</label>
          <select id="week-select" value={week.id} onChange={(e) => setActiveWeek(e.target.value)} className="font-medium">
            {[...weeks].reverse().map((w) => (
              <option key={w.id} value={w.id}>
                {shortDate(w.startDate)} – {shortDate(w.endDate)} · {w.status === 'planning' ? 'Đang lập' : 'Đã lưu trữ'}
              </option>
            ))}
          </select>
          {archived ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600"><Lock size={13} />Đã đóng băng: chỉ xem và đối soát</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><ArchiveRestore size={13} />Đang lập kế hoạch: có thể chỉnh sửa</span>
          )}
          <Button className="ml-auto" onClick={() => openLeaveDialog({})}><CalendarOff size={14} />Giáo viên xin nghỉ</Button>
        </header>
        <main className="min-h-0 flex-1 overflow-auto px-8 py-7">
          <Outlet />
        </main>
      </div>
      <LeaveDialog />
      <LessonEditor />
      <TeacherProfileDialog />
      <NewSchoolDialog />
      <ReassignConfirm />
      <ResetDataDialog />
      <Toaster />
    </div>
  )
}
