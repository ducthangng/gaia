import { AlertTriangle, CalendarClock, Check, Copy, Info, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { blockerLabel } from '../domain/constraints'
import { explainLessonChange } from '../domain/cost-explain'
import { CostExplanationView } from './CostExplanation'
import { EntityText } from './EntityLink'
import { ISSUE_META, newIssues, weekIssues, type Issue } from '../domain/issues'
import { applyBulk, applyDraft, draftErrors, draftFrom, draftsErrors, isBlankDraft, newLesson, nextDraft, type BulkAction, type BulkScope, type LessonDraft } from '../domain/lesson-edit'
import { evaluate } from '../domain/recommend'
import { byTime } from '../domain/route'
import { dayLabel, SESSION_LABEL, weekDates } from '../domain/time'
import { teacherLabel, type Lesson, type Session } from '../domain/types'
import { buildContext } from '../domain/context'
import { useWeekContext, type Ctx } from '../hooks'
import { useStore } from '../store'
import { Button, toast } from './ui'

const SUBJECTS = ['STEM', 'STEM-AI', 'STEM AI - ROBOTICS', 'CDS', 'CDS/AI', 'AI', 'KNS']

type Request =
  | { lessonId: string }
  | { newForSchool: string; date?: string }
  | { manyForSchool: string; date?: string }
  | { bulkForSchool: string; date?: string }

const useRequest = create<{ request: Request | null; set: (r: Request | null) => void }>((set) => ({ request: null, set: (request) => set({ request }) }))

export const openLessonEditor = (r: Request) => useRequest.getState().set(r)

const undoAction = () => ({ label: 'Hoàn tác', run: () => useStore.getState().undoLastEdit() })

export function LessonEditor() {
  const { request, set } = useRequest()
  const ctx = useWeekContext()
  if (!request || ctx.week.status !== 'planning') return null
  const close = () => set(null)
  if ('bulkForSchool' in request) return <BulkDialog schoolId={request.bulkForSchool} date={request.date} ctx={ctx} close={close} />
  if ('manyForSchool' in request) return <ManyDialog schoolId={request.manyForSchool} date={request.date} ctx={ctx} close={close} />
  if ('newForSchool' in request) return <EditDialog key="new" schoolId={request.newForSchool} initialDate={request.date} ctx={ctx} close={close} />
  const lesson = ctx.week.lessons.find((l) => l.id === request.lessonId)
  return lesson ? <EditDialog key={lesson.id} lesson={lesson} schoolId={lesson.schoolId} ctx={ctx} close={close} /> : null
}

function Modal({ title, close, children, footer, testId, wide = false }: { title: string; close: () => void; children: ReactNode; footer: ReactNode; testId: string; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label={title} data-testid={testId} className={`flex max-h-[90vh] ${wide ? 'w-[1040px]' : 'w-[620px]'} max-w-full flex-col rounded-lg bg-white shadow-xl`}>
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold"><CalendarClock size={15} />{title}</h2>
          <button aria-label="Đóng" className="text-slate-400 hover:text-slate-700" onClick={close}><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{children}</div>
        <footer className="flex items-center gap-2 border-t border-slate-100 px-4 py-3">{footer}</footer>
      </div>
    </div>
  )
}

const Field = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
  <label className={`block ${className ?? ''}`}><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>{children}</label>
)

/** Báo trước: thay đổi này làm phát sinh thêm cảnh báo gì. Refer để riêng vì danh sách đang là tạm. */
function ImpactNotice({ fresh, ctx }: { fresh: Issue[]; ctx: Ctx }) {
  const urgent = fresh.filter((i) => ISSUE_META[i.kind].severity !== 'info')
  const notes = fresh.length - urgent.length
  if (!fresh.length) return <div className="flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-emerald-900" data-testid="impact"><Check size={14} />Không phát sinh trùng lịch hay chặng không kịp.</div>
  return (
    <div className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-amber-950" data-testid="impact">
      {urgent.slice(0, 5).map((i, n) => (
        <div key={n} className="flex gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-700" /><span><b>{ISSUE_META[i.kind].label}:</b> {dayLabel(i.lesson.date)}, <EntityText text={ctx.schoolById.get(i.lesson.schoolId)?.fullName ?? ''} />. <EntityText text={i.detail} /></span></div>
      ))}
      {urgent.length > 5 && <div className="text-xs">và {urgent.length - 5} cảnh báo khác</div>}
      {notes > 0 && <div className="flex items-center gap-1.5 text-xs"><Info size={12} />Thêm {notes} ghi chú về Refer hoặc nguyện vọng.</div>}
      {urgent.length > 0 && <div className="text-xs">Vẫn lưu được nếu bạn chấp nhận và xử lý sau.</div>}
    </div>
  )
}

