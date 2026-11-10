import clsx from 'clsx'
import { ArrowLeft, ArrowLeftRight, ChevronDown, ChevronRight } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EntityAnchor } from '../components/EntityLink'
import { Badge, Button, Card, Empty, PageHeader, Stat } from '../components/ui'
import { buildContext } from '../domain/context'
import { DAY_LABELS, dayIndex, money, shortDate } from '../domain/time'
import { teacherLabel, type Lesson, type LessonStatus, type Week } from '../domain/types'
import { compareWeeks, schoolChanged, teacherChanged, teacherOf, type LessonPair, type SchoolDiff, type TeacherDiff } from '../domain/week-compare'
import { weekCosts } from '../hooks'
import { useLiveWeeks, useStore } from '../store'

const STATUS: Record<LessonStatus, string> = {
  assigned: 'Đã có GV',
  needs_cover: 'Cần giáo viên',
  replaced: 'Đã có ca dạy thay',
  school_off: 'Trường báo nghỉ',
  cancelled: 'Huỷ do GV nghỉ',
}

const weekText = (w: Week) => `${shortDate(w.startDate)} – ${shortDate(w.endDate)}`
const when = (l: Lesson) => `${DAY_LABELS[dayIndex(l.date)]} ${l.start ?? '?'}–${l.end ?? '?'}`
const what = (l: Lesson) => [l.className ? `Lớp ${l.className}` : l.note, l.subject].filter(Boolean).join(' · ')

type Tab = 'school' | 'teacher'

export function WeekComparePage() {
  const s = useStore()
  const weeks = useLiveWeeks()
  const [params, setParams] = useSearchParams()
  const pick = (key: 'a' | 'b', fallback: Week | undefined) => weeks.find((w) => w.id === params.get(key)) ?? fallback
  const weekB = pick('b', weeks.at(-1))
  const weekA = pick('a', weeks.at(-2) ?? weeks.at(-1))
  const tab: Tab = params.get('view') === 'teacher' ? 'teacher' : 'school'
  const [onlyChanged, setOnlyChanged] = useState(true)
  const [query, setQuery] = useState('')
  const update = (patch: Record<string, string>) => setParams({ a: weekA?.id ?? '', b: weekB?.id ?? '', view: tab, ...patch }, { replace: true })

  const result = useMemo(() => (weekA && weekB ? compareWeeks(weekA, weekB) : null), [weekA, weekB])
  const costs = useMemo(() => {
    if (!weekA || !weekB) return null
    const of = (w: Week) => new Map(weekCosts(buildContext(w, s)).map((c) => [c.teacherId, c]))
    return { a: of(weekA), b: of(weekB) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekA, weekB, s.teachers, s.schools, s.offices, s.leaves, s.distances, s.settings, s.kmOverrides])

  if (!weekA || !weekB || !result || !costs) return <Empty>Cần ít nhất một tuần để so sánh.</Empty>

  const schoolName = (id: string) => s.schools.find((x) => x.id === id)?.fullName ?? id
  const teacherName = (id: string | null) => {
    if (!id) return 'Chưa có GV'
    const t = s.teachers.find((x) => x.id === id)
    return t ? teacherLabel(t) : id
  }
  const q = query.trim().toLowerCase()
  const schools = result.schools.filter((d) => (!onlyChanged || schoolChanged(d)) && (!q || schoolName(d.schoolId).toLowerCase().includes(q)))
  const teachers = result.teachers.filter((d) => (!onlyChanged || teacherChanged(d) || costOf(costs.a, d.teacherId) !== costOf(costs.b, d.teacherId)) && (!q || teacherName(d.teacherId).toLowerCase().includes(q)))
  const totalA = [...costs.a.values()].reduce((n, c) => n + c.cost, 0)
  const totalB = [...costs.b.values()].reduce((n, c) => n + c.cost, 0)

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <PageHeader
        title="So sánh hai tuần"
        subtitle="Ghép ca theo trường, lớp, môn và thứ trong tuần. Tuần A là gốc, tuần B là tuần so sánh."
        actions={<Link to="/weeks" className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-emerald-700"><ArrowLeft size={14} />Lịch tuần & lưu trữ</Link>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <WeekSelect label="Tuần A" weeks={weeks} value={weekA.id} onChange={(a) => update({ a })} />
        <Button variant="ghost" title="Đổi chiều so sánh" aria-label="Đổi chiều so sánh" onClick={() => update({ a: weekB.id, b: weekA.id })}><ArrowLeftRight size={14} /></Button>
        <WeekSelect label="Tuần B" weeks={weeks} value={weekB.id} onChange={(b) => update({ b })} />
        {weekA.id === weekB.id && <span className="text-xs text-amber-700">Đang so một tuần với chính nó.</span>}
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Số ca" value={<Delta a={weekA.lessons.length} b={weekB.lessons.length} />} />
        <Stat label="Trường có thay đổi" value={result.schools.filter(schoolChanged).length} hint={`trên ${result.schools.length} trường`} />
        <Stat label="GV có thay đổi" value={result.teachers.filter(teacherChanged).length} hint={`trên ${result.teachers.length} GV có ca`} />
        <Stat label="Chi phí đi lại" value={<Delta a={totalA} b={totalB} format={money} />} />
      </div>

      <Card
        title={
          <div role="tablist" className="flex gap-2">
            {(['school', 'teacher'] as const).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => update({ view: k })} className={clsx('rounded-full border px-3.5 py-1.5 text-sm font-medium', tab === k ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100')}>
                {k === 'school' ? 'Theo trường' : 'Theo giáo viên'}
              </button>
            ))}
          </div>
        }
        actions={
          <>
            <input type="search" placeholder={tab === 'school' ? 'Tìm trường' : 'Tìm giáo viên'} value={query} onChange={(e) => setQuery(e.target.value)} className="w-48" />
            <label className="flex items-center gap-1.5 text-sm text-slate-600"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} />Chỉ hiện chỗ thay đổi</label>
          </>
        }
      >
        {tab === 'school' ? (
          schools.length ? (
            <ul className="divide-y divide-slate-100">
              {schools.map((d) => <SchoolRow key={d.schoolId} d={d} name={schoolName(d.schoolId)} teacherName={teacherName} />)}
            </ul>
          ) : <Empty>Không có trường nào thay đổi.</Empty>
        ) : teachers.length ? (
          <ul className="divide-y divide-slate-100">
            {teachers.map((d) => <TeacherRow key={d.teacherId} d={d} name={teacherName(d.teacherId)} costA={costOf(costs.a, d.teacherId)} costB={costOf(costs.b, d.teacherId)} schoolName={schoolName} teacherName={teacherName} />)}
          </ul>
        ) : <Empty>Không có giáo viên nào thay đổi.</Empty>}
      </Card>
    </div>
  )
}

