import clsx from 'clsx'
import { AlertOctagon, AlertTriangle, Check, ExternalLink, Info, MapPinned } from 'lucide-react'
import { ISSUE_META, type Issue } from '../domain/issues'
import { googleDirectionsUrl } from '../domain/geo'
import { byTime } from '../domain/route'
import { dayLabel } from '../domain/time'
import type { Ctx } from '../hooks'
import { LessonChip } from './LessonChip'
import { Card } from './ui'

export const SEVERITY_ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info }
export const SEVERITY_COLOR = { critical: 'text-red-600', warning: 'text-amber-600', info: 'text-sky-600' }

export const travelLink = (i: Issue, ctx: Ctx) => {
  const a = i.related && ctx.schoolById.get(i.related.schoolId)
  const b = ctx.schoolById.get(i.lesson.schoolId)
  return a && b ? googleDirectionsUrl({ name: a.fullName, geo: a.geo, address: a.address }, { name: b.fullName, geo: b.geo, address: b.address }) : null
}

/** Mô tả cặp ca để điều phối thấy ngay GV đi từ đâu sang đâu, lúc mấy giờ. */
export function PairDetail({ issue: i, ctx }: { issue: Issue; ctx: Ctx }) {
  if (!i.related) return null
  const from = ctx.schoolById.get(i.related.schoolId)?.fullName
  const to = ctx.schoolById.get(i.lesson.schoolId)?.fullName
  return (
    <div className="mt-1 text-xs text-slate-600">
      <span className="tnum font-medium">{i.related.start}–{i.related.end}</span> lớp {i.related.className ?? '—'} tại {from}
      {' → '}
      <span className="tnum font-medium">{i.lesson.start}–{i.lesson.end}</span> lớp {i.lesson.className ?? '—'} tại {to}
    </div>
  )
}

export function SchoolAlerts({ issues, schoolId, ctx, active, onShowOnMap }: { issues: Issue[]; schoolId: string; ctx: Ctx; active: Issue | null; onShowOnMap: (i: Issue) => void }) {
  const main = issues.filter((i) => ISSUE_META[i.kind].severity !== 'info').sort((a, b) => a.lesson.date.localeCompare(b.lesson.date) || byTime(a.lesson, b.lesson))
  const notes = issues.filter((i) => ISSUE_META[i.kind].severity === 'info')
  const refer = notes.filter((i) => i.kind === 'refer').length
  const pref = notes.length - refer
  return (
    <Card title={`Cảnh báo của trường (${main.length})`}>
      {!main.length && <div className="flex items-center gap-2 px-4 py-3 text-slate-600"><Check size={15} className="text-emerald-600" />Không có trùng lịch, ca trống hay chặng không kịp trong tuần này.</div>}
      <ul className="divide-y divide-slate-100" data-testid="school-alerts">
        {main.map((i, n) => {
          const meta = ISSUE_META[i.kind]
          const Icon = SEVERITY_ICON[meta.severity]
          const link = i.kind === 'travel' ? travelLink(i, ctx) : null
          const otherSchool = i.lesson.schoolId !== schoolId
          return (
            <li key={`${i.kind}-${i.lesson.id}-${n}`} className={clsx('grid grid-cols-[minmax(0,1fr)_165px] gap-3 px-4 py-2.5', active === i && 'bg-amber-50/60')}>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 font-medium"><Icon size={14} className={SEVERITY_COLOR[meta.severity]} />{meta.label}<span className="font-normal text-slate-500">· {dayLabel(i.lesson.date)}</span></div>
                <div className="mt-0.5 text-slate-700">{i.detail}</div>
                <PairDetail issue={i} ctx={ctx} />
                {i.kind === 'travel' && (
                  <div className="mt-1 flex flex-wrap gap-3 text-xs">
                    <button className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline" onClick={() => onShowOnMap(i)}><MapPinned size={12} />Xem trên bản đồ</button>
                    {link && <a className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline" href={link} target="_blank" rel="noreferrer"><ExternalLink size={12} />Chỉ đường Google Maps</a>}
                  </div>
                )}
                {otherSchool && <div className="mt-0.5 text-xs text-slate-500">Ca cần đổi nằm ở trường kế tiếp, xem ô bên phải.</div>}
              </div>
              <LessonChip lesson={i.lesson} ctx={ctx} show="teacher" />
            </li>
          )
        })}
      </ul>
      {notes.length > 0 && (
        <div className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
          <Info size={12} className="text-sky-600" />
          Thêm {[refer && `${refer} ca ngoài danh sách Refer`, pref && `${pref} ca vi phạm nguyện vọng`].filter(Boolean).join(', ')}.
        </div>
      )}
    </Card>
  )
}
