import clsx from 'clsx'
import { Check, ExternalLink, MapPinned } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { LessonChip } from '../components/LessonChip'
import { PairDetail, SEVERITY_COLOR, SEVERITY_ICON, travelLink } from '../components/SchoolAlerts'
import { Button, Card, Empty, PageHeader } from '../components/ui'
import { ISSUE_KINDS, ISSUE_META, type IssueKind } from '../domain/issues'
import { byTime } from '../domain/route'
import { dayLabel, shortDate } from '../domain/time'
import { useWeekContext, useWeekIssues } from '../hooks'

export function AlertsPage() {
  const ctx = useWeekContext()
  const issues = useWeekIssues(ctx)
  const [params, setParams] = useSearchParams()
  const [limit, setLimit] = useState(60)
  const kind = (params.get('kind') as IssueKind | null) ?? 'all'
  const count = (k: IssueKind) => issues.filter((i) => i.kind === k).length
  const shown = issues
    .filter((i) => kind === 'all' || i.kind === kind)
    .sort((a, b) => ISSUE_KINDS.indexOf(a.kind) - ISSUE_KINDS.indexOf(b.kind) || a.lesson.date.localeCompare(b.lesson.date) || byTime(a.lesson, b.lesson))
  const select = (k: IssueKind | 'all') => {
    setParams(k === 'all' ? {} : { kind: k })
    setLimit(60)
  }
  const tabs: { key: IssueKind | 'all'; label: string; n: number }[] = [
    { key: 'all', label: 'Tất cả', n: issues.length },
    ...ISSUE_KINDS.map((k) => ({ key: k, label: ISSUE_META[k].label, n: count(k) })),
  ]
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Cảnh báo cần xử lý" subtitle={`Tuần ${shortDate(ctx.week.startDate)} – ${shortDate(ctx.week.endDate)}. Bấm vào ca ở bên phải để đổi giáo viên.`} />
      <div role="tablist" className="mb-3 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={kind === t.key} onClick={() => select(t.key)} className={clsx('rounded-full border px-3 py-1 font-medium', kind === t.key ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100')}>
            {t.label} <span className="tnum opacity-75">{t.n}</span>
          </button>
        ))}
      </div>
      <Card>
        {!shown.length ? (
          <Empty><Check size={16} className="mx-auto mb-1 text-emerald-600" />Không có cảnh báo nào.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="alerts-list">
            {shown.slice(0, limit).map((i, n) => {
              const meta = ISSUE_META[i.kind]
              const Icon = SEVERITY_ICON[meta.severity]
              const link = i.kind === 'travel' ? travelLink(i, ctx) : null
              return (
                <li key={`${i.kind}-${i.lesson.id}-${n}`} className="grid grid-cols-[minmax(0,1fr)_170px] gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium"><Icon size={14} className={SEVERITY_COLOR[meta.severity]} />{meta.label}<span className="font-normal text-slate-500">· {dayLabel(i.lesson.date)}</span></div>
                    <Link to={`/schools/${i.lesson.schoolId}`} className="mt-0.5 block truncate text-slate-700 hover:text-emerald-700 hover:underline">{ctx.schoolById.get(i.lesson.schoolId)?.fullName}</Link>
                    <div className="text-xs text-slate-500">{i.detail}</div>
                    <PairDetail issue={i} ctx={ctx} />
                    <div className="mt-1 flex flex-wrap gap-3 text-xs font-medium text-emerald-700">
                      {i.lesson.teacherId && <Link className="inline-flex items-center gap-1 hover:underline" to={`/schools/${i.lesson.schoolId}?lesson=${i.lesson.id}`}><MapPinned size={12} />Xem trên bản đồ</Link>}
                      {link && <a className="inline-flex items-center gap-1 hover:underline" href={link} target="_blank" rel="noreferrer"><ExternalLink size={12} />Chỉ đường Google Maps</a>}
                    </div>
                  </div>
                  <LessonChip lesson={i.lesson} ctx={ctx} show="teacher" />
                </li>
              )
            })}
          </ul>
        )}
        {shown.length > limit && <div className="border-t border-slate-100 p-2 text-center"><Button variant="ghost" onClick={() => setLimit((x) => x + 100)}>Xem thêm ({shown.length - limit})</Button></div>}
      </Card>
    </div>
  )
}
