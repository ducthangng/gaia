import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { ISSUE_META, type Issue } from '../domain/issues'
import { hourRange, layoutDay } from '../domain/timetable'
import { DAY_LABELS, dayLabel, shortDate, weekDates } from '../domain/time'
import type { Lesson } from '../domain/types'
import type { Ctx } from '../hooks'
import { LessonChip } from './LessonChip'

const ROW_PX = 18 // Một ô 15 phút
const LANE_MIN_PX = 106
const EMPTY_DAY_PX = 76

const LEGEND: { swatch: string; label: string }[] = [
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

/** Lịch dạng lưới giờ: mỗi ca đặt đúng vị trí theo giờ, ca trùng giờ nằm cạnh nhau trong cùng một ngày. */
export function WeekTimeGrid({ lessons, ctx, issues, onShowOnMap }: { lessons: Lesson[]; ctx: Ctx; issues: Issue[]; onShowOnMap: (l: Lesson) => void }) {
  const allDates = weekDates(ctx.week.startDate)
  const [onlyDay, setOnlyDay] = useState<string | null>(null)
  const dates = onlyDay ? [onlyDay] : allDates
  const days = useMemo(() => dates.map((d) => ({ date: d, ...layoutDay(lessons.filter((l) => l.date === d)) })), [dates.join(), lessons]) // eslint-disable-line react-hooks/exhaustive-deps
  const countOn = (d: string) => lessons.filter((l) => l.date === d).length
  const { from, to } = useMemo(() => hourRange(lessons), [lessons])
  const marks = useMemo(() => {
    const m = new Map<string, 'critical' | 'warning'>()
    for (const i of issues) {
      const sev = ISSUE_META[i.kind].severity
      if (sev === 'info') continue
      for (const id of [i.lesson.id, i.related?.id]) {
        if (id && !(m.get(id) === 'critical')) m.set(id, sev)
      }
    }
    return m
  }, [issues])
  const rows = (to - from) * 4
  const height = rows * ROW_PX
  const hasUntimed = days.some((d) => d.untimed.length > 0)
  const columns = `56px ${days.map((d) => (d.lanes ? `minmax(${d.lanes * LANE_MIN_PX}px, ${d.lanes}fr)` : `minmax(${EMPTY_DAY_PX}px, 0.6fr)`)).join(' ')}`
  // Sọc xen kẽ mỗi 15 phút giúp dóng giờ từ cột trái sang.
  const stripes = `repeating-linear-gradient(to bottom, #fff 0 ${ROW_PX}px, #f4f6ec ${ROW_PX}px ${ROW_PX * 2}px)`

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2" role="group" aria-label="Chọn ngày xem">
        <button aria-pressed={!onlyDay} onClick={() => setOnlyDay(null)} className={clsx('rounded-full border px-2.5 py-0.5 text-xs font-medium', !onlyDay ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100')}>Cả tuần</button>
        {allDates.map((d, i) => countOn(d) > 0 && (
          <button key={d} aria-pressed={onlyDay === d} onClick={() => setOnlyDay(d)} className={clsx('tnum rounded-full border px-2.5 py-0.5 text-xs font-medium', onlyDay === d ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100')}>
            {DAY_LABELS[i]} {shortDate(d)} <span className="opacity-70">· {countOn(d)} ca</span>
          </button>
        ))}
      </div>
      <div className="max-h-[72vh] overflow-auto" data-testid="time-grid">
        <div className="grid min-w-max" style={{ gridTemplateColumns: columns }}>
          <div className="sticky left-0 top-0 z-30 border-b border-r border-slate-200 bg-slate-100 px-1 py-1.5 text-center text-xs font-semibold text-slate-600">Giờ</div>
          {days.map((d) => (
            <div key={d.date} className="sticky top-0 z-20 border-b border-r border-slate-200 bg-slate-100 px-1 py-1.5 text-center text-xs font-semibold text-slate-700">{dayLabel(d.date)}</div>
          ))}
          {hasUntimed && <>
            <div className="sticky left-0 z-10 border-b border-r border-slate-200 bg-white px-1 py-1 text-center text-[11px] leading-tight text-slate-500">Chưa rõ giờ</div>
            {days.map((d) => (
              <div key={d.date} className="flex flex-wrap content-start gap-1 border-b border-r border-slate-200 bg-white p-1" data-testid="untimed-cell">
                {d.untimed.map((l) => (
                  <div key={l.id} className="h-12 min-w-0 flex-1 basis-24">
                    <LessonChip lesson={l} ctx={ctx} show="teacher" fill mark={marks.get(l.id)} onShowOnMap={onShowOnMap} />
                  </div>
                ))}
              </div>
            ))}
          </>}
          <div className="sticky left-0 z-10 border-r border-slate-200 bg-white" style={{ height }}>
            {Array.from({ length: rows }, (_, i) => {
              const min = from * 60 + i * 15
              const label = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
              return <div key={i} className={clsx('tnum flex items-center justify-center text-[10px]', i % 4 === 0 ? 'font-bold text-slate-800' : 'text-slate-400')} style={{ height: ROW_PX, background: i % 2 ? '#f4f6ec' : '#fff' }}>{label}</div>
            })}
          </div>
          {days.map((d) => (
            <div key={d.date} className="relative border-r border-slate-200" style={{ height, background: stripes }} data-testid="day-column">
              {d.placed.map((p) => {
                const top = ((p.startMin - from * 60) / 15) * ROW_PX
                const h = ((p.endMin - p.startMin) / 15) * ROW_PX
                return (
                  <div key={p.lesson.id} className="absolute p-px hover:z-10" style={{ top, height: Math.max(h, ROW_PX * 2), left: `${(p.lane / d.lanes) * 100}%`, width: `${100 / d.lanes}%` }}>
                    <LessonChip lesson={p.lesson} ctx={ctx} show="teacher" fill mark={marks.get(p.lesson.id)} onShowOnMap={onShowOnMap} />
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-slate-100 px-4 py-2 text-xs text-slate-600" data-testid="grid-legend">
        <span className="font-medium text-slate-500">Chú thích:</span>
        {LEGEND.map((x) => (
          <span key={x.label} className="inline-flex items-center gap-1.5"><span className={clsx('inline-block h-3.5 w-5 rounded-sm border', x.swatch)} />{x.label}</span>
        ))}
      </div>
    </div>
  )
}
