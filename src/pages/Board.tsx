import { autoUpdate, flip, FloatingPortal, offset, shift, useDismiss, useFloating, useFocus, useHover, useInteractions, useRole } from '@floating-ui/react'
import clsx from 'clsx'
import { AlertOctagon, AlertTriangle, ArrowDown, ArrowUp, Check, FileDown, FileSpreadsheet, Info, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { EntityAnchor } from '../components/EntityLink'
import { Badge, Button, Card, PageHeader, Stat, toast } from '../components/ui'
import { wardOf } from '../domain/geo'
import { coverage, healthOf, issueScore, ISSUE_META, schoolLoad, touchesSchool, type Health, type Issue, type IssueKind } from '../domain/issues'
import { DAY_LABELS, money, shortDate, weekDates } from '../domain/time'
import { needsTeacher } from '../domain/types'
import { useWeekContext, useWeekIssues, weekCosts } from '../hooks'
import { exportWeek, exportWeekSheet } from '../services/exports'
import { useStore } from '../store'

const HEALTH_STYLE: Record<Health, string> = {
  critical: 'bg-red-100 text-red-800 ring-1 ring-red-300',
  warning: 'bg-amber-100 text-amber-900 ring-1 ring-amber-300',
  ok: 'bg-emerald-50 text-emerald-800',
}
const HEALTH_ICON = { critical: AlertOctagon, warning: AlertTriangle, ok: Check }

const MAX_LINES = 6

function HealthCell({ schoolId, schoolName, date, count, issues }: { schoolId: string; schoolName: string; date: string; count: number; issues: Issue[] }) {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({ open, onOpenChange: setOpen, placement: 'top', whileElementsMounted: autoUpdate, middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })] })
  const { getReferenceProps, getFloatingProps } = useInteractions([useHover(context, { delay: { open: 60 }, move: false }), useFocus(context), useDismiss(context), useRole(context, { role: 'tooltip' })])
  const health = healthOf(issues)
  const Icon = HEALTH_ICON[health]
  const main = issues.filter((i) => ISSUE_META[i.kind].severity !== 'info')
  const notes = issues.filter((i) => ISSUE_META[i.kind].severity === 'info')
  const refer = notes.filter((i) => i.kind === 'refer').length
  const pref = notes.length - refer
  const label = `${count} ca, ${health === 'critical' ? 'có lỗi nghiêm trọng' : health === 'warning' ? 'có chặng không kịp' : 'ổn'}${issues.length ? `, ${issues.length} cảnh báo` : ''}`
  return (
    <>
      <Link ref={refs.setReference} {...getReferenceProps()} to={`/schools/${schoolId}`} aria-label={label} data-health={health} className={clsx('tnum relative inline-flex min-w-11 items-center justify-center gap-1 rounded px-1.5 py-1 text-xs font-semibold transition hover:brightness-95', HEALTH_STYLE[health])}>
        <Icon size={11} />{count}
        {health === 'ok' && notes.length > 0 && <span aria-hidden className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-sky-500" />}
      </Link>
      {open && issues.length > 0 && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} data-testid="health-tooltip" className="pointer-events-none z-50 w-96 max-w-[90vw] rounded-lg bg-slate-900 px-3 py-2.5 text-xs leading-relaxed text-white shadow-xl">
            <div className="mb-1 font-semibold">{schoolName} · {shortDate(date)}</div>
            <ul className="space-y-1.5">
              {main.slice(0, MAX_LINES).map((i, n) => (
                <li key={n}>
                  <span className={clsx('font-semibold', ISSUE_META[i.kind].severity === 'critical' ? 'text-red-300' : 'text-amber-300')}>{ISSUE_META[i.kind].label}</span>
                  {i.lesson.start && <span className="tnum text-slate-300"> {i.lesson.start}</span>}
                  {i.lesson.className && <span className="text-slate-300"> lớp {i.lesson.className}</span>}
                  <div className="text-slate-200">{i.detail}</div>
                </li>
              ))}
            </ul>
            {main.length > MAX_LINES && <div className="mt-1 text-slate-300">và {main.length - MAX_LINES} cảnh báo khác</div>}
            {notes.length > 0 && <div className={clsx('flex items-center gap-1 text-sky-200', main.length > 0 && 'mt-1.5')}><Info size={11} />{[refer && `${refer} ca ngoài Refer`, pref && `${pref} ca vi phạm nguyện vọng`].filter(Boolean).join(', ')}</div>}
          </div>
        </FloatingPortal>
      )}
    </>
  )
}

