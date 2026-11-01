import clsx from 'clsx'
import { AlertTriangle, Check, ChevronDown, Lightbulb, UserRound, UsersRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { coverOptions, openLessons, type CoverGoal, type CoverPlan } from '../domain/cover-plan'
import { dayIndex, DAY_LABELS, money } from '../domain/time'
import { teacherLabel, type Lesson } from '../domain/types'
import type { Ctx } from '../hooks'
import { useStore } from '../store'
import { EntityAnchor } from './EntityLink'
import { Badge, Button, Card, toast } from './ui'

const GOAL: Record<CoverGoal, { label: string; tone: 'blue' | 'green' | 'violet' }> = {
  fewest: { label: 'Ít giáo viên nhất', tone: 'blue' },
  cheapest: { label: 'Tiết kiệm nhất', tone: 'green' },
  'best-fit': { label: 'Đúng Refer và nguyện vọng nhất', tone: 'violet' },
}

const when = (l: Lesson) => `${DAY_LABELS[dayIndex(l.date)]} ${l.start ?? `tiết ${l.period}`}${l.className ? ` lớp ${l.className}` : ''}`
const signed = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : 'Không tốn thêm')

function PlanCard({ plan: p, ctx, title }: { plan: CoverPlan; ctx: Ctx; title?: string }) {
  const applySuggestion = useStore((s) => s.applySuggestion)
  const undo = useStore((s) => s.undoLastEdit)
  const [open, setOpen] = useState(p.shares.length > 1 || p.goals.length > 0)
  const name = (id: string) => { const t = ctx.teacherById.get(id); return t ? teacherLabel(t) : id }
  return (
    <div className="rounded-md border border-slate-200" data-testid="cover-plan" data-goals={p.goals.join(',')} data-teachers={p.shares.length} data-cost={p.extraCost} data-uncovered={p.uncovered.length}>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-1.5">
            {p.goals.map((g) => <Badge key={g} tone={GOAL[g].tone}>{GOAL[g].label}</Badge>)}
            {title && <span className="font-semibold"><EntityAnchor kind="teacher" id={p.shares[0].teacherId}>{title}</EntityAnchor></span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            {!title && <span className="inline-flex items-center gap-1 font-semibold">{p.shares.length === 1 ? <UserRound size={13} /> : <UsersRound size={13} />}{p.shares.length} giáo viên</span>}
            <span className={clsx('tnum font-semibold', p.extraCost > 0 ? 'text-amber-800' : 'text-emerald-800')}>{signed(p.extraCost)}/tuần</span>
            {p.notReferred > 0 && <span className="text-slate-600">{p.notReferred} ca ngoài Refer</span>}
            {p.violations > 0 && <span className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle size={11} />{p.violations} ca ngoài nguyện vọng</span>}
            {p.uncovered.length > 0 && <span className="inline-flex items-center gap-1 font-medium text-red-700"><AlertTriangle size={11} />Còn {p.uncovered.length} ca chưa ai nhận được</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button className="!py-1 text-xs" aria-expanded={open} onClick={() => setOpen((x) => !x)}><ChevronDown size={13} className={clsx('transition-transform', open && 'rotate-180')} />Chi tiết</Button>
          <Button variant="primary" className="!py-1 text-xs" onClick={() => {
            applySuggestion(p.changes)
            toast(`Đã xếp ${p.changes.length} ca`, { label: 'Hoàn tác', run: undo })
          }}>Áp dụng</Button>
        </div>
      </div>
      {open && (
        <ul className="divide-y divide-slate-100 border-t border-slate-100 text-xs">
          {p.shares.map((s) => (
            <li key={s.teacherId} className="grid gap-x-3 px-4 py-2 sm:grid-cols-[minmax(0,240px)_90px_minmax(0,1fr)]">
              <span className="font-medium"><EntityAnchor kind="teacher" id={s.teacherId}>{name(s.teacherId)}</EntityAnchor></span>
              <span className="tnum text-slate-600">{signed(s.extraCost)}</span>
              <span className="text-slate-600">{s.lessons.map(when).join(', ')}</span>
            </li>
          ))}
          {p.uncovered.length > 0 && <li className="px-3 py-1.5 text-red-800"><b>Chưa ai nhận được:</b> {p.uncovered.map(when).join(', ')}</li>}
        </ul>
      )}
    </div>
  )
}

/** Gợi ý ai có thể nhận các ca còn trống của trường, theo nhiều mục tiêu để điều phối tự chọn. */
export function CoverSuggestions({ schoolId, ctx }: { schoolId: string; ctx: Ctx }) {
  const open = useMemo(() => openLessons(ctx, schoolId), [ctx, schoolId])
  const options = useMemo(() => (open.length && ctx.week.status === 'planning' ? coverOptions(schoolId, ctx) : null), [open.length, ctx, schoolId])
  const [showSolo, setShowSolo] = useState(true)
  const title = <span className="inline-flex items-center gap-1.5"><Lightbulb size={14} className="text-amber-600" />Gợi ý xếp ca trống{open.length ? ` (${open.length} ca)` : ''}</span>
  if (ctx.week.status !== 'planning') return null
  if (!options) {
    return (
      <Card title={title}>
        <div className="flex items-center gap-2 px-4 py-3 text-slate-600" data-testid="cover-empty"><Check size={15} className="text-emerald-600" />Trường không còn ca trống trong tuần này. Khi có giáo viên xin nghỉ hoặc thêm ca mới, gợi ý sẽ hiện ở đây.</div>
      </Card>
    )
  }
  return (
    <Card title={title}>
      <div className="space-y-5 p-5" data-testid="cover-suggestions">
        <section>
          <h3 className="mb-1.5 text-xs font-semibold text-slate-500">PHƯƠNG ÁN THEO MỤC TIÊU</h3>
          <div className="space-y-3">{options.plans.map((p) => <PlanCard key={p.id} plan={p} ctx={ctx} />)}</div>
        </section>
        <section>
          <button className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800" aria-expanded={showSolo} onClick={() => setShowSolo((x) => !x)}>
            <ChevronDown size={13} className={clsx('transition-transform', showSolo && 'rotate-180')} />GIÁO VIÊN TRỐNG NHẬN ĐƯỢC TẤT CẢ ({options.soloPlans.length})
          </button>
          {showSolo && (options.soloPlans.length ? (
            <div className="space-y-3" data-testid="cover-solo">{options.soloPlans.map((p) => <PlanCard key={p.id} plan={p} ctx={ctx} title={teacherLabel(ctx.teacherById.get(p.shares[0].teacherId)!)} />)}</div>
          ) : <p className="text-slate-600" data-testid="cover-no-solo">Không có giáo viên nào một mình nhận hết được, thường do có ca trùng giờ hoặc người khác đang bận. Xem các phương án nhiều người ở trên.</p>)}
        </section>
        <p className="text-xs text-slate-500">Mọi phương án đều đã loại trùng lịch, nghỉ phép và chặng không kịp. Số tiền là phần tăng thêm so với lịch hiện tại, có thể dùng km ước tính. "Ít nhất" và "tiết kiệm nhất" là kết quả tốt nhất hệ thống tìm được.</p>
      </div>
    </Card>
  )
}
