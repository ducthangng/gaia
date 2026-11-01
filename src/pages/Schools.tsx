import { AlertTriangle, FileDown, MapPin, PanelLeftClose, PanelLeftOpen, Plus, Star, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, useParams, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { EntityAnchor } from '../components/EntityLink'
import { SchoolsTable } from '../components/InfoTables'
import { openNewSchoolDialog } from '../components/NewSchoolDialog'
import { ViewSwitch } from '../components/InlineCell'
import { CoverSuggestions } from '../components/CoverSuggestions'
import { MovementPanel, type MovementSelection } from '../components/MovementPanel'
import { WeekTimeGrid } from '../components/WeekTimeGrid'
import { Badge, Button, Card, Empty, PageHeader } from '../components/ui'
import { coverage, schoolLoad, touchesSchool, type Issue } from '../domain/issues'
import { teacherLabel, type School } from '../domain/types'
import { useWeekContext, useWeekIssues, type Ctx } from '../hooks'
import { exportSchoolSchedule } from '../services/exports'
import { useStore } from '../store'

export function SchoolsPage() {
  const [params] = useSearchParams()
  if (params.get('view') === 'table') return <SchoolsTable />
  return <SchoolsDetail />
}

function SchoolsDetail() {
  const { id } = useParams()
  const ctx = useWeekContext()
  const [q, setQ] = useState('')
  const [listOpen, setListOpen] = useState(true)
  const stats = useMemo(() => schoolLoad(ctx.week.lessons), [ctx.week.lessons])
  const issues = useWeekIssues(ctx)
  const list = ctx.world.schools
    .filter((s) => s.fullName.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => (stats.get(b.id) ?? 0) - (stats.get(a.id) ?? 0) || a.fullName.localeCompare(b.fullName, 'vi'))
  const school = (id ? ctx.schoolById.get(id) : undefined) ?? list[0]

  return (
    <div className="mx-auto flex h-full max-w-[1700px] flex-col gap-4">
    <div className="flex items-center justify-between gap-3"><ViewSwitch /><Button onClick={openNewSchoolDialog}><Plus size={14} />Thêm trường</Button></div>
    <div className={clsx('grid min-h-0 w-full flex-1 gap-6', listOpen ? 'grid-cols-[270px_minmax(0,1fr)]' : 'grid-cols-[minmax(0,1fr)]')}>
      {listOpen && <Card className="flex min-h-0 flex-col self-stretch overflow-hidden">
        <div className="border-b border-slate-100 p-3"><input aria-label="Tìm trường" className="w-full" placeholder="Tìm trường…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          {list.map((s) => (
            <NavLink key={s.id} to={`/schools/${s.id}`} className={clsx('flex items-center justify-between gap-2 rounded-md px-3 py-2', s.id === school?.id ? 'bg-emerald-50 font-medium text-emerald-900' : 'hover:bg-slate-100', !stats.get(s.id) && 'text-slate-400')}>
              <span className="truncate">{s.fullName}</span>
              {!!stats.get(s.id) && <span className="tnum text-xs text-slate-500">{stats.get(s.id)}</span>}
            </NavLink>
          ))}
        </nav>
      </Card>}
      {school ? <SchoolDetail key={school.id} school={school} ctx={ctx} issues={issues.filter((i) => touchesSchool(i, school.id))} listToggle={
        <Button variant="ghost" aria-label={listOpen ? 'Ẩn danh sách trường' : 'Hiện danh sách trường'} title={listOpen ? 'Ẩn danh sách trường để lịch rộng hơn' : 'Hiện danh sách trường'} onClick={() => setListOpen((x) => !x)}>
          {listOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}{listOpen ? 'Ẩn danh sách' : 'Danh sách trường'}
        </Button>
      } /> : <Empty>Không có trường nào.</Empty>}
    </div>
    </div>
  )
}