/** Cảnh báo mới nếu lịch của tuần được thay bằng `next`. */
function useImpact(next: Lesson[] | null, ctx: Ctx) {
  return useMemo(() => {
    if (!next) return []
    return newIssues(weekIssues(ctx), weekIssues(buildContext({ ...ctx.week, lessons: next }, ctx.world)))
  }, [next, ctx])
}

function EditDialog({ lesson, schoolId, initialDate, ctx, close }: { lesson?: Lesson; schoolId: string; initialDate?: string; ctx: Ctx; close: () => void }) {
  const saveLesson = useStore((s) => s.saveLesson)
  const addLesson = useStore((s) => s.addLesson)
  const deleteLesson = useStore((s) => s.deleteLesson)
  const dates = weekDates(ctx.week.startDate)
  const [d, setD] = useState<LessonDraft>(() => lesson ? draftFrom(lesson) : { date: initialDate ?? dates[0], start: '', end: '', className: '', subject: '', teacherId: '', note: '' })
  const patch = (p: Partial<LessonDraft>) => setD((x) => ({ ...x, ...p }))
  const errors = draftErrors(d)
  const school = ctx.schoolById.get(schoolId)
  const hypothetical = useMemo(() => {
    if (draftErrors(d).length) return null
    return lesson ? applyDraft(lesson, d) : newLesson('draft', ctx.week.id, schoolId, d)
  }, [d, lesson, ctx.week.id, schoolId])
  const next = useMemo(() => {
    if (!hypothetical) return null
    return lesson ? ctx.week.lessons.map((l) => (l.id === lesson.id ? hypothetical : l)) : [...ctx.week.lessons, hypothetical]
  }, [hypothetical, lesson, ctx.week.lessons])
  const fresh = useImpact(next, ctx)

  // Danh sách GV xếp theo mức phù hợp với giờ đang chọn, nên đổi giờ là danh sách đổi theo.
  const options = useMemo(() => {
    const probe: Lesson = hypothetical ?? (lesson ?? newLesson('draft', ctx.week.id, schoolId, d))
    const all = ctx.world.teachers.filter((t) => t.active || t.id === d.teacherId).map((t) => evaluate(t, { ...probe, teacherId: null, status: 'needs_cover' }, ctx))
    all.sort((a, b) => Number(b.available) - Number(a.available) || b.score - a.score)
    return all
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hypothetical, ctx])
  const dirty = !lesson || JSON.stringify(draftFrom(lesson)) !== JSON.stringify(d)

  return (
    <Modal
      testId="lesson-editor"
      title={lesson ? 'Sửa ca dạy' : 'Thêm ca dạy'}
      close={close}
      footer={<>
        {lesson && <Button variant="danger" onClick={() => { deleteLesson(lesson.id); toast('Đã xoá ca', undoAction()); close() }}><Trash2 size={13} />Xoá ca</Button>}
        <span className="flex-1" />
        <Button onClick={close}>Huỷ</Button>
        <Button variant="primary" disabled={errors.length > 0 || !dirty} onClick={() => {
          if (lesson) saveLesson(lesson.id, d)
          else addLesson(schoolId, d)
          toast(`${lesson ? 'Đã lưu ca' : 'Đã thêm ca'} vào ${dayLabel(d.date)}, ${d.start}`, undoAction())
          close()
        }}>{lesson ? 'Lưu thay đổi' : 'Thêm ca'}</Button>
      </>}
    >
      <div className="text-slate-600"><EntityText text={school?.fullName ?? ''} /></div>
      <div className="flex flex-wrap gap-3">
        <Field label="Ngày"><select aria-label="Ngày" value={d.date} onChange={(e) => patch({ date: e.target.value })}>{dates.map((x) => <option key={x} value={x}>{dayLabel(x)}</option>)}</select></Field>
        <Field label="Bắt đầu"><input aria-label="Bắt đầu" type="time" value={d.start} onChange={(e) => patch({ start: e.target.value })} /></Field>
        <Field label="Kết thúc"><input aria-label="Kết thúc" type="time" value={d.end} onChange={(e) => patch({ end: e.target.value })} /></Field>
      </div>
      <div className="flex flex-wrap gap-3">
        <Field label="Lớp"><input aria-label="Lớp" className="w-28" value={d.className} onChange={(e) => patch({ className: e.target.value })} /></Field>
        <Field label="Môn"><select aria-label="Môn" value={d.subject} onChange={(e) => patch({ subject: e.target.value })}>
          <option value="">Chưa rõ</option>
          {[...new Set([...SUBJECTS, ...(d.subject ? [d.subject] : [])])].map((s) => <option key={s}>{s}</option>)}
        </select></Field>
        <Field label="Ghi chú" className="min-w-40 flex-1"><input aria-label="Ghi chú" className="w-full" value={d.note} onChange={(e) => patch({ note: e.target.value })} /></Field>
      </div>
      <Field label="Giáo viên (xếp theo mức phù hợp với giờ đang chọn)">
        <select aria-label="Giáo viên" className="w-full" value={d.teacherId} onChange={(e) => patch({ teacherId: e.target.value })}>
          <option value="">Chưa có giáo viên</option>
          <optgroup label="Rảnh">
            {options.filter((c) => c.available || c.teacher.id === d.teacherId).map((c) => <option key={c.teacher.id} value={c.teacher.id}>{teacherLabel(c.teacher)} · {c.score} điểm{c.isReferred ? ' · Refer' : ''}</option>)}
          </optgroup>
          <optgroup label="Bận">
            {options.filter((c) => !c.available && c.teacher.id !== d.teacherId).map((c) => <option key={c.teacher.id} value={c.teacher.id}>{teacherLabel(c.teacher)} · {blockerLabel(c.blockers[0])}</option>)}
          </optgroup>
        </select>
      </Field>
      {errors.length > 0
        ? <div className="rounded-md bg-red-50 px-3 py-2 text-red-800" data-testid="edit-errors">{errors.join('. ')}.</div>
        : dirty && <>
          <ImpactNotice fresh={fresh} ctx={ctx} />
          {hypothetical && <CostExplanationView explanation={explainLessonChange(lesson ?? null, hypothetical, ctx)} ctx={ctx} />}
        </>}
    </Modal>
  )
}

