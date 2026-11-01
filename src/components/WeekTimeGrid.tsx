import clsx from 'clsx'
import { CalendarClock, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ISSUE_META, type Issue } from '../domain/issues'
import { axisHeight, axisY, buildAxis, isMorning, layoutDay, MIN_VISUAL_MIN, sessionBands } from '../domain/timetable'
import { DAY_LABELS, dayIndex, dayLabel, shortDate, weekDates } from '../domain/time'
import type { Lesson } from '../domain/types'
import type { Ctx } from '../hooks'
import { LessonChip } from './LessonChip'
import { openLessonEditor } from './LessonEditor'
import { Button } from './ui'

const ROW_PX = 29 // Một ô 15 phút: ca 35 phút cao khoảng 67px, đủ 4 dòng chữ
const GAP_PX = 24
const LANE_MIN_PX = 142
const EMPTY_DAY_PX = 70
const TIME_COL_PX = 68
const SESSION_STRIP_PX = 16

// Nền theo buổi: tránh các màu đã dùng cho môn học (vàng, xanh ngọc, tím) và trạng thái (đỏ, xám).
const slotColor = (min: number) => {
  const odd = (min / 15) % 2 === 1
  return isMorning(min) ? (odd ? '#dff0fb' : '#eef7fd') : (odd ? '#fde9d3' : '#fef4e8')
}

const LEGEND: { swatch: string; label: string }[] = [
  { swatch: 'bg-[#dff0fb] border-sky-300', label: 'Buổi sáng' },
  { swatch: 'bg-[#fde9d3] border-orange-300', label: 'Buổi chiều' },
  { swatch: 'bg-amber-50 border-amber-200', label: 'STEM' },
  { swatch: 'bg-teal-50 border-teal-200', label: 'Công dân số / AI' },
  { swatch: 'bg-violet-50 border-violet-200', label: 'Kỹ năng sống' },
  { swatch: 'bg-slate-50 border-slate-200', label: 'Hỗ trợ, chuyên đề' },
  { swatch: 'bg-red-50 border-red-300', label: 'Chưa có giáo viên' },
  { swatch: 'bg-slate-100 border-slate-200', label: 'Nghỉ, huỷ (gạch ngang)' },
  { swatch: 'bg-white border-slate-300 border-l-4 border-l-slate-700', label: 'Dạy thay' },
  { swatch: 'bg-white border-slate-400 border-dashed', label: 'Dạy bù' },
  { swatch: 'bg-white ring-2 ring-red-500 border-transparent', label: 'Trùng lịch' },
  { swatch: 'bg-white ring-2 ring-amber-500 border-transparent', label: 'Không kịp di chuyển' },
]

const label = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/**
 * Lịch dạng lưới giờ. Trường đông ca không thể hiện đủ chữ cả tuần trong một khung,
 * nên mặc định xem từng ngày nếu cả tuần không vừa; vẫn chuyển sang "Cả tuần" được (cuộn ngang).
 */
