import clsx from 'clsx'
import { ArrowRight, Check, Clock, ExternalLink, Home, Info } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { googleDirectionsUrl, googleSearchUrl, isPrecise, parseLatLng, type MapPlace } from '../domain/geo'
import { ISSUE_META, type Issue } from '../domain/issues'
import { movementTo, type Movement } from '../domain/movement'
import { byTime } from '../domain/route'
import { dayLabel, SESSION_LABEL } from '../domain/time'
import { teacherLabel, type GeoPoint, type Lesson, type School, type Teacher } from '../domain/types'
import type { Ctx } from '../hooks'
import { useStore } from '../store'
import { LessonChip } from './LessonChip'
import { SEVERITY_COLOR, SEVERITY_ICON } from './SchoolAlerts'
import type { MapDot, RoadInfo } from './TravelMap'
import { Badge, Button, Card, toast } from './ui'

const TravelMap = lazy(() => import('./TravelMap'))

export interface MovementSelection {
  teacherId: string
  lessonId: string
}

const dot = (id: string, name: string, geo?: GeoPoint): MapDot | null => (geo ? { id, name, lat: geo.lat, lng: geo.lng, approximate: !isPrecise(geo) } : null)

const homeDot = (t?: Teacher): MapDot | null => {
  if (!t?.homeGeo) return null
  const precise = isPrecise(t.homeGeo)
  return { id: `home-${t.id}`, name: precise ? 'Nhà giáo viên' : `Nhà giáo viên, ${t.homeArea ?? 'khu vực'}`, lat: t.homeGeo.lat, lng: t.homeGeo.lng, approximate: !precise, noRouting: true }
}

const VERDICT = {
  late: { label: 'Không kịp', tone: 'amber' as const },
  overlap: { label: 'Trùng giờ', tone: 'red' as const },
  ok: { label: 'Kịp giờ', tone: 'green' as const },
  'no-deadline': { label: 'Ca đầu ngày', tone: 'slate' as const },
}