const costOf = (m: Map<string, { cost: number }>, id: string) => m.get(id)?.cost ?? 0

function WeekSelect({ label, weeks, value, onChange }: { label: string; weeks: Week[]; value: string; onChange: (id: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium text-slate-500">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="font-medium">
        {[...weeks].reverse().map((w) => <option key={w.id} value={w.id}>{weekText(w)} · {w.status === 'planning' ? 'Đang lập' : 'Đã lưu trữ'}</option>)}
      </select>
    </label>
  )
}

function Delta({ a, b, format = String }: { a: number; b: number; format?: (n: number) => string }) {
  const d = b - a
  return (
    <span>
      {format(a)} → {format(b)}
      {d !== 0 && <span className={clsx('ml-2 text-sm', d > 0 ? 'text-amber-700' : 'text-emerald-700')}>{d > 0 ? '+' : '−'}{format(Math.abs(d))}</span>}
    </span>
  )
}

function Counts({ plus, minus, changed }: { plus: number; minus: number; changed: number }) {
  return (
    <span className="flex gap-1.5">
      {plus > 0 && <Badge tone="green">+{plus}</Badge>}
      {minus > 0 && <Badge tone="red">−{minus}</Badge>}
      {changed > 0 && <Badge tone="amber">~{changed}</Badge>}
    </span>
  )
}

function Expandable({ head, children }: { head: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={14} className="shrink-0 text-slate-400" /> : <ChevronRight size={14} className="shrink-0 text-slate-400" />}
        {head}
      </button>
      {open && <div className="space-y-4 bg-slate-50/60 px-12 pb-4 pt-1">{children}</div>}
    </li>
  )
}

function Section({ title, tone, children }: { title: string; tone: 'green' | 'red' | 'amber'; children: ReactNode[] }) {
  if (!children.length) return null
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><Badge tone={tone}>{children.length}</Badge>{title}</div>
      <ul className="space-y-1 text-sm">{children}</ul>
    </div>
  )
}

/** Mô tả ngắn chỗ đổi của một cặp ca. */
function changeText(p: LessonPair, teacherName: (id: string | null) => string, skipTeacher = false): string[] {
  const { a, b } = p
  if (!a || !b) return []
  const out: string[] = []
  if (p.changes.includes('day') || p.changes.includes('time')) out.push(`${when(a)} → ${when(b)}`)
  if (p.changes.includes('teacher') && !skipTeacher) out.push(`GV: ${teacherName(teacherOf(a))} → ${teacherName(teacherOf(b))}`)
  if (p.changes.includes('status')) out.push(`${STATUS[a.status]} → ${STATUS[b.status]}`)
  if (p.changes.includes('code')) out.push(`Mã: ${a.code ?? '—'} → ${b.code ?? '—'}`)
  return out
}

