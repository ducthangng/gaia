import { Printer } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { Button } from '../components/ui'
import { byTime } from '../domain/route'
import { dayLabel, money, SESSION_LABEL, shortDate, weekDates } from '../domain/time'
import { teacherLabel, type Lesson, type Teacher } from '../domain/types'
import { useWeekContext, weekCosts, type Ctx } from '../hooks'

const labelOf = (t: Teacher | undefined, id: string) => (t ? teacherLabel(t) : id)
const statusText = (l: Lesson) => (l.status === 'school_off' ? 'Trường báo nghỉ' : l.status === 'cancelled' ? 'Huỷ do GV nghỉ' : l.status === 'needs_cover' ? 'Cần giáo viên' : l.type === 'substitute' ? 'Dạy thay' : l.type === 'makeup' ? 'Dạy bù' : '')
const time = (l: Lesson) => (l.start && l.end ? `${l.start}–${l.end}` : `Tiết ${l.period}`)

function Table({ head, rows }: { head: string[]; rows: (string | number | null)[][] }) {
  return (
    <table className="w-full border-collapse text-[11px]">
      <thead><tr>{head.map((h) => <th key={h} className="border border-slate-400 bg-slate-100 px-1.5 py-1 text-left">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="border border-slate-300 px-1.5 py-0.5">{c}</td>)}</tr>)}</tbody>
    </table>
  )
}

const teacherTable = (ctx: Ctx, id: string) => ctx.week.lessons.filter((l) => l.teacherId === id && l.status !== 'replaced').sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b)).map((l) => [dayLabel(l.date), SESSION_LABEL[l.session], time(l), ctx.schoolById.get(l.schoolId)?.fullName ?? '', l.className, l.subject, statusText(l)])
const schoolTable = (ctx: Ctx, id: string) => ctx.week.lessons.filter((l) => l.schoolId === id && l.status !== 'replaced').sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b)).map((l) => [dayLabel(l.date), SESSION_LABEL[l.session], time(l), l.className, l.subject, l.teacherId ? labelOf(ctx.teacherById.get(l.teacherId), l.teacherId) : '', statusText(l)])
const T_HEAD = ['Ngày', 'Buổi', 'Giờ', 'Trường', 'Lớp', 'Môn', 'Ghi chú']
const S_HEAD = ['Ngày', 'Buổi', 'Giờ', 'Lớp', 'Môn', 'Giáo viên', 'Ghi chú']

/** PDF qua hộp thoại in của trình duyệt: hiển thị đúng tiếng Việt mà không phải nhúng font vào thư viện PDF. */
export function PrintPage() {
  const { kind, id } = useParams()
  const ctx = useWeekContext()
  const range = `${shortDate(ctx.week.startDate)} – ${shortDate(ctx.week.endDate)}`
  const dates = weekDates(ctx.week.startDate)
  let body
  if (kind === 'teacher' && id) {
    body = <><h1 className="mb-2 text-base font-bold">Lịch dạy {labelOf(ctx.teacherById.get(id), id)} · {range}</h1><Table head={T_HEAD} rows={teacherTable(ctx, id)} /></>
  } else if (kind === 'school' && id) {
    body = <><h1 className="mb-2 text-base font-bold">{ctx.schoolById.get(id)?.fullName} · {range}</h1><Table head={S_HEAD} rows={schoolTable(ctx, id)} /></>
  } else if (kind === 'costs') {
    const rows = weekCosts(ctx).filter((c) => c.km > 0 || c.cost > 0).sort((a, b) => b.cost - a.cost)
    body = <><h1 className="mb-2 text-base font-bold">Chi phí di chuyển · {range}</h1>
      <Table head={['Giáo viên', ...dates.map(dayLabel), 'Km', 'Tổng']} rows={[...rows.map((c) => [labelOf(ctx.teacherById.get(c.teacherId), c.teacherId), ...c.days.map((d) => (d.cost ? d.cost.toLocaleString('vi-VN') : '')), Math.round(c.km), money(c.cost)]), ['Tổng cộng', ...dates.map(() => ''), Math.round(rows.reduce((s, c) => s + c.km, 0)), money(rows.reduce((s, c) => s + c.cost, 0))]]} /></>
  } else {
    const schools = ctx.world.schools.filter((s) => ctx.week.lessons.some((l) => l.schoolId === s.id))
    body = <><h1 className="mb-3 text-base font-bold">Lịch toàn trung tâm · {range}</h1>
      {schools.map((s) => <section key={s.id} className="mb-4"><h2 className="mb-1 text-[12px] font-semibold">{s.fullName}</h2><Table head={S_HEAD} rows={schoolTable(ctx, s.id)} /></section>)}</>
  }
  return (
    <div className="mx-auto max-w-5xl bg-white p-4">
      <div className="no-print mb-3 flex items-center gap-3">
        <Button variant="primary" onClick={() => window.print()}><Printer size={14} />In / Lưu thành PDF</Button>
        <span className="text-slate-500">Chọn "Lưu thành PDF" trong hộp thoại in.</span>
      </div>
      {body}
    </div>
  )
}