function SchoolDetail({ school: s, ctx, issues, listToggle }: { school: School; ctx: Ctx; issues: Issue[]; listToggle: ReactNode }) {
  const [params] = useSearchParams()
  const [selection, setSelection] = useState<MovementSelection>(() => {
    const lesson = ctx.week.lessons.find((l) => l.id === params.get('lesson'))
    return { teacherId: lesson?.teacherId ?? '', lessonId: lesson?.id ?? '' }
  })
  const panelRef = useRef<HTMLDivElement>(null)
  const scrollToMap = () => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  useEffect(() => {
    if (params.get('lesson')) scrollToMap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const updateSchool = useStore((st) => st.updateSchool)
  const lessons = ctx.week.lessons.filter((l) => l.schoolId === s.id)
  const cov = coverage(lessons)
  const sameName = ctx.world.schools.filter((x) => x.id !== s.id && x.name && x.name === s.name)
  return (
    <div className="min-w-0 space-y-6 overflow-y-auto pb-6">
      <PageHeader
        title={s.fullName}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1"><MapPin size={13} />{s.address || 'Chưa có địa chỉ cụ thể'}</span>
          {s.region && <Badge>{s.region}</Badge>}
          {s.programs.map((p) => <Badge key={p.program} tone="blue" title={[p.company, p.framework, p.startDate && `Khai giảng ${p.startDate}`].filter(Boolean).join(' · ')}>{p.program}</Badge>)}
        </span>}
        actions={<>
          {listToggle}
          <Badge tone={cov.ratio < 1 ? 'red' : 'green'}>Độ phủ {cov.covered}/{cov.required}</Badge>
          <Button onClick={() => exportSchoolSchedule(ctx, s.id)}><FileDown size={14} />Excel</Button>
          <Button onClick={() => window.open(`/print/school/${s.id}`, '_blank')}><FileDown size={14} />PDF</Button>
        </>}
      />
      {sameName.length > 0 && !s.address && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            Trùng tên với {sameName.map((x) => x.fullName).join(', ')}. Cần nhập địa chỉ cụ thể để phân biệt:
            <input aria-label="Địa chỉ trường" className="ml-2 w-80" placeholder="Địa chỉ cụ thể" onBlur={(e) => e.target.value && updateSchool(s.id, { address: e.target.value })} />
          </div>
        </div>
      )}
      <Card title="Lịch học trong tuần">
        <WeekTimeGrid schoolId={s.id} lessons={lessons} ctx={ctx} issues={issues} onShowOnMap={(l) => {
          setSelection({ teacherId: l.teacherId ?? '', lessonId: l.id })
          scrollToMap()
        }} />
      </Card>
      <CoverSuggestions schoolId={s.id} ctx={ctx} />
      <div ref={panelRef} className="scroll-mt-2">
        <MovementPanel school={s} ctx={ctx} issues={issues} selection={selection} onSelect={setSelection} />
      </div>
      <ReferEditor school={s} ctx={ctx} />
    </div>
  )
}

function ReferEditor({ school: s, ctx }: { school: School; ctx: Ctx }) {
  const toggleRefer = useStore((st) => st.toggleRefer)
  const updateSchool = useStore((st) => st.updateSchool)
  const others = ctx.world.teachers.filter((t) => t.active && !s.referredTeacherIds.includes(t.id))
  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Star size={14} />Danh sách giáo viên Refer</span>} actions={s.referSource === 'derived' ? (
      <Button variant="ghost" className="text-xs" onClick={() => updateSchool(s.id, { referSource: 'confirmed' })}>Xác nhận danh sách</Button>
    ) : <Badge tone="green">Gaia đã xác nhận</Badge>}>
      <div className="space-y-3 p-5">
        {s.referSource === 'derived' && (
          <p className="text-xs text-amber-800">Workbook không có danh sách Refer. Danh sách tạm này suy ra từ các GV dạy chính ổn định tại trường trong 6 tuần gần nhất và cần Gaia xác nhận.</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {s.referredTeacherIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 py-0.5 pl-2.5 pr-1 text-emerald-900">
              <EntityAnchor kind="teacher" id={id}>{ctx.teacherById.get(id) ? teacherLabel(ctx.teacherById.get(id)!) : id}</EntityAnchor>
              <button aria-label="Bỏ khỏi danh sách Refer" className="rounded-full p-0.5 hover:bg-emerald-200" onClick={() => toggleRefer(s.id, id)}><X size={12} /></button>
            </span>
          ))}
          {!s.referredTeacherIds.length && <span className="text-slate-500">Chưa có giáo viên nào.</span>}
        </div>
        <select aria-label="Thêm giáo viên Refer" value="" onChange={(e) => e.target.value && toggleRefer(s.id, e.target.value)}>
          <option value="">+ Thêm giáo viên</option>
          {others.map((t) => <option key={t.id} value={t.id}>{teacherLabel(t)}</option>)}
        </select>
      </div>
    </Card>
  )
}