type SortKey = 'load' | 'errors' | 'ward' | 'region' | 'name'
const SORT_LABEL: Record<SortKey, string> = { load: 'Số ca', errors: 'Số lỗi', ward: 'Phường/xã', region: 'Khu vực', name: 'Tên trường' }
/** Số thì mặc định từ cao xuống thấp, chữ thì theo A-Z. */
const DEFAULT_DESC: Record<SortKey, boolean> = { load: true, errors: true, ward: false, region: false, name: false }

function SortHeader({ k, sort, onSort, align, children }: { k: SortKey; sort: { key: SortKey; desc: boolean }; onSort: (k: SortKey) => void; align?: 'right'; children: string }) {
  const active = sort.key === k
  const Arrow = sort.desc ? ArrowDown : ArrowUp
  return (
    <th aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'} className={clsx('px-3 py-3 font-medium first:pl-5', align === 'right' && 'text-right')}>
      <button onClick={() => onSort(k)} className={clsx('inline-flex items-center gap-0.5 hover:text-slate-900', active && 'font-semibold text-slate-900')}>
        {children}
        {active && <Arrow size={11} />}
      </button>
    </th>
  )
}

function KpiLink({ kind, ...props }: { kind: IssueKind } & Parameters<typeof Stat>[0]) {
  return <Link to={`/alerts?kind=${kind}`} className="block transition hover:brightness-95"><Stat {...props} /></Link>
}