/** Khối thống nhất: bấm cảnh báo (hoặc chọn GV + ca) là thấy ngay đường đi tới ca đó trên bản đồ. */
export function MovementPanel({ school: s, ctx, issues, selection, onSelect }: { school: School; ctx: Ctx; issues: Issue[]; selection: MovementSelection; onSelect: (x: MovementSelection) => void }) {
  const alerts = useMemo(
    () => issues.filter((i) => ISSUE_META[i.kind].severity !== 'info').sort((a, b) => a.lesson.date.localeCompare(b.lesson.date) || byTime(a.lesson, b.lesson)),
    [issues],
  )
  const notes = issues.length - alerts.length
  const selected = ctx.week.lessons.find((l) => l.id === selection.lessonId) ?? null

  const teachers = useMemo(() => {
    const ids = new Set(ctx.week.lessons.filter((l) => l.schoolId === s.id && l.status === 'assigned' && l.teacherId).map((l) => l.teacherId!))
    if (selection.teacherId) ids.add(selection.teacherId)
    return [...ids].flatMap((id) => { const t = ctx.teacherById.get(id); return t ? [t] : [] }).sort((a, b) => a.id.localeCompare(b.id))
  }, [ctx, s.id, selection.teacherId])

  const lessonOptions = useMemo(() => {
    const mine = ctx.week.lessons
      .filter((l) => l.teacherId === selection.teacherId && l.status === 'assigned' && (l.schoolId === s.id || l.id === selection.lessonId))
      .sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))
    const days = new Map<string, Lesson[]>()
    for (const l of mine) days.set(l.date, [...(days.get(l.date) ?? []), l])
    return [...days]
  }, [ctx, s.id, selection.teacherId, selection.lessonId])

  const movement = selected ? movementTo(selected, ctx) : null
  const target = selected ? ctx.schoolById.get(selected.schoolId) ?? s : s
  const focus = dot(target.id, target.fullName, target.geo)
  const fromDot = !movement || movement.alreadyThere ? null
    : movement.origin.kind === 'school' ? dot(movement.origin.schoolId, movement.origin.label, ctx.schoolById.get(movement.origin.schoolId)?.geo)
    : movement.origin.kind === 'office' ? dot(movement.origin.officeId, movement.origin.label, ctx.world.offices.find((o) => o.id === (movement.origin as { officeId: string }).officeId)?.geo)
    : homeDot(selected ? ctx.teacherById.get(selected.teacherId ?? '') : undefined)
  const [road, setRoad] = useState<RoadInfo | null>(null)

  const pickAlert = (i: Issue) => onSelect({ teacherId: i.lesson.teacherId ?? '', lessonId: i.lesson.id })

  return (
    <Card title={alerts.length ? `Bản đồ di chuyển và cảnh báo (${alerts.length})` : 'Bản đồ di chuyển'}>
      <div className={clsx('grid', alerts.length > 0 && 'lg:grid-cols-[300px_minmax(0,1fr)]')}>
        {alerts.length > 0 && (
          <div className="border-b border-slate-100 lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-500">Bấm vào cảnh báo để xem đường đi</div>
            <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto" data-testid="school-alerts">
              {alerts.map((i, n) => {
                const meta = ISSUE_META[i.kind]
                const Icon = SEVERITY_ICON[meta.severity]
                const active = selected?.id === i.lesson.id
                return (
                  <li key={`${i.kind}-${i.lesson.id}-${n}`}>
                    <button onClick={() => pickAlert(i)} aria-pressed={active} className={clsx('block w-full px-3 py-2.5 text-left hover:bg-slate-50', active && 'bg-amber-50 ring-1 ring-inset ring-amber-400')}>
                      <span className="flex items-center gap-1.5 font-medium"><Icon size={14} className={SEVERITY_COLOR[meta.severity]} />{meta.label}</span>
                      <span className="tnum mt-0.5 block text-xs text-slate-500">{dayLabel(i.lesson.date)} · {i.lesson.start ?? SESSION_LABEL[i.lesson.session]}{i.lesson.className ? ` · lớp ${i.lesson.className}` : ''}</span>
                      <span className="mt-0.5 block text-xs text-slate-700">{i.detail}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 px-4 py-2.5">
            <label className="min-w-0 flex-1 basis-52"><span className="mb-1 block text-xs font-medium text-slate-500">Giáo viên</span>
              <select aria-label="Chọn giáo viên" className="w-full" value={selection.teacherId} onChange={(e) => onSelect({ teacherId: e.target.value, lessonId: '' })}>
                <option value="">Chọn giáo viên dạy ở trường này…</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{teacherLabel(t)}</option>)}
              </select>
            </label>
            <label className="min-w-0 flex-1 basis-52"><span className="mb-1 block text-xs font-medium text-slate-500">Ca dạy</span>
              <select aria-label="Chọn ca dạy" className="w-full" disabled={!selection.teacherId} value={selection.lessonId} onChange={(e) => onSelect({ ...selection, lessonId: e.target.value })}>
                <option value="">{selection.teacherId ? 'Chọn ca dạy…' : 'Chọn giáo viên trước'}</option>
                {lessonOptions.map(([date, list]) => (
                  <optgroup key={date} label={dayLabel(date)}>
                    {list.map((l) => <option key={l.id} value={l.id}>{l.start ?? `Tiết ${l.period}`} · {l.className ?? l.note ?? 'Ca'} · {l.subject ?? '—'}{l.schoolId !== s.id ? ` · ${ctx.schoolById.get(l.schoolId)?.name}` : ''}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>
          <MovementSummary lesson={selected} movement={movement} ctx={ctx} target={target} road={road} mapped={!!fromDot} />
          <div className="relative min-h-[380px] flex-1">
            {focus ? (
              <Suspense fallback={<div className="h-full min-h-[380px] animate-pulse bg-slate-100" />}>
                <TravelMap focus={focus} from={fromDot} late={movement?.verdict === 'late'} onRoad={setRoad} />
              </Suspense>
            ) : <div className="flex h-full min-h-[380px] items-center justify-center bg-slate-50 px-4 text-center text-slate-500">{target.fullName} chưa có toạ độ để đặt lên bản đồ.</div>}
          </div>
          <LocationFooter school={target} />
        </div>
      </div>
      {notes > 0 && (
        <div className="flex items-center gap-1.5 border-t border-slate-100 px-4 py-2 text-xs text-slate-500" data-testid="school-notes">
          <Info size={12} className="text-sky-600" />
          Thêm {notes} ghi chú về Refer hoặc nguyện vọng, xem ở tab Cảnh báo.
        </div>
      )}
    </Card>
  )
}

function MovementSummary({ lesson, movement: m, ctx, target, road, mapped }: { lesson: Lesson | null; movement: Movement | null; ctx: Ctx; target: School; road: RoadInfo | null; mapped: boolean }) {
  if (!lesson) return <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500" data-testid="movement-summary">Chọn giáo viên và ca dạy để xem họ đi từ đâu tới đây.</div>
  if (!m) {
    return (
      <div className="flex items-center gap-3 border-b border-slate-100 bg-red-50 px-4 py-2" data-testid="movement-summary">
        <span className="flex-1 text-red-800">{dayLabel(lesson.date)}, lớp {lesson.className ?? '—'}: ca này chưa có giáo viên nên chưa có đường đi.</span>
        <div className="w-44 shrink-0"><LessonChip lesson={lesson} ctx={ctx} show="teacher" /></div>
      </div>
    )
  }
  const teacher = ctx.teacherById.get(lesson.teacherId!)!
  const verdict = VERDICT[m.verdict]
  const to: MapPlace = { name: target.fullName, geo: target.geo, address: target.address }
  const fromPlace: MapPlace | null = m.origin.kind === 'school'
    ? (() => { const x = ctx.schoolById.get((m.origin as { schoolId: string }).schoolId); return x ? { name: x.fullName, geo: x.geo, address: x.address } : null })()
    : m.origin.kind === 'office'
      ? (() => { const o = ctx.world.offices.find((x) => x.id === (m.origin as { officeId: string }).officeId); return o ? { name: o.name, geo: o.geo, address: o.address } : null })()
      : teacher.address ? { name: teacher.address } : null
  const link = !m.alreadyThere && fromPlace ? googleDirectionsUrl(fromPlace, to) : null
  return (
    <div className={clsx('space-y-1.5 border-b px-4 py-2.5', m.verdict === 'late' ? 'border-amber-200 bg-amber-50' : m.verdict === 'overlap' ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-slate-50')} data-testid="movement-summary">
      <div className="flex flex-wrap items-center gap-2">
        <b>{teacherLabel(teacher)}</b>
        <span className="text-slate-500">{dayLabel(lesson.date)}</span>
        <Badge tone={verdict.tone}>{m.verdict === 'ok' && <Check size={10} />}{m.alreadyThere ? 'Đã ở trường' : verdict.label}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-slate-700">
        {m.origin.kind === 'home' && <Home size={13} className="text-slate-500" />}
        <span className="font-medium" title={m.origin.kind === 'home' ? teacher.address ?? undefined : undefined}>{m.alreadyThere ? 'Ca trước cùng trường' : m.origin.kind === 'home' && teacher.homeArea ? `Nhà giáo viên (${teacher.homeArea})` : m.origin.label}</span>
        {m.previous && <span className="tnum text-xs text-slate-500">(hết ca {m.previous.end ?? '—'}, lớp {m.previous.className ?? '—'})</span>}
        <ArrowRight size={13} className="text-slate-400" />
        <span className="font-medium">{target.fullName}</span>
        <span className="tnum text-xs text-slate-500">({lesson.start ?? `tiết ${lesson.period}`}, lớp {lesson.className ?? '—'})</span>
      </div>
      {!m.alreadyThere && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700">
          <span className="tnum">Quãng đường: <b>{m.kmSource === 'estimated' ? '≈' : ''}{m.km} km</b></span>
          {m.needMin !== null && m.gapMin !== null && <span className="tnum inline-flex items-center gap-1"><Clock size={12} />Cần <b>{m.needMin}′</b>, có <b className={m.gapMin < m.needMin ? 'text-red-700' : ''}>{Math.max(m.gapMin, 0)}′</b> giữa hai ca</span>}
          {road && <span className="tnum">Đường đi trên bản đồ: {road.km.toLocaleString('vi-VN')} km, khoảng {road.minutes}′ khi đường thông thoáng</span>}
          {link && <a className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline" href={link} target="_blank" rel="noreferrer" title="Google Maps hiển thị tình trạng giao thông thực tế"><ExternalLink size={12} />Xem kẹt xe trên Google Maps</a>}
        </div>
      )}
      {!m.alreadyThere && m.origin.kind === 'home' && (
        <div className="text-xs text-slate-500">
          {!mapped ? 'Chưa vẽ được chặng từ nhà vì giáo viên này chưa có vị trí nhà trong dữ liệu. Bản đồ chỉ hiện điểm đến.'
            : isPrecise(teacher.homeGeo) ? 'Đường thẳng minh hoạ. Đường đi thực tế xem trên Google Maps.'
            : `Điểm xuất phát đặt ở tâm ${teacher.homeArea ?? 'khu vực'}, nối bằng đường thẳng minh hoạ. Đường đi thực tế từ đúng địa chỉ nhà xem trên Google Maps.`}
        </div>
      )}
    </div>
  )
}

function LocationFooter({ school: s }: { school: School }) {
  const updateSchool = useStore((st) => st.updateSchool)
  const [coord, setCoord] = useState('')
  if (isPrecise(s.geo)) return null
  const save = () => {
    const parsed = parseLatLng(coord)
    if (!parsed) { toast('Toạ độ chưa đúng, ví dụ: 10.5054, 107.1761'); return }
    updateSchool(s.id, { geo: { ...parsed, source: 'manual' } })
    setCoord('')
    toast('Đã lưu toạ độ trường')
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
      <span className="text-amber-800">{s.geo ? `${s.fullName}: vị trí gần đúng theo khu vực` : `${s.fullName}: chưa có toạ độ`}</span>
      <a className="ml-auto inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline" href={googleSearchUrl({ name: s.fullName, address: s.address })} target="_blank" rel="noreferrer"><ExternalLink size={12} />Tìm trên Google Maps</a>
      <input aria-label="Toạ độ trường" className="w-44 text-xs" placeholder="Dán toạ độ: 10.50, 107.17" value={coord} onChange={(e) => setCoord(e.target.value)} />
      <Button className="!py-0.5 text-xs" onClick={save}>Lưu</Button>
    </div>
  )
}