const emptyDraft = (date: string): LessonDraft => ({ date, start: '', end: '', className: '', subject: '', teacherId: '', note: '' })

/**
 * Thêm nhiều ca một lần, mỗi dòng một ca với giờ riêng. "Thêm dòng" (hoặc Enter) nối ca mới ngay sau ca trên,
 * cùng thời lượng, nên nhập một buổi 5 tiết chỉ cần gõ giờ ca đầu và tên lớp.
 */
function ManyDialog({ schoolId, date, ctx, close }: { schoolId: string; date?: string; ctx: Ctx; close: () => void }) {
  const addLessons = useStore((s) => s.addLessons)
  const dates = weekDates(ctx.week.startDate)
  const [rows, setRows] = useState<LessonDraft[]>(() => [emptyDraft(date ?? dates[0])])
  const [focusRow, setFocusRow] = useState<number | null>(null)
  const school = ctx.schoolById.get(schoolId)
  const teachers = useMemo(() => ctx.world.teachers.filter((t) => t.active).sort((a, b) => a.id.localeCompare(b.id)), [ctx.world.teachers])
  const errors = draftsErrors(rows)
  const ready = rows.filter((r) => !isBlankDraft(r))
  const next = useMemo(
    () => (errors.size || !ready.length ? null : [...ctx.week.lessons, ...ready.map((d, i) => newLesson(`draft-${i}`, ctx.week.id, schoolId, d))]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(rows), ctx.week.lessons],
  )
  const fresh = useImpact(next, ctx)

  const patch = (i: number, p: Partial<LessonDraft>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)))
  const insertAfter = (i: number) => {
    setRows((rs) => [...rs.slice(0, i + 1), nextDraft(rs[i]), ...rs.slice(i + 1)])
    setFocusRow(i + 1)
  }
  const duplicate = (i: number) => {
    setRows((rs) => [...rs.slice(0, i + 1), { ...rs[i] }, ...rs.slice(i + 1)])
    setFocusRow(i + 1)
  }
  const remove = (i: number) => setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : [emptyDraft(rs[0].date)]))
  // Dòng mới thêm: đưa con trỏ vào ô Lớp, vì giờ đã được điền sẵn.
  useEffect(() => {
    if (focusRow === null) return
    document.querySelector<HTMLInputElement>(`[data-row="${focusRow}"] input[aria-label="Lớp"]`)?.focus()
    setFocusRow(null)
  }, [focusRow])
  const onKey = (i: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      insertAfter(i)
    }
  }
  const save = () => {
    const n = addLessons(schoolId, ready)
    toast(`Đã thêm ${n} ca`, undoAction())
    close()
  }

  return (
    <Modal
      testId="lesson-many"
      wide
      title="Thêm nhiều ca"
      close={close}
      footer={<>
        <span className="text-xs text-slate-500">Enter: thêm dòng nối tiếp ca vừa nhập</span>
        <span className="flex-1" />
        <Button onClick={close}>Huỷ</Button>
        <Button variant="primary" disabled={errors.size > 0 || !ready.length} onClick={save}>Thêm {ready.length || ''} ca</Button>
      </>}
    >
      <div className="text-slate-600"><EntityText text={school?.fullName ?? ''} /></div>
      <table className="w-full border-separate border-spacing-y-1 text-sm">
        <thead>
          <tr className="text-left text-xs font-medium text-slate-500">
            <th className="w-8 font-medium">#</th><th className="font-medium">Ngày</th><th className="font-medium">Bắt đầu</th><th className="font-medium">Kết thúc</th>
            <th className="font-medium">Lớp</th><th className="font-medium">Môn</th><th className="font-medium">Giáo viên</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} data-row={i} className="align-top" data-testid="many-row">
              <td className="tnum pt-2 text-xs text-slate-400">{i + 1}</td>
              <td><select aria-label="Ngày" value={r.date} onChange={(e) => patch(i, { date: e.target.value })}>{dates.map((x) => <option key={x} value={x}>{dayLabel(x)}</option>)}</select></td>
              <td><input aria-label="Bắt đầu" type="time" value={r.start} onKeyDown={onKey(i)} onChange={(e) => patch(i, { start: e.target.value })} /></td>
              <td><input aria-label="Kết thúc" type="time" value={r.end} onKeyDown={onKey(i)} onChange={(e) => patch(i, { end: e.target.value })} /></td>
              <td><input aria-label="Lớp" className="w-24" value={r.className} onKeyDown={onKey(i)} onChange={(e) => patch(i, { className: e.target.value })} /></td>
              <td><select aria-label="Môn" value={r.subject} onChange={(e) => patch(i, { subject: e.target.value })}>
                <option value="">Chưa rõ</option>
                {SUBJECTS.map((x) => <option key={x}>{x}</option>)}
              </select></td>
              <td><select aria-label="Giáo viên" className="w-52" value={r.teacherId} onChange={(e) => patch(i, { teacherId: e.target.value })}>
                <option value="">Chưa có giáo viên</option>
                {teachers.map((t) => <option key={t.id} value={t.id}>{teacherLabel(t)}</option>)}
              </select></td>
              <td className="whitespace-nowrap pt-1">
                <button aria-label="Nhân bản dòng" title="Nhân bản dòng (giữ nguyên giờ, đổi lớp)" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => duplicate(i)}><Copy size={14} /></button>
                <button aria-label="Xoá dòng" title="Xoá dòng" className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-700" onClick={() => remove(i)}><Trash2 size={14} /></button>
              </td>
            </tr>
          )).flatMap((row, i) => errors.has(i) ? [row, <tr key={`e${i}`}><td /><td colSpan={7} className="pb-1 text-xs text-red-700" data-testid="many-error">{errors.get(i)!.join('. ')}.</td></tr>] : [row])}
        </tbody>
      </table>
      <Button className="!py-1 text-xs" onClick={() => insertAfter(rows.length - 1)}><Plus size={13} />Thêm dòng</Button>
      <p className="text-xs text-slate-500">Dòng mới tự lấy giờ bắt đầu bằng giờ kết thúc của dòng trên và cùng thời lượng; cùng ngày, môn, giáo viên. Dòng để trống hoàn toàn sẽ được bỏ qua. Giáo viên có thể để trống và gán sau.</p>
      {errors.size === 0 && ready.length > 0 && <ImpactNotice fresh={fresh} ctx={ctx} />}
    </Modal>
  )
}

