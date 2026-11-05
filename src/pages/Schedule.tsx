import { ArrowLeft, Cloud, CloudOff, FileDown, LoaderCircle, Lock } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ReassignConfirm } from '../components/CostExplanation'
import { LeaveDialog } from '../components/LeaveDialog'
import { LessonEditor } from '../components/LessonEditor'
import { TeacherProfileDialog } from '../components/TeacherProfileDialog'
import { Badge, Button, Empty, Toaster } from '../components/ui'
import { WeekTimeGrid } from '../components/WeekTimeGrid'
import { coverage, schoolLoad, touchesSchool } from '../domain/issues'
import { shortDate } from '../domain/time'
import type { Lesson } from '../domain/types'
import { useWeekContext, useWeekIssues } from '../hooks'
import { exportSchoolSchedule } from '../services/exports'
import { useStore } from '../store'
import { API_MODE } from '../sync/api'
import { useSync } from '../sync/engine'

/** Lớp ghép ghi "1.1 + 1.2": lọc theo lớp nào trong đó cũng ra ca này. */
const classesOf = (l: Lesson) => (l.className ? l.className.split('+').map((c) => c.trim()).filter(Boolean) : [])

/**
 * Lịch học trong tuần của một trường, chiếm cả màn hình: không thanh bên, không bản đồ hay gợi ý.
 * Vẫn sửa, gán GV, báo nghỉ được như ở trang Theo trường.
 */
export function SchedulePage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const ctx = useWeekContext()
  const weeks = useStore((s) => s.weeks)
  const setActiveWeek = useStore((s) => s.setActiveWeek)
  const issues = useWeekIssues(ctx)
  const load = useMemo(() => schoolLoad(ctx.week.lessons), [ctx.week.lessons])
  const schools = [...ctx.world.schools].sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'))
  const school = id ? ctx.schoolById.get(id) : undefined
  const cls = params.get('class') ?? ''

  const all = ctx.week.lessons.filter((l) => l.schoolId === school?.id)
  const classes = [...new Set(all.flatMap(classesOf))].sort((a, b) => a.localeCompare(b, 'vi', { numeric: true }))
  const lessons = cls ? all.filter((l) => classesOf(l).includes(cls)) : all
  const cov = coverage(lessons)

  // Lớp đang lọc không có ở trường/tuần khác: bỏ lọc thay vì hiện lịch trống.
  useEffect(() => {
    if (cls && !classes.includes(cls)) setParams({}, { replace: true })
  }, [cls, classes.join()]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    document.title = school ? `Lịch ${school.fullName} · Gaia` : 'Gaia'
    return () => { document.title = 'Gaia' }
  }, [school])

  if (!school) return <div className="p-8"><Empty>Không tìm thấy trường. <Link className="text-emerald-700 underline" to="/schools">Về danh sách trường</Link></Empty></div>

  return (
    <div className="flex h-full flex-col bg-white">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 px-4 py-2.5">
        <Link to={`/schools/${school.id}`} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100" title="Về trang Theo trường">
          <ArrowLeft size={15} />Quay lại
        </Link>
        <select aria-label="Trường" value={school.id} onChange={(e) => navigate(`/schedule/${e.target.value}`)} className="max-w-[340px] font-semibold">
          {schools.map((s) => <option key={s.id} value={s.id}>{s.fullName}{load.get(s.id) ? ` · ${load.get(s.id)} ca` : ''}</option>)}
        </select>
        <select aria-label="Tuần" value={ctx.week.id} onChange={(e) => setActiveWeek(e.target.value)}>
          {[...weeks].reverse().map((w) => (
            <option key={w.id} value={w.id}>{shortDate(w.startDate)} – {shortDate(w.endDate)} · {w.status === 'planning' ? 'Đang lập' : 'Đã lưu trữ'}</option>
          ))}
        </select>
        {classes.length > 1 && (
          <select aria-label="Lớp" value={cls} onChange={(e) => setParams(e.target.value ? { class: e.target.value } : {})}>
            <option value="">Tất cả lớp</option>
            {classes.map((c) => <option key={c} value={c}>Lớp {c}</option>)}
          </select>
        )}
        {ctx.week.status === 'archived' && <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Lock size={13} />Đã lưu trữ</span>}
        <span className="ml-auto flex items-center gap-2">
          {API_MODE && <SyncDot />}
          <Badge tone={cov.ratio < 1 ? 'red' : 'green'}>Độ phủ {cov.covered}/{cov.required}</Badge>
          <Button onClick={() => exportSchoolSchedule(ctx, school.id)}><FileDown size={14} />Excel</Button>
          <Button onClick={() => window.open(`/print/school/${school.id}`, '_blank')}><FileDown size={14} />PDF</Button>
        </span>
      </header>
      <main className="min-h-0 flex-1">
        {all.length ? (
          <WeekTimeGrid key={`${school.id}|${cls}`} fullPage schoolId={school.id} lessons={lessons} ctx={ctx} issues={issues.filter((i) => touchesSchool(i, school.id))} />
        ) : (
          <div className="p-8"><Empty>Trường không có ca nào trong tuần này.</Empty></div>
        )}
      </main>
      <LeaveDialog />
      <LessonEditor />
      <TeacherProfileDialog />
      <ReassignConfirm />
      <Toaster />
    </div>
  )
}

function SyncDot() {
  const { phase, pending } = useSync()
  if (phase === 'saved') return <span className="inline-flex items-center gap-1 text-xs text-slate-500"><Cloud size={13} />Đã lưu</span>
  if (phase === 'saving') return <span className="inline-flex items-center gap-1 text-xs text-slate-600"><LoaderCircle size={13} className="animate-spin" />Đang lưu</span>
  return <span className="inline-flex items-center gap-1 text-xs text-amber-700"><CloudOff size={13} />{pending} thay đổi chưa lưu</span>
}