export function BoardPage() {
  const ctx = useWeekContext()
  const autoFill = useStore((s) => s.autoFill)
  const issues = useWeekIssues(ctx)
  const cov = useMemo(() => coverage(ctx.week.lessons), [ctx.week.lessons])
  const costs = useMemo(() => weekCosts(ctx), [ctx])
  const count = (k: IssueKind) => issues.filter((i) => i.kind === k).length
  const totalCost = costs.reduce((s, c) => s + c.cost, 0)
  const totalKm = costs.reduce((s, c) => s + c.km, 0)
  const dates = useMemo(() => weekDates(ctx.week.startDate), [ctx.week.startDate])
  const planning = ctx.week.status === 'planning'
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'load', desc: true })
  const onSort = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: DEFAULT_DESC[key] }))

  const rows = useMemo(() => {
    const load = schoolLoad(ctx.week.lessons)
    const list = [...load.entries()]
      .map(([id, total]) => {
        const mine = issues.filter((i) => touchesSchool(i, id))
        const days = dates.map((d) => ({
          date: d,
          count: ctx.week.lessons.filter((l) => l.schoolId === id && l.date === d && needsTeacher(l)).length,
          issues: mine.filter((i) => i.lesson.date === d),
        }))
        const school = ctx.schoolById.get(id)
        const score = issueScore(mine)
        return { id, name: school?.fullName ?? id, total, days, health: healthOf(mine), urgent: score.urgent, notes: mine.length - score.urgent, rank: score.rank,
          ward: school ? wardOf(school) : '—', region: school?.region?.trim() || '—' }
      })
    const text = (a: string, b: string) => a.localeCompare(b, 'vi')
    const compare: Record<SortKey, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      load: (a, b) => a.total - b.total,
      errors: (a, b) => a.rank - b.rank,
      ward: (a, b) => text(a.ward, b.ward),
      region: (a, b) => text(a.region, b.region),
      name: (a, b) => text(a.name, b.name),
    }
    // Trong cùng nhóm luôn đưa trường đông ca lên trước, rồi theo tên.
    return list.sort((a, b) => (sort.desc ? -1 : 1) * compare[sort.key](a, b) || b.total - a.total || text(a.name, b.name))
  }, [ctx, issues, dates, sort])
  const usedDays = dates.map((_, i) => rows.some((r) => r.days[i].count > 0))
  const summary = { critical: 0, warning: 0, ok: 0 }
  for (const r of rows) summary[r.health]++

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader
        title="Bảng tổng quan"
        subtitle={`Sức khoẻ toàn hệ thống tuần ${shortDate(ctx.week.startDate)} – ${shortDate(ctx.week.endDate)}.`}
        actions={<>
          {planning && (
            <Button variant="primary" disabled={!count('uncovered')} onClick={() => {
              const r = autoFill()
              toast(`Đã tự điền ${r.filled} ca${r.left ? `, còn ${r.left} ca chưa có người phù hợp` : ''}`)
            }}><Sparkles size={14} />Tự điền ca trống</Button>
          )}
          <Button data-testid="export-week-sheet" onClick={async () => {
            const n = await exportWeekSheet(ctx)
            toast(n ? `Đã xuất lịch tuần, nhưng ${n} ca không còn ô trống nên chưa có trong file` : 'Đã xuất lịch tuần theo mẫu Gaia')
          }}><FileSpreadsheet size={14} />Xuất lịch tuần (mẫu Gaia)</Button>
          <Button onClick={() => exportWeek(ctx)}><FileDown size={14} />Xuất Excel theo GV, trường</Button>
          <Button onClick={() => window.open('/print/week', '_blank')}><FileDown size={14} />Xuất PDF</Button>
        </>}
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 min-[1400px]:grid-cols-7">
        <Stat label="Độ phủ lớp học" value={`${(cov.ratio * 100).toFixed(1)}%`} hint={`${cov.covered}/${cov.required} ca`} tone={cov.ratio < 1 ? 'critical' : undefined} />
        <KpiLink kind="uncovered" label="Chưa có giáo viên" value={count('uncovered')} tone={count('uncovered') ? 'critical' : undefined} />
        <KpiLink kind="overlap" label="Trùng lịch" value={count('overlap')} tone={count('overlap') ? 'critical' : undefined} />
        <KpiLink kind="travel" label="Không kịp di chuyển" value={count('travel')} tone={count('travel') ? 'warning' : undefined} />
        <KpiLink kind="refer" label="Ngoài Refer" value={count('refer')} />
        <KpiLink kind="preference" label="Vi phạm nguyện vọng" value={count('preference')} />
        <Stat label="Chi phí di chuyển" value={money(totalCost)} hint={`${Math.round(totalKm).toLocaleString('vi-VN')} km`} />
      </div>

      <Card
        title="Trạng thái theo trường"
        actions={<>
          <span className="flex items-center gap-1.5 text-xs" data-testid="health-summary">
            <Badge tone="red"><AlertOctagon size={10} />{summary.critical} trường có lỗi</Badge>
            <Badge tone="amber"><AlertTriangle size={10} />{summary.warning} không kịp</Badge>
            <Badge tone="green"><Check size={10} />{summary.ok} ổn</Badge>
          </span>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">Sắp xếp theo
            <select aria-label="Sắp xếp theo" value={sort.key} onChange={(e) => { const key = e.target.value as SortKey; setSort({ key, desc: DEFAULT_DESC[key] }) }}>
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
            </select>
          </label>
        </>}
      >
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="health-table">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <SortHeader k="name" sort={sort} onSort={onSort}>Trường</SortHeader>
                <SortHeader k="ward" sort={sort} onSort={onSort}>Phường/xã</SortHeader>
                <SortHeader k="region" sort={sort} onSort={onSort}>Khu vực</SortHeader>
                <SortHeader k="load" sort={sort} onSort={onSort} align="right">Tổng ca</SortHeader>
                <SortHeader k="errors" sort={sort} onSort={onSort} align="right">Lỗi</SortHeader>
                {dates.map((d, i) => usedDays[i] && <th key={d} className="px-1.5 py-3 text-center font-medium">{DAY_LABELS[i]}<div className="font-normal text-slate-400">{shortDate(d)}</div></th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="max-w-[300px] truncate px-5 py-3"><EntityAnchor kind="school" id={r.id} className="font-medium">{r.name}</EntityAnchor></td>
                  <td className="max-w-[120px] truncate px-3 py-3 text-slate-600" title={r.ward}>{r.ward}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-slate-600">{r.region}</td>
                  <td className="tnum px-3 py-3 text-right text-slate-600">{r.total}</td>
                  <td className="tnum px-3 py-3 text-right" title={`${r.urgent} lỗi cần xử lý, ${r.notes} ghi chú`}>{r.urgent > 0 ? <span className="font-semibold text-red-700">{r.urgent}</span> : <span className="text-slate-400">0</span>}</td>
                  {r.days.map((c, i) => usedDays[i] && (
                    <td key={c.date} className="px-1.5 py-2 text-center">
                      {c.count > 0 && <HealthCell schoolId={r.id} schoolName={r.name} date={c.date} count={c.count} issues={c.issues} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-5 items-center justify-center rounded bg-red-100 text-red-800"><AlertOctagon size={10} /></span>Trùng lịch, ca trống, GV đang nghỉ</span>
          <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-5 items-center justify-center rounded bg-amber-100 text-amber-900"><AlertTriangle size={10} /></span>Không kịp di chuyển</span>
          <span className="inline-flex items-center gap-1"><span className="inline-flex h-4 w-5 items-center justify-center rounded bg-emerald-50 text-emerald-800"><Check size={10} /></span>Ổn</span>
          <span className="inline-flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-sky-500" />Ổn, có ghi chú Refer hoặc nguyện vọng</span>
          <span className="ml-auto text-slate-500">Bấm tiêu đề cột để sắp xếp · Rê chuột vào ô để xem tóm tắt</span>
        </div>
      </Card>
    </div>
  )
}