const ACTIONS: { key: BulkAction['kind']; label: string; hint: string }[] = [
  { key: 'move', label: 'Dời sang ngày khác', hint: 'Trường đổi ngày học' },
  { key: 'shift', label: 'Dời giờ', hint: 'Trường đổi giờ vào lớp' },
  { key: 'school_off', label: 'Trường báo nghỉ', hint: 'Không phát sinh đi lại' },
  { key: 'restore', label: 'Khôi phục ca nghỉ', hint: 'Trường học lại' },
  { key: 'teacher', label: 'Đổi giáo viên', hint: 'Giao các ca cho người khác' },
]

function BulkDialog({ schoolId, date, ctx, close }: { schoolId: string; date?: string; ctx: Ctx; close: () => void }) {
  const applyBulkChange = useStore((s) => s.applyBulkChange)
  const dates = weekDates(ctx.week.startDate)
  const [kind, setKind] = useState<BulkAction['kind']>('move')
  const [scope, setScope] = useState<BulkScope>({ schoolId, date: date ?? '', session: 'ALL', teacherId: '' })
  const [toDate, setToDate] = useState('')
  const [minutes, setMinutes] = useState(15)
  const [toTeacherId, setToTeacherId] = useState('')
  const action: BulkAction | null =
    kind === 'move' ? (toDate ? { kind, toDate } : null)
    : kind === 'shift' ? (minutes ? { kind, minutes } : null)
    : kind === 'teacher' ? { kind, toTeacherId }
    : { kind }
  const next = useMemo(() => (action ? applyBulk(ctx.week.lessons, scope, action) : null), [ctx.week.lessons, scope, JSON.stringify(action)]) // eslint-disable-line react-hooks/exhaustive-deps
  const affected = next ? ctx.week.lessons.filter((l, i) => l !== next[i]).sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b)) : []
  const fresh = useImpact(next && affected.length ? next : null, ctx)
  const inTeachers = useMemo(() => {
    const ids = new Set(ctx.week.lessons.filter((l) => l.schoolId === schoolId && l.teacherId).map((l) => l.teacherId!))
    return [...ids].flatMap((id) => { const t = ctx.teacherById.get(id); return t ? [t] : [] }).sort((a, b) => a.id.localeCompare(b.id))
  }, [ctx, schoolId])
  const needsMove = kind === 'move' && !toDate
  const moveAcrossAll = kind === 'move' && !scope.date
  return (
    <Modal
      testId="bulk-editor"
      title="Đổi lịch hàng loạt"
      close={close}
      footer={<>
        <span className="flex-1 text-xs text-slate-500">{ctx.schoolById.get(schoolId)?.fullName}</span>
        <Button onClick={close}>Huỷ</Button>
        <Button variant="primary" disabled={!action || !affected.length || moveAcrossAll} onClick={() => {
          const n = applyBulkChange(scope, action!)
          toast(`Đã đổi ${n} ca`, undoAction())
          close()
        }}>{affected.length ? `Áp dụng cho ${affected.length} ca` : 'Áp dụng'}</Button>
      </>}
    >
      <fieldset>
        <legend className="mb-1 text-xs font-medium text-slate-500">Thay đổi</legend>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {ACTIONS.map((a) => (
            <label key={a.key} className="flex items-start gap-2 rounded-md border border-slate-200 p-2 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50/50">
              <input type="radio" name="bulk-kind" className="mt-0.5" checked={kind === a.key} onChange={() => setKind(a.key)} />
              <span><span className="font-medium">{a.label}</span><span className="block text-xs text-slate-500">{a.hint}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Áp dụng cho ngày"><select aria-label="Áp dụng cho ngày" value={scope.date} onChange={(e) => setScope({ ...scope, date: e.target.value })}>
          <option value="">Cả tuần</option>
          {dates.map((x) => <option key={x} value={x}>{dayLabel(x)}</option>)}
        </select></Field>
        <Field label="Buổi"><select aria-label="Buổi" value={scope.session} onChange={(e) => setScope({ ...scope, session: e.target.value as Session | 'ALL' })}>
          <option value="ALL">Cả ngày</option><option value="AM">{SESSION_LABEL.AM}</option><option value="PM">{SESSION_LABEL.PM}</option>
        </select></Field>
        <Field label={kind === 'teacher' ? 'Giáo viên đang dạy' : 'Chỉ ca của giáo viên'} className="min-w-40 flex-1"><select aria-label="Chỉ ca của giáo viên" className="w-full" value={scope.teacherId} onChange={(e) => setScope({ ...scope, teacherId: e.target.value })}>
          <option value="">Mọi giáo viên</option>
          {inTeachers.map((t) => <option key={t.id} value={t.id}>{teacherLabel(t)}</option>)}
        </select></Field>
      </div>
      {kind === 'move' && <Field label="Dời sang"><select aria-label="Dời sang" value={toDate} onChange={(e) => setToDate(e.target.value)}>
        <option value="">Chọn ngày…</option>
        {dates.map((x) => <option key={x} value={x}>{dayLabel(x)}</option>)}
      </select></Field>}
      {kind === 'shift' && <Field label="Số phút (số âm là dời sớm hơn)"><input aria-label="Số phút" type="number" step={5} className="w-24" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></Field>}
      {kind === 'teacher' && <Field label="Đổi thành"><select aria-label="Đổi thành" className="w-full" value={toTeacherId} onChange={(e) => setToTeacherId(e.target.value)}>
        <option value="">Bỏ trống, cần xếp giáo viên</option>
        {ctx.world.teachers.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{teacherLabel(t)}</option>)}
      </select></Field>}
      {moveAcrossAll && <div className="rounded-md bg-red-50 px-3 py-2 text-red-800">Dời sang ngày khác cần chọn một ngày cụ thể ở "Áp dụng cho ngày", để không dồn cả tuần vào một ngày.</div>}
      <div className="rounded-md border border-slate-200">
        <div className="border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600" data-testid="bulk-affected">{needsMove ? 'Chọn ngày muốn dời sang để xem ca bị ảnh hưởng' : `${affected.length} ca sẽ thay đổi`}</div>
        <ul className="max-h-40 divide-y divide-slate-100 overflow-y-auto">
          {affected.map((l) => (
            <li key={l.id} className="flex justify-between gap-3 px-3 py-1">
              <span className="tnum whitespace-nowrap text-slate-600">{dayLabel(l.date)} · {l.start ?? SESSION_LABEL[l.session]}</span>
              <span className="truncate text-right">{l.className ?? l.note ?? 'Ca'} · {l.teacherId ? (ctx.teacherById.get(l.teacherId) ? teacherLabel(ctx.teacherById.get(l.teacherId)!) : l.teacherId) : 'Chưa có GV'}</span>
            </li>
          ))}
        </ul>
      </div>
      {affected.length > 0 && !moveAcrossAll && <ImpactNotice fresh={fresh} ctx={ctx} />}
    </Modal>
  )
}

