import clsx from 'clsx'
import { CalendarOff, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { create } from 'zustand'
import { affectedByLeave } from '../domain/leave'
import { byTime } from '../domain/route'
import { dayLabel, SESSION_LABEL } from '../domain/time'
import { teacherLabel, type Lesson, type Session } from '../domain/types'
import { useStore } from '../store'
import { Button } from './ui'

interface Request {
  teacherId?: string
  date?: string
  /** Mở sẵn ở chế độ nghỉ theo ca với ca này đã được chọn. */
  lessonId?: string
}

const useLeaveRequest = create<{ request: Request | null; set: (r: Request | null) => void }>((set) => ({ request: null, set: (request) => set({ request }) }))

export const openLeaveDialog = (request: Request) => useLeaveRequest.getState().set(request)

export function LeaveDialog() {
  const { request, set } = useLeaveRequest()
  if (!request) return null
  return <Dialog key={`${request.teacherId}-${request.date}-${request.lessonId}`} request={request} close={() => set(null)} />
}

type Mode = 'session' | 'lesson'

function Dialog({ request, close }: { request: Request; close: () => void }) {
  const teachers = useStore((s) => s.teachers)
  const schools = useStore((s) => s.schools)
  const weeks = useStore((s) => s.weeks)
  const activeWeekId = useStore((s) => s.activeWeekId)
  const addLeave = useStore((s) => s.addLeave)
  const addLessonLeave = useStore((s) => s.addLessonLeave)
  const planning = useMemo(() => weeks.filter((w) => w.status === 'planning'), [weeks])
  const defaultDate = request.date ?? planning.find((w) => w.id === activeWeekId)?.startDate ?? planning.at(-1)?.startDate ?? weeks.at(-1)!.startDate
  const [mode, setMode] = useState<Mode>(request.lessonId ? 'lesson' : 'session')
  const [teacherId, setTeacherId] = useState(request.teacherId ?? '')
  const [from, setFrom] = useState(defaultDate)
  const [to, setTo] = useState(defaultDate)
  const [session, setSession] = useState<Session | 'ALL'>('ALL')
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState<string[]>(request.lessonId ? [request.lessonId] : [])
  const [done, setDone] = useState<number | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  const sessions: Session[] = session === 'ALL' ? ['AM', 'PM'] : [session]
  const inRange = useMemo(
    () => (teacherId ? planning.flatMap((w) => affectedByLeave(w.lessons, { teacherId, from, to, sessions })).sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planning, teacherId, from, to, session],
  )
  // Ca đã chọn nhưng đổi ngày ra ngoài khoảng thì không tính nữa, tránh nghỉ nhầm ca không nhìn thấy.
  const selected = picked.filter((id) => inRange.some((l) => l.id === id))
  const schoolName = (id: string) => schools.find((s) => s.id === id)?.fullName ?? id
  const teacher = teachers.find((t) => t.id === teacherId)
  const lessonText = (l: Lesson) => `${l.className ?? l.note ?? 'Ca hỗ trợ'} · ${schoolName(l.schoolId)}`
  const canConfirm = !!teacherId && (mode === 'session' || selected.length > 0)
  const days = [...new Set(inRange.map((l) => l.date))]

  const confirm = () => setDone(mode === 'lesson' ? addLessonLeave(teacherId, selected, note) : addLeave(teacherId, from, to, session, note))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Ghi nhận giáo viên xin nghỉ" className="flex max-h-[88vh] w-[580px] max-w-full flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold"><CalendarOff size={15} />Ghi nhận giáo viên xin nghỉ</h2>
          <button aria-label="Đóng" className="text-slate-400 hover:text-slate-700" onClick={close}><X size={16} /></button>
        </header>
        {done !== null ? (
          <div className="space-y-3 p-4">
            <p>Đã ghi nhận cho <b>{teacher && teacherLabel(teacher)}</b>. {done ? <>{done} ca đã được chuyển đi; các ca dạy cần người thay đang nằm trong tab Cảnh báo.</> : 'Không có ca nào bị ảnh hưởng.'}</p>
            <div className="flex justify-end gap-2">
              <Button onClick={close}>Đóng</Button>
              {done > 0 && <Link to="/alerts?kind=uncovered" onClick={close} className="rounded-md bg-emerald-700 px-2.5 py-1.5 font-medium text-white hover:bg-emerald-800">Xếp người dạy thay</Link>}
            </div>
          </div>
        ) : (
          <>
            <div className="min-h-0 space-y-3 overflow-y-auto p-4">
              <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Giáo viên</span>
                <select autoFocus aria-label="Giáo viên xin nghỉ" className="w-full" value={teacherId} onChange={(e) => { setTeacherId(e.target.value); setPicked([]) }}>
                  <option value="">Chọn giáo viên…</option>
                  {teachers.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{teacherLabel(t)}</option>)}
                </select>
              </label>
              <div role="radiogroup" aria-label="Cách xin nghỉ" className="grid grid-cols-2 gap-1.5">
                {([['session', 'Theo ngày / buổi', 'Khoá cả buổi, không nhận được ca khác'], ['lesson', 'Theo ca', 'Chỉ nghỉ các ca được chọn, ca khác vẫn dạy']] as const).map(([key, title, hint]) => (
                  <label key={key} className={clsx('flex items-start gap-2 rounded-md border p-2', mode === key ? 'border-emerald-600 bg-emerald-50/50' : 'border-slate-200')}>
                    <input type="radio" name="leave-mode" className="mt-0.5" checked={mode === key} onChange={() => setMode(key)} />
                    <span><span className="font-medium">{title}</span><span className="block text-xs text-slate-500">{hint}</span></span>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Từ ngày</span>
                  <input aria-label="Từ ngày" type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value) }} /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Đến ngày</span>
                  <input aria-label="Đến ngày" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} /></label>
                <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Buổi</span>
                  <select aria-label="Buổi nghỉ" value={session} onChange={(e) => setSession(e.target.value as Session | 'ALL')}>
                    <option value="ALL">Cả ngày</option><option value="AM">Sáng</option><option value="PM">Chiều</option>
                  </select></label>
              </div>
              <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Lý do (không bắt buộc)</span>
                <input aria-label="Lý do nghỉ" className="w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Việc gia đình, ốm…" /></label>
              {teacherId && (
                <div className="rounded-md border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                    <span data-testid="leave-affected">{mode === 'lesson' ? `Đã chọn ${selected.length}/${inRange.length} ca` : `${inRange.length} ca bị ảnh hưởng`}</span>
                    {mode === 'lesson' && inRange.length > 0 && (
                      <button className="font-medium text-emerald-700 hover:underline" onClick={() => setPicked(selected.length === inRange.length ? [] : inRange.map((l) => l.id))}>{selected.length === inRange.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</button>
                    )}
                  </div>
                  <div className="max-h-56 overflow-y-auto" data-testid="leave-lessons">
                    {days.map((d) => (
                      <div key={d}>
                        <div className="sticky top-0 bg-white px-3 pt-1.5 text-xs font-semibold text-slate-500">{dayLabel(d)}</div>
                        {inRange.filter((l) => l.date === d).map((l) => mode === 'lesson' ? (
                          <label key={l.id} className="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-slate-50">
                            <input type="checkbox" checked={selected.includes(l.id)} onChange={(e) => setPicked((x) => (e.target.checked ? [...x, l.id] : x.filter((y) => y !== l.id)))} />
                            <span className="tnum w-24 shrink-0 text-slate-600">{l.start ? `${l.start}${l.end ? `–${l.end}` : ''}` : SESSION_LABEL[l.session]}</span>
                            <span className="truncate">{lessonText(l)}</span>
                          </label>
                        ) : (
                          <div key={l.id} className="flex gap-2 px-3 py-1">
                            <span className="tnum w-24 shrink-0 text-slate-600">{l.start ? `${l.start}${l.end ? `–${l.end}` : ''}` : SESSION_LABEL[l.session]}</span>
                            <span className="truncate">{lessonText(l)}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {!inRange.length && <div className="px-3 py-2 text-slate-500">Giáo viên không có ca nào trong khoảng này ở các tuần đang lập.</div>}
                  </div>
                </div>
              )}
            </div>
            <footer className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
              <Button onClick={close}>Huỷ</Button>
              <Button variant="primary" disabled={!canConfirm} onClick={confirm}>
                {mode === 'lesson' ? (selected.length ? `Xác nhận nghỉ ${selected.length} ca` : 'Chọn ca muốn nghỉ') : inRange.length ? `Xác nhận nghỉ, chuyển ${inRange.length} ca` : 'Xác nhận nghỉ'}
              </Button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
