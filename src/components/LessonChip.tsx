import { autoUpdate, flip, FloatingPortal, offset, shift, size, useClick, useDismiss, useFloating, useInteractions } from '@floating-ui/react'
import clsx from 'clsx'
import { AlertTriangle, Ban, CalendarOff, Check, Search, Star, UserMinus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { blockerLabel } from '../domain/constraints'
import { rankCandidates, type Candidate } from '../domain/recommend'
import { dayLabel, money, SESSION_LABEL } from '../domain/time'
import type { Lesson } from '../domain/types'
import type { Ctx } from '../hooks'
import { useStore } from '../store'
import { Badge, Button, toast } from './ui'

export const subjectStyle = (subject: string | null) => {
  if (!subject) return 'bg-slate-50 border-slate-200'
  if (subject === 'KNS') return 'bg-violet-50 border-violet-200'
  if (subject.startsWith('STEM')) return 'bg-amber-50 border-amber-200'
  return 'bg-teal-50 border-teal-200'
}

const TYPE_LABEL: Partial<Record<Lesson['type'], string>> = { substitute: 'Dạy thay', makeup: 'Dạy bù', support: 'Hỗ trợ', event: 'Chuyên đề', observe: 'Dự giờ' }

export function LessonChip({ lesson: l, ctx, show }: { lesson: Lesson; ctx: Ctx; show: 'teacher' | 'school' }) {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 }), size({ padding: 8, apply: ({ availableHeight, elements }) => { elements.floating.style.maxHeight = `${Math.max(280, availableHeight)}px` } })],
  })
  const { getReferenceProps, getFloatingProps } = useInteractions([useClick(context), useDismiss(context)])

  const teacher = l.teacherId ? ctx.teacherById.get(l.teacherId) : null
  const school = ctx.schoolById.get(l.schoolId)
  const off = l.status === 'school_off'
  const replaced = l.status === 'replaced'
  const uncovered = l.status === 'needs_cover' || (!l.teacherId && !off && !replaced)
  const typeLabel = TYPE_LABEL[l.type]

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        className={clsx(
          'block w-full rounded border px-1.5 py-1 text-left leading-tight transition hover:ring-2 hover:ring-emerald-500/40',
          uncovered ? 'border-red-300 bg-red-50' : off || replaced ? 'border-slate-200 bg-slate-100 text-slate-500' : subjectStyle(l.subject),
          open && 'ring-2 ring-emerald-600',
        )}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="tnum text-[11px] text-slate-500">{l.start ?? `Tiết ${l.period}`}</span>
          <span className="truncate text-[11px] text-slate-500">{l.subject}</span>
        </div>
        <div className={clsx('truncate font-medium', (off || replaced) && 'line-through')}>{l.className ?? l.note ?? '—'}</div>
        <div className={clsx('truncate text-xs', uncovered ? 'font-medium text-red-700' : 'text-slate-600')}>
          {uncovered ? (
            <span className="inline-flex items-center gap-1"><AlertTriangle size={11} />Cần giáo viên</span>
          ) : off ? 'Trường báo nghỉ' : replaced ? 'GV nghỉ, đã có người thay' : show === 'teacher' ? (teacher?.name ?? l.teacherId) : school?.fullName}
        </div>
        {typeLabel && !off && !replaced && !uncovered && <div className="truncate text-[11px] text-slate-500">{typeLabel}</div>}
      </button>
      {open && (
        <FloatingPortal>
          <div ref={refs.setFloating} style={floatingStyles} {...getFloatingProps()} className="z-40 flex w-[460px] max-w-[95vw] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            <AssignPanel lesson={l} ctx={ctx} close={() => setOpen(false)} />
          </div>
        </FloatingPortal>
      )}
    </>
  )
}

