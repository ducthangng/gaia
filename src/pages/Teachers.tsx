import clsx from 'clsx'
import { ArrowRight, CalendarOff, FileDown, Home, MapPin, Phone, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { NavLink, useParams } from 'react-router-dom'
import { openLeaveDialog } from '../components/LeaveDialog'
import { LessonChip } from '../components/LessonChip'
import { Badge, Button, Card, Empty, PageHeader, Stat } from '../components/ui'
import { byTime, routeForWeek, tally, type RouteLeg } from '../domain/route'
import { DAY_LABELS, dayLabel, money, SESSION_LABEL, weekDates } from '../domain/time'
import { teacherLabel, type Gender, type Preference, type Session, type Teacher } from '../domain/types'
import { useWeekContext, weekCosts, type Ctx } from '../hooks'
import { exportTeacherSchedule } from '../services/exports'
import { useStore } from '../store'

export function TeachersPage() {
  const { id } = useParams()
  const ctx = useWeekContext()
  const [q, setQ] = useState('')
  const costs = useMemo(() => new Map(weekCosts(ctx).map((c) => [c.teacherId, c])), [ctx])
  const list = ctx.world.teachers
    .filter((t) => (t.active || costs.get(t.id)?.km) && `${t.name} ${t.id} ${t.district}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  const teacher = (id ? ctx.teacherById.get(id) : undefined) ?? list[0]
  const count = (tid: string) => ctx.week.lessons.filter((l) => l.teacherId === tid && l.status === 'assigned').length
  return (
    <div className="mx-auto grid h-full max-w-[1500px] grid-cols-[260px_minmax(0,1fr)] gap-4">
      <Card className="flex min-h-0 flex-col overflow-hidden">
        <div className="border-b border-slate-100 p-2"><input aria-label="Tìm giáo viên" className="w-full" placeholder="Tìm giáo viên, khu vực…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <nav className="min-h-0 flex-1 overflow-y-auto p-1">
          {list.map((t) => (
            <NavLink key={t.id} to={`/teachers/${t.id}`} className={clsx('block rounded px-2 py-1.5', t.id === teacher?.id ? 'bg-emerald-50 text-emerald-900' : 'hover:bg-slate-100')}>
              <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{teacherLabel(t)}</span><span className="tnum text-xs text-slate-500">{count(t.id)}</span></div>
              <div className="truncate text-xs text-slate-500">{t.district ?? 'Chưa rõ khu vực'}</div>
            </NavLink>
          ))}
        </nav>
      </Card>
      {teacher ? <TeacherDetail key={teacher.id} teacher={teacher} ctx={ctx} /> : <Empty>Không có giáo viên nào.</Empty>}
    </div>
  )
}

function TeacherDetail({ teacher: t, ctx }: { teacher: Teacher; ctx: Ctx }) {
  const allLeaves = useStore((s) => s.leaves)
  const lessons = ctx.week.lessons.filter((l) => l.teacherId === t.id)
  const dates = weekDates(ctx.week.startDate)
  const routes = dates.map((d) => routeForWeek(ctx.week, t, d, ctx))
  const totalKm = routes.reduce((s, r) => s + r.totalKm, 0)
  const paidKm = routes.reduce((s, r) => s + r.legs.reduce((x, l) => x + l.km, 0), 0)
  const cost = routes.reduce((s, r) => s + r.cost, 0)
  const credits = tally(lessons)
  return (
    <div className="min-w-0 space-y-4 overflow-y-auto">
      <PageHeader
        title={teacherLabel(t)}
        subtitle={<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          {t.phone && <span className="inline-flex items-center gap-1"><Phone size={12} />{t.phone}</span>}
          <span className="inline-flex items-center gap-1"><MapPin size={12} />{t.address ?? t.district ?? 'Chưa có địa chỉ'}</span>
          <Badge>{ctx.officeName(t.officeId)}</Badge>
          {t.track && <Badge tone="blue">{t.track}</Badge>}
          {t.isCollaborator && <Badge tone="violet">Cộng tác viên</Badge>}
          {t.onlineOnly && <Badge tone="amber">Chỉ làm online</Badge>}
          {t.areas.length > 0 && <span>Khu vực mong muốn: {t.areas.join(', ')}</span>}
        </span>}
        actions={<>
          <Button variant="primary" onClick={() => openLeaveDialog({ teacherId: t.id })}><CalendarOff size={14} />Xin nghỉ</Button>
          <Button onClick={() => exportTeacherSchedule(ctx, t.id)}><FileDown size={14} />Excel</Button>
          <Button onClick={() => window.open(`/print/teacher/${t.id}`, '_blank')}><FileDown size={14} />PDF</Button>
        </>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Số ca trong tuần" value={lessons.filter((l) => l.status === 'assigned').length} hint={`KNS ${credits.kns} · STEM ${credits.stem} · CDS/AI ${credits.cds} tiết quy đổi`} />
        <Stat label="Quãng đường ước tính" value={`${Math.round(totalKm)} km`} hint={`${Math.round(paidKm)} km là các chặng tính tiền`} />
        <Stat label="Chi phí di chuyển" value={money(cost)} />
        <Stat label="Số ngày đi dạy" value={routes.filter((r) => r.legs.length).length} />
      </div>
      <Card title="Lịch trình theo ngày">
        <div className="divide-y divide-slate-100">
          {dates.map((d, i) => {
            const day = lessons.filter((l) => l.date === d).sort(byTime)
            const r = routes[i]
            const dayLeaves = allLeaves.filter((x) => x.teacherId === t.id && x.date === d)
            if (!day.length && !r.legs.length && !dayLeaves.length) return null
            return (
              <div key={d} className="px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="mr-2 w-24 font-semibold">{dayLabel(d)}</span>
                  {r.legs.map((leg, n) => <LegView key={n} leg={leg} date={d} teacherId={t.id} ctx={ctx} />)}
                  {r.legs.length > 0 && <>
                    <ArrowRight size={13} className="text-slate-400" />
                    <span className="inline-flex items-center gap-1 text-slate-500" title="Chặng về nhà: tính vào tổng lộ trình, biểu giá theo bậc không trả tiền chặng này"><Home size={12} />{r.returnKm} km</span>
                  </>}
                  {dayLeaves.map((x) => <Badge key={x.id} tone="red"><CalendarOff size={10} />{SESSION_LABEL[x.session]}: {x.note}</Badge>)}
                  <span className="ml-auto flex items-center gap-3">
                    {ctx.week.status === 'planning' && day.length > 0 && <Button variant="ghost" className="!py-0.5 text-xs" onClick={() => openLeaveDialog({ teacherId: t.id, date: d })}><CalendarOff size={12} />Xin nghỉ ngày này</Button>}
                    <span className="tnum font-semibold">{money(r.cost)}</span>
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(145px,1fr))] gap-1.5">
                  {day.map((l) => <LessonChip key={l.id} lesson={l} ctx={ctx} show="school" />)}
                </div>
              </div>
            )
          })}
          {!lessons.length && <Empty>Tuần này chưa có ca dạy.</Empty>}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <PreferencesCard teacher={t} />
        <LeaveCard teacher={t} ctx={ctx} />
      </div>
    </div>
  )
}

function LegView({ leg, date, teacherId, ctx }: { leg: RouteLeg; date: string; teacherId: string; ctx: Ctx }) {
  const setKm = useStore((s) => s.setKmOverride)
  const to = ctx.schoolById.get(leg.toSchoolId)?.fullName ?? 'Không rõ địa điểm'
  const from = leg.fromLabel || ctx.schoolById.get(leg.fromSchoolId ?? '')?.name || 'Trường trước'
  const editable = ctx.week.status === 'planning'
  return (
    <span className="inline-flex flex-wrap items-center gap-1 text-slate-700">
      {leg.start !== 'K' && <span className="font-medium">{from}</span>}
      <ArrowRight size={13} className="text-slate-400" />
      <span className="max-w-64 truncate" title={to}>{to}</span>
      {editable ? (
        <label className="inline-flex items-center gap-0.5 text-xs text-slate-500" title="Sửa số km của chặng này">
          <input aria-label={`Số km đến ${to}`} type="number" min={0} className="tnum w-12 !px-1 !py-0 text-xs" key={leg.km} defaultValue={leg.km} onBlur={(e) => {
            const v = Number(e.target.value)
            if (e.target.value !== '' && v !== leg.km) setKm(ctx.week.id, teacherId, date, leg.toSchoolId, v)
          }} />
          km
        </label>
      ) : <span className="tnum text-xs text-slate-500">{leg.km} km</span>}
      {leg.source === 'estimated' && <Badge tone="amber" title="Chưa có km ghi nhận cho chặng này, đang ước tính theo khu vực">ước tính</Badge>}
      {leg.source === 'manual' && <Badge tone="blue">đã sửa</Badge>}
    </span>
  )
}

function PreferencesCard({ teacher: t }: { teacher: Teacher }) {
  const update = useStore((s) => s.updateTeacher)
  const [type, setType] = useState<Preference['type']>('finishBy')
  const [time, setTime] = useState('16:00')
  const [session, setSession] = useState<Session>('PM')
  const [days, setDays] = useState<number[]>([])
  const [note, setNote] = useState('')
  const describe = (p: Preference) => {
    const when = p.days?.length ? ` (${p.days.map((d) => DAY_LABELS[d]).join(', ')})` : ''
    const text = p.type === 'finishBy' ? `Kết thúc trước ${p.time}` : p.type === 'startAfter' ? `Bắt đầu sau ${p.time}` : `Không nhận ca ${SESSION_LABEL[p.session].toLowerCase()}`
    return `${text}${when}${p.note ? ` – ${p.note}` : ''}`
  }
  const add = () => {
    const base = { id: `p-${Date.now()}`, days: days.length ? days : undefined, note: note || undefined }
    const pref: Preference = type === 'noSession' ? { ...base, type, session } : { ...base, type, time }
    update(t.id, { preferences: [...t.preferences, pref] })
    setNote('')
    setDays([])
  }
  return (
    <Card title="Nguyện vọng cá nhân">
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1.5 text-slate-600">Giới tính
            <select value={t.gender ?? ''} onChange={(e) => update(t.id, { gender: (e.target.value || null) as Gender | null })}>
              <option value="">Chưa khai báo</option><option value="F">Nữ</option><option value="M">Nam</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-slate-600">Phạm vi tối đa
            <input type="number" min={0} className="w-16" value={t.maxKm ?? ''} onChange={(e) => update(t.id, { maxKm: e.target.value === '' ? null : Number(e.target.value) })} /> km
          </label>
        </div>
        {t.preferences.length ? (
          <ul className="space-y-1">
            {t.preferences.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1">
                {describe(p)}
                <button aria-label="Xoá nguyện vọng" className="text-slate-400 hover:text-red-600" onClick={() => update(t.id, { preferences: t.preferences.filter((x) => x.id !== p.id) })}><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        ) : <p className="text-slate-500">Chưa có nguyện vọng nào. Workbook hiện chưa lưu thông tin này.</p>}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <select aria-label="Loại nguyện vọng" value={type} onChange={(e) => setType(e.target.value as Preference['type'])}>
            <option value="finishBy">Kết thúc trước</option><option value="startAfter">Bắt đầu sau</option><option value="noSession">Không nhận buổi</option>
          </select>
          {type === 'noSession' ? (
            <select aria-label="Buổi" value={session} onChange={(e) => setSession(e.target.value as Session)}><option value="AM">Sáng</option><option value="PM">Chiều</option></select>
          ) : <input aria-label="Giờ" type="time" value={time} onChange={(e) => setTime(e.target.value)} />}
          <input aria-label="Lý do" className="w-36" placeholder="Lý do (đón con…)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-0.5">
            {DAY_LABELS.slice(0, 6).map((d, i) => (
              <button key={d} title={`Chỉ áp dụng ${d}`} onClick={() => setDays((x) => (x.includes(i) ? x.filter((y) => y !== i) : [...x, i]))} className={clsx('rounded px-1.5 py-1 text-xs', days.includes(i) ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-600')}>{d.replace('Thứ ', 'T')}</button>
            ))}
          </div>
          <Button onClick={add}><Plus size={13} />Thêm</Button>
        </div>
      </div>
    </Card>
  )
}

function LeaveCard({ teacher: t, ctx }: { teacher: Teacher; ctx: Ctx }) {
  const leaves = useStore((s) => s.leaves)
  const removeLeave = useStore((s) => s.removeLeave)
  const mine = leaves.filter((l) => l.teacherId === t.id && l.date >= ctx.week.startDate).sort((a, b) => a.date.localeCompare(b.date))
  return (
    <Card title="Lịch nghỉ đã đăng ký" actions={<Button className="!py-1 text-xs" onClick={() => openLeaveDialog({ teacherId: t.id })}><Plus size={13} />Thêm</Button>}>
      <ul className="max-h-56 space-y-1 overflow-y-auto p-4">
        {mine.map((l) => (
          <li key={l.id} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1">
            <span>{dayLabel(l.date)} · {SESSION_LABEL[l.session]} · {l.note}</span>
            <button aria-label="Huỷ ngày nghỉ" title="Huỷ nghỉ: các ca chưa có người thay sẽ trả về giáo viên này" className="text-slate-400 hover:text-red-600" onClick={() => removeLeave(l.id)}><Trash2 size={13} /></button>
          </li>
        ))}
        {!mine.length && <li className="text-slate-500">Không có ngày nghỉ từ tuần này trở đi.</li>}
      </ul>
    </Card>
  )
}
