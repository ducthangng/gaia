import clsx from 'clsx'
import { AlertTriangle, ArrowRight, Minus, TrendingDown, TrendingUp, X } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { explainLessonChange, type CostChange, type CostExplanation } from '../domain/cost-explain'
import { reassign } from '../domain/lesson-edit'
import { evaluate } from '../domain/recommend'
import { dayLabel, money } from '../domain/time'
import { teacherLabel } from '../domain/types'
import { useWeekContext, type Ctx } from '../hooks'
import { useStore } from '../store'
import { EntityAnchor, EntityText } from './EntityLink'
import { Button, toast } from './ui'

const signed = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : 'Không đổi')

const VERDICT = {
  up: { icon: TrendingUp, box: 'bg-amber-50 text-amber-950 border-amber-200', iconColor: 'text-amber-700' },
  down: { icon: TrendingDown, box: 'bg-emerald-50 text-emerald-950 border-emerald-200', iconColor: 'text-emerald-700' },
  same: { icon: Minus, box: 'bg-slate-50 text-slate-800 border-slate-200', iconColor: 'text-slate-500' },
}

function ChangeCard({ change: c, ctx }: { change: CostChange; ctx: Ctx }) {
  const t = ctx.teacherById.get(c.teacherId)
  return (
    <div className="rounded-md border border-slate-200 p-3" data-testid="cost-change">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{t ? <EntityAnchor kind="teacher" id={t.id}>{teacherLabel(t)}</EntityAnchor> : c.teacherId}</span>
        <span className="tnum text-right">
          <span className="text-slate-500">{money(c.before.cost)}</span>
          <ArrowRight size={12} className="mx-1 inline text-slate-400" />
          <span className="font-semibold">{money(c.after.cost)}</span>
          <span className={clsx('ml-2 font-semibold', c.delta > 0 ? 'text-amber-800' : c.delta < 0 ? 'text-emerald-800' : 'text-slate-500')}>{signed(c.delta)}</span>
        </span>
      </div>
      <div className="text-xs text-slate-500">{dayLabel(c.date)}</div>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-slate-700">
        {c.reasons.map((r, i) => <li key={i}><EntityText text={r} /></li>)}
      </ul>
    </div>
  )
}

/** Giải thích vì sao chi phí tăng, giảm hay giữ nguyên. Dùng chung cho popup đổi giáo viên và hộp thoại sửa ca. */
export function CostExplanationView({ explanation: e, ctx }: { explanation: CostExplanation; ctx: Ctx }) {
  const v = VERDICT[e.verdict]
  const Icon = v.icon
  return (
    <div className="space-y-2" data-testid="cost-explanation">
      <div className={clsx('flex items-center gap-2 rounded-md border px-3 py-2 font-semibold', v.box)} data-testid="cost-verdict" data-total={e.total}>
        <Icon size={16} className={v.iconColor} />
        {e.summary}
      </div>
      {e.changes.map((c) => <ChangeCard key={`${c.teacherId}-${c.date}`} change={c} ctx={ctx} />)}
      {e.estimated && <p className="text-xs text-slate-500">Có chặng dùng số km ước tính vì chưa từng được ghi nhận, nên số tiền thực tế có thể khác.</p>}
    </div>
  )
}

interface Request {
  lessonId: string
  teacherId: string
}

const useRequest = create<{ request: Request | null; set: (r: Request | null) => void }>((set) => ({ request: null, set: (request) => set({ request }) }))
export const openReassignConfirm = (r: Request) => useRequest.getState().set(r)

export function ReassignConfirm() {
  const { request, set } = useRequest()
  const ctx = useWeekContext()
  const lesson = request ? ctx.week.lessons.find((l) => l.id === request.lessonId) : null
  if (!request || !lesson || ctx.week.status !== 'planning') return null
  return <Dialog key={`${request.lessonId}-${request.teacherId}`} lessonId={request.lessonId} teacherId={request.teacherId} ctx={ctx} close={() => set(null)} />
}

function Dialog({ lessonId, teacherId, ctx, close }: Request & { ctx: Ctx; close: () => void }) {
  const replaceTeacher = useStore((s) => s.replaceTeacher)
  const undo = useStore((s) => s.undoLastEdit)
  const lesson = ctx.week.lessons.find((l) => l.id === lessonId)!
  const next = ctx.teacherById.get(teacherId)!
  const explanation = useMemo(() => explainLessonChange(lesson, reassign(lesson, teacherId), ctx), [lesson, teacherId, ctx])
  const candidate = useMemo(() => evaluate(next, { ...lesson, teacherId: null, status: 'needs_cover' }, ctx), [next, lesson, ctx])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  const currentId = lesson.teacherId ?? lesson.originalTeacherId
  const current = currentId ? ctx.teacherById.get(currentId) : null
  const school = ctx.schoolById.get(lesson.schoolId)
  const notes = [...(candidate.isReferred ? [] : ['Ngoài danh sách Refer của trường']), ...candidate.violations.map((v) => v.label), ...(candidate.taughtSubject ? [] : ['Chưa dạy môn này'])]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Xác nhận đổi giáo viên" data-testid="reassign-confirm" className="flex max-h-[90vh] w-[600px] max-w-full flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="font-semibold">Xác nhận đổi giáo viên</h2>
            <p className="text-slate-600">{current ? <EntityAnchor kind="teacher" id={current.id}>{teacherLabel(current)}</EntityAnchor> : 'Chưa có giáo viên'} <ArrowRight size={12} className="mx-0.5 inline text-slate-400" /> <b><EntityAnchor kind="teacher" id={next.id}>{teacherLabel(next)}</EntityAnchor></b></p>
            <p className="tnum text-xs text-slate-500">{dayLabel(lesson.date)} · {lesson.start ?? `Tiết ${lesson.period}`}{lesson.end ? `–${lesson.end}` : ''} · lớp {lesson.className ?? '—'}{lesson.subject ? ` · ${lesson.subject}` : ''} · {school && <EntityAnchor kind="school" id={school.id}>{school.fullName}</EntityAnchor>}</p>
          </div>
          <button aria-label="Đóng" className="text-slate-400 hover:text-slate-700" onClick={close}><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          <CostExplanationView explanation={explanation} ctx={ctx} />
          {!lesson.teacherId && lesson.originalTeacherId && <p className="text-xs text-slate-500">{current?.name} đã được chuyển khỏi ca này từ trước, nên phần chi phí của họ đã tính rồi và không nằm trong so sánh này.</p>}
          {notes.length > 0 && <div className="flex gap-1.5 rounded-md bg-slate-50 px-3 py-2 text-slate-700" data-testid="reassign-notes"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600" /><span>Lưu ý về {next.name}: {notes.join('; ')}.</span></div>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <Button onClick={close}>Huỷ</Button>
          <Button variant="primary" autoFocus onClick={() => {
            replaceTeacher(lesson.id, teacherId)
            toast(`Đã đổi sang ${teacherLabel(next)}`, { label: 'Hoàn tác', run: undo })
            close()
          }}>Xác nhận đổi</Button>
        </footer>
      </div>
    </div>
  )
}