export function WeekTimeGrid({ schoolId, lessons, ctx, issues, onShowOnMap }: { schoolId: string; lessons: Lesson[]; ctx: Ctx; issues: Issue[]; onShowOnMap: (l: Lesson) => void }) {
  const allDates = weekDates(ctx.week.startDate)
  const withLessons = allDates.filter((d) => lessons.some((l) => l.date === d))
  const weekDays = allDates.filter((d) => dayIndex(d) < 5 || withLessons.includes(d))
  const [choice, setChoice] = useState<string | 'week' | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const observer = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    observer.observe(box.current!)
    return () => observer.disconnect()
  }, [])

  const lanesOn = (d: string) => layoutDay(lessons.filter((l) => l.date === d)).lanes
  const weekWidth = TIME_COL_PX + weekDays.reduce((w, d) => w + (lanesOn(d) ? lanesOn(d) * LANE_MIN_PX : EMPTY_DAY_PX), 0)
  const weekFits = width === 0 || weekWidth <= width
  // Chưa chọn: tuần vừa khung thì xem cả tuần, không thì xem ngày đầu tiên có ca.
  const view = choice ?? (weekFits || !withLessons.length ? 'week' : withLessons[0])
  const dates = view === 'week' ? weekDays : [view]

  const days = useMemo(() => dates.map((d) => ({ date: d, ...layoutDay(lessons.filter((l) => l.date === d)) })), [dates.join(), lessons]) // eslint-disable-line react-hooks/exhaustive-deps
  const axis = useMemo(() => buildAxis(days.flatMap((d) => d.placed)), [days])
  const marks = useMemo(() => {
    const m = new Map<string, 'critical' | 'warning'>()
    for (const i of issues) {
      const sev = ISSUE_META[i.kind].severity
      if (sev === 'info') continue
      for (const id of [i.lesson.id, i.related?.id]) if (id && m.get(id) !== 'critical') m.set(id, sev)
    }
    return m
  }, [issues])
  const countOn = (d: string) => lessons.filter((l) => l.date === d).length
  const height = axisHeight(axis, ROW_PX, GAP_PX)
  const bands = useMemo(() => sessionBands(axis), [axis])
  const hasUntimed = days.some((d) => d.untimed.length > 0)
  const columns = `${TIME_COL_PX}px ${days.map((d) => (d.lanes ? `minmax(${d.lanes * LANE_MIN_PX}px, ${d.lanes}fr)` : `minmax(${EMPTY_DAY_PX}px, 0.6fr)`)).join(' ')}`
  const overflowing = view === 'week' && !weekFits
  const pill = (active: boolean) => clsx('tnum rounded-full border px-2.5 py-0.5 text-xs font-medium', active ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100')

  return (
    <div ref={box}>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2" role="group" aria-label="Chọn ngày xem">
        {withLessons.map((d) => (
          <button key={d} aria-pressed={view === d} onClick={() => setChoice(d)} className={pill(view === d)}>
            {DAY_LABELS[dayIndex(d)]} {shortDate(d)} <span className="opacity-70">· {countOn(d)} ca</span>
          </button>
        ))}
        <button aria-pressed={view === 'week'} onClick={() => setChoice('week')} className={pill(view === 'week')}>Cả tuần</button>
        {overflowing && <span className="text-xs text-slate-500" data-testid="scroll-hint">Cuộn ngang để xem hết các ngày</span>}
        <span className="ml-auto flex items-center gap-1.5">
          {ctx.week.status === 'planning' ? <>
            <Button className="!py-1 text-xs" onClick={() => openLessonEditor({ newForSchool: schoolId, date: view === 'week' ? undefined : view })}><Plus size={13} />Thêm ca</Button>
            <Button className="!py-1 text-xs" onClick={() => openLessonEditor({ bulkForSchool: schoolId, date: view === 'week' ? undefined : view })}><CalendarClock size={13} />Đổi lịch hàng loạt</Button>
          </> : <span className="text-xs text-slate-500">Tuần đã lưu trữ, chỉ xem</span>}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-slate-100 px-4 py-1.5 text-xs text-slate-600" data-testid="grid-legend">
        <span className="font-medium text-slate-500">Chú thích:</span>
        {LEGEND.map((x) => (
          <span key={x.label} className="inline-flex items-center gap-1.5"><span className={clsx('inline-block h-3 w-4 rounded-sm border', x.swatch)} />{x.label}</span>
        ))}
      </div>
      <div className="max-h-[78vh] overflow-auto" data-testid="time-grid">
        <div className="grid" style={{ gridTemplateColumns: columns, minWidth: 'max-content', width: '100%' }}>
          <div className="sticky left-0 top-0 z-30 border-b border-r border-slate-200 bg-slate-100 py-1.5 text-center text-xs font-semibold text-slate-600">Giờ</div>
          {days.map((d) => (
            <div key={d.date} className="sticky top-0 z-20 border-b border-r border-slate-200 bg-slate-100 px-1 py-1.5 text-center text-xs font-semibold text-slate-700">{dayLabel(d.date)}</div>
          ))}
          {hasUntimed && <>
            <div className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-1 py-1 text-center text-[11px] leading-tight text-slate-500">Chưa rõ giờ</div>
            {days.map((d) => (
              <div key={d.date} className="grid content-start gap-1 border-b border-r border-slate-200 bg-white p-1" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${LANE_MIN_PX - 8}px, 1fr))` }} data-testid="untimed-cell">
                {d.untimed.map((l) => (
                  <div key={l.id} className="min-h-[68px]" data-testid="lesson-slot">
                    <LessonChip lesson={l} ctx={ctx} show="teacher" fill mark={marks.get(l.id)} onShowOnMap={onShowOnMap} />
                  </div>
                ))}
              </div>
            ))}
          </>}
          <div className="sticky left-0 z-10 border-r border-slate-200 bg-white" style={{ height }}>
            {bands.map((b) => {
              const top = axisY(axis, b.from, ROW_PX, GAP_PX)
              return (
                <div key={b.session} data-testid={`session-band-${b.session}`} className={clsx('absolute left-0 z-10 flex items-center justify-center overflow-hidden text-[10px] font-bold tracking-wider text-white', b.session === 'AM' ? 'bg-sky-700' : 'bg-orange-700')} style={{ top, width: SESSION_STRIP_PX, height: axisY(axis, b.to, ROW_PX, GAP_PX) - top }}>
                  <span style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{b.session === 'AM' ? 'SÁNG' : 'CHIỀU'}</span>
                </div>
              )
            })}
            {axis.map((seg) => seg.kind === 'gap' ? (
              <div key={seg.from} className="tnum flex items-center justify-center bg-slate-200 text-[10px] text-slate-500" style={{ height: GAP_PX }} title={`${label(seg.from)}–${label(seg.to)}: không có ca`}>⋮</div>
            ) : Array.from({ length: (seg.to - seg.from) / 15 }, (_, i) => {
              const min = seg.from + i * 15
              return <div key={min} className={clsx('tnum flex items-center justify-center text-[10px]', min % 60 === 0 ? 'font-bold text-slate-900' : 'text-slate-600')} style={{ height: ROW_PX, paddingLeft: SESSION_STRIP_PX, background: slotColor(min) }}>{label(min)}</div>
            }))}
          </div>
          {days.map((d) => (
            <div key={d.date} className="relative border-r border-slate-200" style={{ height }} data-testid="day-column">
              <div aria-hidden className="absolute inset-0">
                {axis.map((seg) => seg.kind === 'gap' ? (
                  <div key={seg.from} className="tnum flex items-center justify-center bg-slate-200 text-[10px] text-slate-500" style={{ height: GAP_PX }}>{label(seg.from)}–{label(seg.to)} không có ca</div>
                ) : Array.from({ length: (seg.to - seg.from) / 15 }, (_, i) => {
                  const min = seg.from + i * 15
                  return <div key={min} data-testid="grid-slot" data-minute={min} style={{ height: ROW_PX, background: slotColor(min) }} />
                }))}
              </div>
              {d.placed.map((p) => {
                const top = axisY(axis, p.startMin, ROW_PX, GAP_PX)
                const bottom = axisY(axis, Math.max(p.endMin, p.startMin + MIN_VISUAL_MIN), ROW_PX, GAP_PX)
                return (
                  <div key={p.lesson.id} data-testid="lesson-slot" className="absolute p-px hover:z-10" style={{ top, height: bottom - top, left: `${(p.lane / d.lanes) * 100}%`, width: `${100 / d.lanes}%` }}>
                    <LessonChip lesson={p.lesson} ctx={ctx} show="teacher" fill mark={marks.get(p.lesson.id)} onShowOnMap={onShowOnMap} />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