function AssignPanel({ lesson: l, ctx, close }: { lesson: Lesson; ctx: Ctx; close: () => void }) {
  const assign = useStore((s) => s.assign)
  const requestCover = useStore((s) => s.requestCover)
  const markSchoolOff = useStore((s) => s.markSchoolOff)
  const [query, setQuery] = useState('')
  const [onlyFree, setOnlyFree] = useState(true)
  const readOnly = ctx.week.status === 'archived'
  const candidates = useMemo(() => (readOnly ? [] : rankCandidates(l, ctx)), [l, ctx, readOnly])
  const q = query.trim().toLowerCase()
  const shown = candidates.filter((c) => (!onlyFree || c.available) && (!q || c.teacher.name.toLowerCase().includes(q) || c.teacher.id.toLowerCase().includes(q)))
  const school = ctx.schoolById.get(l.schoolId)
  const current = l.teacherId ? ctx.teacherById.get(l.teacherId) : null
  const original = l.originalTeacherId ? ctx.teacherById.get(l.originalTeacherId) : null

  return (
    <>
      <div className="border-b border-slate-100 px-3 py-2.5">
        <div className="font-semibold">{l.className ?? l.note ?? 'Ca dạy'} · {l.subject ?? 'Chưa rõ môn'}</div>
        <div className="text-slate-600">{school?.fullName}</div>
        <div className="text-xs text-slate-500">
          {dayLabel(l.date)} · {SESSION_LABEL[l.session]} · {l.start && l.end ? `${l.start}–${l.end}` : `Tiết ${l.period}`}
        </div>
        <div className="mt-1 text-xs">
          {current ? <>Đang dạy: <b>{current.name}</b></> : <span className="font-medium text-red-700">Chưa có giáo viên</span>}
          {original && original.id !== current?.id && <span className="text-slate-500"> · GV gốc: {original.name}</span>}
        </div>
        {l.note && <div className="mt-0.5 text-xs text-slate-500">Ghi chú: {l.note}</div>}
        {!readOnly && (
          <div className="mt-2 flex gap-1.5">
            {l.status === 'assigned' && <Button className="!py-1 text-xs" onClick={() => { requestCover(l.id); toast('Đã chuyển ca sang cần dạy thay') }}><UserMinus size={13} />Cần dạy thay</Button>}
            {l.status !== 'school_off' ? (
              <Button className="!py-1 text-xs" onClick={() => { markSchoolOff(l.id, true); close() }}><CalendarOff size={13} />Trường báo nghỉ</Button>
            ) : (
              <Button className="!py-1 text-xs" onClick={() => { markSchoolOff(l.id, false); close() }}>Khôi phục ca</Button>
            )}
          </div>
        )}
      </div>
      {readOnly ? (
        <div className="px-3 py-3 text-xs text-slate-500">Tuần đã lưu trữ: chỉ xem. Mở lại tuần ở màn hình Lịch tuần nếu cần chỉnh sửa.</div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2 top-1.5 text-slate-400" />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm giáo viên" className="w-full !pl-7" />
            </div>
            <label className="flex items-center gap-1 whitespace-nowrap text-xs text-slate-600">
              <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> Chỉ GV rảnh
            </label>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {shown.map((c, i) => (
              <CandidateRow key={c.teacher.id} c={c} rank={i + 1} current={c.teacher.id === l.teacherId} onPick={() => {
                assign(l.id, c.teacher.id)
                toast(`Đã phân công ${c.teacher.name}`)
                close()
              }} />
            ))}
            {!shown.length && <li className="px-3 py-6 text-center text-slate-500">Không có giáo viên phù hợp. Bỏ chọn "Chỉ GV rảnh" để xem lý do từng người.</li>}
          </ul>
        </>
      )}
    </>
  )
}

function CandidateRow({ c, rank, current, onPick }: { c: Candidate; rank: number; current: boolean; onPick: () => void }) {
  const scoreTone = !c.available ? 'bg-slate-200 text-slate-600' : c.score >= 75 ? 'bg-emerald-700 text-white' : c.score >= 50 ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'
  return (
    <li className="border-b border-slate-50 last:border-0">
      <button disabled={!c.available && !current} onClick={onPick} data-testid="candidate" className={clsx('flex w-full items-start gap-2.5 px-3 py-2 text-left', c.available ? 'hover:bg-emerald-50/60' : 'bg-slate-50/60')}>
        <span className={clsx('tnum mt-0.5 w-9 shrink-0 rounded py-0.5 text-center text-xs font-semibold', scoreTone)} title="Điểm phù hợp /100">{c.score}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate font-medium"><span className="tnum mr-1 text-xs text-slate-400">{rank}.</span>{c.teacher.name}</span>
            <span className={clsx('tnum whitespace-nowrap text-xs', c.extraCost > 0 ? 'text-slate-700' : 'text-slate-500')} title="Chi phí di chuyển tăng thêm trong ngày">
              {c.extraCost > 0 ? `+${money(c.extraCost)}` : c.extraCost < 0 ? money(c.extraCost) : 'Không tăng chi phí'}
            </span>
          </span>
          <span className="mt-1 flex flex-wrap gap-1">
            <Badge tone={c.km <= 12 ? 'green' : c.km <= 24 ? 'slate' : 'amber'} title={c.kmSource === 'estimated' ? 'Ước tính theo khu vực, chưa từng ghi nhận km' : 'Theo số km đã ghi nhận'}>
              {c.kmSource === 'estimated' ? '≈' : ''}{c.km} km từ {c.kmFrom}
            </Badge>
            {c.isReferred ? <Badge tone="green"><Star size={10} />Refer</Badge> : <Badge>Ngoài Refer</Badge>}
            {c.violations.length ? <Badge tone="amber" title={c.violations.map((v) => v.label).join('; ')}><AlertTriangle size={10} />{c.violations[0].label}</Badge> : <Badge tone="green"><Check size={10} />Nguyện vọng</Badge>}
            {c.available ? <Badge tone="green"><Check size={10} />Rảnh</Badge> : <Badge tone="red"><Ban size={10} />{blockerLabel(c.blockers[0])}</Badge>}
            {!c.taughtSubject && <Badge tone="amber">Chưa dạy môn này</Badge>}
            {current && <Badge tone="blue">Đang dạy</Badge>}
          </span>
        </span>
      </button>
    </li>
  )
}