function SchoolRow({ d, name, teacherName }: { d: SchoolDiff; name: string; teacherName: (id: string | null) => string }) {
  return (
    <Expandable
      head={
        <>
          <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
          {d.presence === 'onlyB' && <Badge tone="green">Mới có lịch</Badge>}
          {d.presence === 'onlyA' && <Badge tone="red">Không còn lịch</Badge>}
          <Counts plus={d.added.length} minus={d.removed.length} changed={d.changed.length} />
          <span className="tnum w-20 text-right text-sm text-slate-500">{d.countA} → {d.countB} ca</span>
        </>
      }
    >
      <div><EntityAnchor kind="school" id={d.schoolId} className="text-xs text-slate-500">Mở hồ sơ trường</EntityAnchor></div>
      {!schoolChanged(d) && <div className="text-sm text-slate-500">Lịch hai tuần giống nhau.</div>}
      <Section title="Lớp mới ở tuần B" tone="green">
        {d.added.map((p) => <li key={p.b!.id}>{when(p.b!)} · {what(p.b!)} · <span className="text-slate-500">{teacherName(teacherOf(p.b))}</span></li>)}
      </Section>
      <Section title="Không còn ở tuần B" tone="red">
        {d.removed.map((p) => <li key={p.a!.id}>{when(p.a!)} · {what(p.a!)} · <span className="text-slate-500">{teacherName(teacherOf(p.a))}</span></li>)}
      </Section>
      <Section title="Thay đổi" tone="amber">
        {d.changed.map((p) => <li key={p.b!.id}><span className="font-medium">{what(p.b!)}</span> · {changeText(p, teacherName).join(' · ')}</li>)}
      </Section>
    </Expandable>
  )
}

function TeacherRow({ d, name, costA, costB, schoolName, teacherName }: {
  d: TeacherDiff; name: string; costA: number; costB: number; schoolName: (id: string) => string; teacherName: (id: string | null) => string
}) {
  const line = (l: Lesson) => `${when(l)} · ${schoolName(l.schoolId)} · ${what(l)}`
  return (
    <Expandable
      head={
        <>
          <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
          <Counts plus={d.gained.length} minus={d.lost.length} changed={d.changed.length} />
          <span className="tnum w-20 text-right text-sm text-slate-500">{d.countA} → {d.countB} ca</span>
          <span className="tnum w-48 text-right text-sm text-slate-500"><Delta a={costA} b={costB} format={money} /></span>
        </>
      }
    >
      <div><EntityAnchor kind="teacher" id={d.teacherId} className="text-xs text-slate-500">Mở hồ sơ giáo viên</EntityAnchor></div>
      {(d.schoolsAdded.length > 0 || d.schoolsRemoved.length > 0) && (
        <div className="flex flex-wrap gap-1.5 text-sm">
          {d.schoolsAdded.map((id) => <Badge key={id} tone="green">+ {schoolName(id)}</Badge>)}
          {d.schoolsRemoved.map((id) => <Badge key={id} tone="red">− {schoolName(id)}</Badge>)}
        </div>
      )}
      {!teacherChanged(d) && <div className="text-sm text-slate-500">Ca dạy giống nhau; chi phí đổi do quãng đường hoặc biểu giá.</div>}
      <Section title="Nhận thêm ở tuần B" tone="green">
        {d.gained.map((p) => <li key={p.b!.id}>{line(p.b!)}{p.a && <span className="text-slate-500"> · trước đó: {teacherName(teacherOf(p.a))}</span>}</li>)}
      </Section>
      <Section title="Không còn dạy ở tuần B" tone="red">
        {d.lost.map((p) => (
          <li key={p.a!.id}>
            {line(p.a!)}
            <span className="text-slate-500"> · {!p.b ? 'lớp không còn' : teacherOf(p.b) ? `chuyển cho ${teacherName(teacherOf(p.b))}` : STATUS[p.b.status]}</span>
          </li>
        ))}
      </Section>
      <Section title="Đổi lịch" tone="amber">
        {d.changed.map((p) => <li key={p.b!.id}>{schoolName(p.b!.schoolId)} · {what(p.b!)} · {changeText(p, teacherName, true).join(' · ')}</li>)}
      </Section>
    </Expandable>
  )
}
