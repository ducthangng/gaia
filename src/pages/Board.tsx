import clsx from 'clsx'
import { AlertOctagon, AlertTriangle, Check, FileDown, Info, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { LessonChip } from '../components/LessonChip'
import { Badge, Button, Card, Empty, PageHeader, Stat, toast } from '../components/ui'
import { coverage, ISSUE_META, weekIssues, type IssueKind } from '../domain/issues'
import { byTime } from '../domain/route'
import { dayLabel, money, shortDate, DAY_LABELS, weekDates } from '../domain/time'
import { needsTeacher } from '../domain/types'
import { useWeekContext, weekCosts } from '../hooks'
import { exportWeek } from '../services/exports'
import { useStore } from '../store'

const SEVERITY_ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info }
const KINDS: IssueKind[] = ['uncovered', 'conflict', 'preference', 'refer']

export function BoardPage() {
  const ctx = useWeekContext()
  const autoFill = useStore((s) => s.autoFill)
  const [kind, setKind] = useState<IssueKind | 'all'>('all')
  const [limit, setLimit] = useState(40)
  const issues = useMemo(() => weekIssues(ctx), [ctx])
  const cov = useMemo(() => coverage(ctx.week.lessons), [ctx.week.lessons])
  const costs = useMemo(() => weekCosts(ctx), [ctx])
  const count = (k: IssueKind) => issues.filter((i) => i.kind === k).length
  const totalCost = costs.reduce((s, c) => s + c.cost, 0)
  const totalKm = costs.reduce((s, c) => s + c.km, 0)
  const shown = issues
    .filter((i) => kind === 'all' || i.kind === kind)
    .sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.lesson.date.localeCompare(b.lesson.date) || byTime(a.lesson, b.lesson))
  const dates = weekDates(ctx.week.startDate)
  const planning = ctx.week.status === 'planning'

  const matrix = useMemo(() => {
    const rows = new Map<string, { required: number[]; uncovered: number[]; flagged: number[] }>()
    const empty = () => ({ required: Array(7).fill(0), uncovered: Array(7).fill(0), flagged: Array(7).fill(0) })
    for (const l of ctx.week.lessons) {
      if (!needsTeacher(l)) continue
      const row = rows.get(l.schoolId) ?? empty()
      rows.set(l.schoolId, row)
      const d = dates.indexOf(l.date)
      row.required[d]++
      if (l.status === 'needs_cover' || !l.teacherId) row.uncovered[d]++
    }
    for (const i of issues) {
      if (i.kind === 'uncovered') continue
      const row = rows.get(i.lesson.schoolId)
      if (row) row.flagged[dates.indexOf(i.lesson.date)]++
    }
    return [...rows.entries()]
      .map(([id, r]) => ({ id, name: ctx.schoolById.get(id)?.fullName ?? id, ...r, un: r.uncovered.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.un - a.un || a.name.localeCompare(b.name, 'vi'))
  }, [ctx, issues, dates])
  const usedDays = dates.map((_, i) => matrix.some((r) => r.required[i] > 0))

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Bảng tổng quan"
        subtitle={`Trạng thái phân công tuần ${shortDate(ctx.week.startDate)} – ${shortDate(ctx.week.endDate)}.`}
        actions={<>
          {planning && (
            <Button variant="primary" disabled={!count('uncovered')} onClick={() => {
              const r = autoFill()
              toast(`Đã tự điền ${r.filled} ca${r.left ? `, còn ${r.left} ca chưa có người phù hợp` : ''}`)
            }}><Sparkles size={14} />Tự điền ca trống</Button>
          )}
          <Button onClick={() => exportWeek(ctx)}><FileDown size={14} />Xuất Excel</Button>
          <Button onClick={() => window.open('/print/week', '_blank')}><FileDown size={14} />Xuất PDF</Button>
        </>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Độ phủ lớp học" value={`${(cov.ratio * 100).toFixed(1)}%`} hint={`${cov.covered}/${cov.required} ca có giáo viên`} tone={cov.ratio < 1 ? 'critical' : undefined} />
        <Stat label="Chưa có giáo viên" value={count('uncovered')} tone={count('uncovered') ? 'critical' : undefined} hint="Ca cần xếp ngay" />
        <Stat label="Trùng lịch / không kịp" value={count('conflict')} tone={count('conflict') ? 'critical' : undefined} hint="Tính cả thời gian di chuyển" />
        <Stat label="Ngoài danh sách Refer" value={count('refer')} tone={count('refer') ? 'warning' : undefined} hint="Cần quản trị viên xem xét" />
        <Stat label="Vi phạm nguyện vọng" value={count('preference')} tone={count('preference') ? 'warning' : undefined} hint="Theo nguyện vọng đã khai" />
        <Stat label="Chi phí di chuyển" value={money(totalCost)} hint={`${Math.round(totalKm).toLocaleString('vi-VN')} km gồm chặng về nhà`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card title="Cảnh báo cần xử lý" actions={
          <select aria-label="Lọc cảnh báo" value={kind} onChange={(e) => { setKind(e.target.value as IssueKind | 'all'); setLimit(40) }}>
            <option value="all">Tất cả ({issues.length})</option>
            {KINDS.map((k) => <option key={k} value={k}>{ISSUE_META[k].label} ({count(k)})</option>)}
          </select>
        }>
          {shown.length === 0 ? (
            <Empty><Check size={16} className="mx-auto mb-1 text-emerald-600" />Không có cảnh báo nào.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shown.slice(0, limit).map((i, n) => {
                const meta = ISSUE_META[i.kind]
                const Icon = SEVERITY_ICON[meta.severity]
                return (
                  <li key={`${i.kind}-${i.lesson.id}-${n}`} className="grid grid-cols-[minmax(0,1fr)_170px] gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium">
                        <Icon size={14} className={clsx(meta.severity === 'critical' ? 'text-red-600' : meta.severity === 'warning' ? 'text-amber-600' : 'text-sky-600')} />
                        {meta.label}
                      </div>
                      <div className="mt-0.5 truncate text-slate-700">{ctx.schoolById.get(i.lesson.schoolId)?.fullName}</div>
                      <div className="text-xs text-slate-500">{dayLabel(i.lesson.date)} · {i.detail}</div>
                    </div>
                    <LessonChip lesson={i.lesson} ctx={ctx} show="teacher" />
                  </li>
                )
              })}
            </ul>
          )}
          {shown.length > limit && <div className="border-t border-slate-100 p-2 text-center"><Button variant="ghost" onClick={() => setLimit((x) => x + 60)}>Xem thêm ({shown.length - limit})</Button></div>}
        </Card>

        <Card title="Trạng thái theo trường" actions={<span className="text-xs text-slate-500">Số ca mỗi ngày</span>}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium">Trường</th>
                  {DAY_LABELS.map((d, i) => usedDays[i] && <th key={d} className="px-1 py-2 text-center font-medium">{d}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matrix.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="max-w-[260px] truncate px-4 py-1.5"><Link className="hover:text-emerald-700 hover:underline" to={`/schools/${r.id}`}>{r.name}</Link></td>
                    {r.required.map((n, i) => usedDays[i] && (
                      <td key={i} className="px-1 py-1 text-center">
                        {n > 0 && (
                          <span title={`${n} ca · ${r.uncovered[i]} chưa có GV · ${r.flagged[i]} cảnh báo`} className={clsx('tnum inline-flex min-w-9 items-center justify-center gap-0.5 rounded px-1 py-0.5 text-xs font-medium', r.uncovered[i] ? 'bg-red-100 text-red-800' : r.flagged[i] ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800')}>
                            {r.uncovered[i] ? <AlertOctagon size={10} /> : r.flagged[i] ? <AlertTriangle size={10} /> : <Check size={10} />}{n}
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            <Badge tone="green"><Check size={10} />Đủ giáo viên</Badge>
            <Badge tone="amber"><AlertTriangle size={10} />Có cảnh báo</Badge>
            <Badge tone="red"><AlertOctagon size={10} />Có ca trống</Badge>
          </div>
        </Card>
      </div>
    </div>
  )
}
