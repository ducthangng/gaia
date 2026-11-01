import { AlertTriangle, FileDown, MapPin, Star, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import clsx from 'clsx'
import { LessonChip } from '../components/LessonChip'
import { Badge, Button, Card, Empty, PageHeader } from '../components/ui'
import { coverage } from '../domain/issues'
import { byTime } from '../domain/route'
import { dayLabel, weekDates } from '../domain/time'
import type { School } from '../domain/types'
import { useWeekContext, type Ctx } from '../hooks'
import { exportSchoolSchedule } from '../services/exports'
import { useStore } from '../store'

export function SchoolsPage() {
  const { id } = useParams()
  const ctx = useWeekContext()
  const [q, setQ] = useState('')
  const stats = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of ctx.week.lessons) m.set(l.schoolId, (m.get(l.schoolId) ?? 0) + 1)
    return m
  }, [ctx.week.lessons])
  const list = ctx.world.schools
    .filter((s) => s.fullName.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(!!stats.get(b.id)) - Number(!!stats.get(a.id)) || a.fullName.localeCompare(b.fullName, 'vi'))
  const school = (id ? ctx.schoolById.get(id) : undefined) ?? list[0]

  return (
    <div className="mx-auto grid h-full max-w-[1500px] grid-cols-[260px_minmax(0,1fr)] gap-4">
      <Card className="flex min-h-0 flex-col self-stretch overflow-hidden">
        <div className="border-b border-slate-100 p-2"><input aria-label="Tìm trường" className="w-full" placeholder="Tìm trường…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-1">
          {list.map((s) => (
            <NavLink key={s.id} to={`/schools/${s.id}`} className={clsx('flex items-center justify-between gap-2 rounded px-2 py-1.5', s.id === school?.id ? 'bg-emerald-50 font-medium text-emerald-900' : 'hover:bg-slate-100', !stats.get(s.id) && 'text-slate-400')}>
              <span className="truncate">{s.fullName}</span>
              {!!stats.get(s.id) && <span className="tnum text-xs text-slate-500">{stats.get(s.id)}</span>}
            </NavLink>
          ))}
        </nav>
      </Card>
      {school ? <SchoolDetail key={school.id} school={school} ctx={ctx} /> : <Empty>Không có trường nào.</Empty>}
    </div>
  )
}

function SchoolDetail({ school: s, ctx }: { school: School; ctx: Ctx }) {
  const updateSchool = useStore((st) => st.updateSchool)
  const lessons = ctx.week.lessons.filter((l) => l.schoolId === s.id)
  const dates = weekDates(ctx.week.startDate).filter((d, i) => i < 5 || lessons.some((l) => l.date === d))
  const cov = coverage(lessons)
  const sameName = ctx.world.schools.filter((x) => x.id !== s.id && x.name && x.name === s.name)
  return (
    <div className="min-w-0 space-y-4 overflow-y-auto">
      <PageHeader
        title={s.fullName}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1"><MapPin size={13} />{s.address || 'Chưa có địa chỉ cụ thể'}</span>
          {s.region && <Badge>{s.region}</Badge>}
          {s.programs.map((p) => <Badge key={p.program} tone="blue" title={[p.company, p.framework, p.startDate && `Khai giảng ${p.startDate}`].filter(Boolean).join(' · ')}>{p.program}</Badge>)}
        </span>}
        actions={<>
          <Badge tone={cov.ratio < 1 ? 'red' : 'green'}>Độ phủ {cov.covered}/{cov.required}</Badge>
          <Button onClick={() => exportSchoolSchedule(ctx, s.id)}><FileDown size={14} />Excel</Button>
          <Button onClick={() => window.open(`/print/school/${s.id}`, '_blank')}><FileDown size={14} />PDF</Button>
        </>}
      />
      {sameName.length > 0 && !s.address && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <div>
            Trùng tên với {sameName.map((x) => x.fullName).join(', ')}. Workbook mới phân biệt bằng khu vực, nên cần nhập địa chỉ cụ thể:
            <input aria-label="Địa chỉ trường" className="ml-2 w-80" placeholder="Địa chỉ cụ thể" onBlur={(e) => e.target.value && updateSchool(s.id, { address: e.target.value })} />
          </div>
        </div>
      )}
      <Card title="Lịch học trong tuần">
        {lessons.length === 0 ? <Empty>Tuần này trường chưa có ca nào.</Empty> : (
          <div className="grid gap-px overflow-x-auto bg-slate-100" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(130px, 1fr))` }}>
            {dates.map((d) => {
              const day = lessons.filter((l) => l.date === d).sort(byTime)
              return (
                <div key={d} className="bg-white">
                  <div className="sticky top-0 border-b border-slate-100 bg-white px-2 py-1.5 text-xs font-semibold text-slate-600">{dayLabel(d)}</div>
                  <div className="space-y-1 p-1">
                    {day.map((l) => <LessonChip key={l.id} lesson={l} ctx={ctx} show="teacher" />)}
                    {!day.length && <div className="px-1 py-2 text-xs text-slate-300">Không có ca</div>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>
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
      <div className="space-y-2 p-4">
        {s.referSource === 'derived' && (
          <p className="text-xs text-amber-800">Workbook không có danh sách Refer. Danh sách tạm này suy ra từ các GV dạy chính ổn định tại trường trong 6 tuần gần nhất và cần Gaia xác nhận.</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {s.referredTeacherIds.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 py-0.5 pl-2.5 pr-1 text-emerald-900">
              {ctx.teacherById.get(id)?.name ?? id}
              <button aria-label="Bỏ khỏi danh sách Refer" className="rounded-full p-0.5 hover:bg-emerald-200" onClick={() => toggleRefer(s.id, id)}><X size={12} /></button>
            </span>
          ))}
          {!s.referredTeacherIds.length && <span className="text-slate-500">Chưa có giáo viên nào.</span>}
        </div>
        <select aria-label="Thêm giáo viên Refer" value="" onChange={(e) => e.target.value && toggleRefer(s.id, e.target.value)}>
          <option value="">+ Thêm giáo viên</option>
          {others.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.id})</option>)}
        </select>
      </div>
    </Card>
  )
}
