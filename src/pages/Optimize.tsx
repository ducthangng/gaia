import clsx from 'clsx'
import { AlertTriangle, Check, ChevronDown, Info, RefreshCw, WandSparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { openReassignConfirm } from '../components/CostExplanation'
import { EntityAnchor, EntityText } from '../components/EntityLink'
import { Badge, Button, Card, Empty, PageHeader, Stat, toast } from '../components/ui'
import { changesImpact, changeState, pendingChanges, planLessonMove, suggestOptimizations, type Suggestion, type SuggestionKind } from '../domain/optimize'
import { byTime } from '../domain/route'
import { dayLabel, money } from '../domain/time'
import { teacherLabel } from '../domain/types'
import { useWeekContext, type Ctx } from '../hooks'
import { useStore } from '../store'

const KIND_LABEL: Record<SuggestionKind, string> = { fix: 'Sửa lỗi', cost: 'Giảm chi phí', area: 'Đúng khu vực mong muốn' }
const SCOPE_LABEL = { week: 'Cả tuần', day: 'Một ngày', lesson: 'Một ca' }

export function OptimizePage() {
  const ctx = useWeekContext()
  const [dismissed, setDismissed] = useState<string[]>([])
  const [kind, setKind] = useState<SuggestionKind | 'all'>('all')
  const [round, setRound] = useState(0)
  // Danh sách đứng yên khi đang đổi từng ca, nếu không đổi xong một ca thì thẻ đề xuất sẽ biến mất.
  // Chỉ tính lại khi chuyển tuần hoặc khi người dùng yêu cầu.
  const computed = useMemo(() => ({ list: suggestOptimizations(ctx), lessons: ctx.week.lessons }), [round, ctx.week.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const scheduleChanged = computed.lessons !== ctx.week.lessons
  const all = computed.list.filter((s) => !dismissed.includes(s.id))
  const shown = all.filter((s) => kind === 'all' || s.kind === kind)
  const remaining = useMemo(() => all.map((s) => ({ s, impact: changesImpact(pendingChanges(s, ctx), ctx) })), [computed, dismissed, ctx]) // eslint-disable-line react-hooks/exhaustive-deps
  const moves = remaining.filter((x) => x.s.kind !== 'fix' && pendingChanges(x.s, ctx).length)
  const saving = moves.reduce((a, x) => a + x.impact.saving, 0)
  const km = moves.reduce((a, x) => a + x.impact.kmSaved, 0)
  const pref = moves.reduce((a, x) => a + Math.round((x.s.prefGain * pendingChanges(x.s, ctx).length) / x.s.changes.length), 0)
  const fixes = remaining.filter((x) => x.s.kind === 'fix' && pendingChanges(x.s, ctx).length).length
  if (ctx.week.status !== 'planning') {
    return <div className="mx-auto max-w-[1000px]"><PageHeader title="Tối ưu lịch" /><Card><Empty>Tuần này đã lưu trữ nên không có đề xuất. Chọn tuần đang lập ở thanh trên cùng.</Empty></Card></div>
  }
  const pill = (active: boolean) => clsx('rounded-full border px-3.5 py-1.5 font-medium', active ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100')
  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        title="Tối ưu lịch"
        subtitle="Các thay đổi đề xuất để lịch trơn tru hơn. Không có gì tự áp dụng: bạn có thể áp dụng cả đề xuất, hoặc mở ra đổi từng ca."
        actions={<Button onClick={() => { setRound((x) => x + 1); setDismissed([]) }}><RefreshCw size={14} />Tính lại đề xuất</Button>}
      />
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Lỗi còn sửa được" value={fixes} tone={fixes ? 'critical' : undefined} />
        <Stat label="Tiết kiệm nếu áp dụng hết phần còn lại" value={`${money(saving)}/tuần`} hint={`Bớt khoảng ${Math.round(km)} km`} />
        <Stat label="Ca về đúng nguyện vọng" value={pref} hint="Ước tính theo phần còn lại" />
        <Stat label="Số đề xuất" value={all.length} />
      </div>
      {scheduleChanged && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sky-950" data-testid="optimize-stale">
          <Info size={14} className="shrink-0" />
          Lịch đã thay đổi so với lúc tính đề xuất. Số tiền trên từng thẻ đã cập nhật theo lịch hiện tại, nhưng có thể có đề xuất mới tốt hơn.
          <button className="font-semibold underline" onClick={() => { setRound((x) => x + 1); setDismissed([]) }}>Tính lại</button>
        </div>
      )}
      <div role="tablist" className="mb-5 flex flex-wrap gap-2">
        <button role="tab" aria-selected={kind === 'all'} className={pill(kind === 'all')} onClick={() => setKind('all')}>Tất cả <span className="tnum opacity-75">{all.length}</span></button>
        {(Object.keys(KIND_LABEL) as SuggestionKind[]).map((k) => <button key={k} role="tab" aria-selected={kind === k} className={pill(kind === k)} onClick={() => setKind(k)}>{KIND_LABEL[k]} <span className="tnum opacity-75">{all.filter((s) => s.kind === k).length}</span></button>)}
      </div>
      {!shown.length ? <Card><Empty>Chưa tìm thấy thay đổi nào đáng làm trong nhóm này.</Empty></Card> : (
        <div className="space-y-4" data-testid="suggestions">
          {shown.map((s) => <SuggestionCard key={s.id} s={s} ctx={ctx} onDismiss={() => setDismissed((x) => [...x, s.id])} />)}
        </div>
      )}
      <p className="mt-4 flex gap-1.5 text-xs text-slate-500"><Info size={13} className="mt-0.5 shrink-0" />Mỗi đề xuất đã được thử trên toàn bộ lịch: không phát sinh trùng lịch hay chặng không kịp, không làm nguyện vọng xấu đi, và không làm giáo viên nào tăng hay giảm quá 6 ca một tuần. Khi đổi từng ca, số tiền và cảnh báo được tính riêng cho đúng ca đó. Hệ thống chưa biết các yếu tố như quan hệ với trường hoặc nguyện vọng lớp học, nên điều phối vẫn cần cân nhắc.</p>
    </div>
  )
}

const signedSaving = (n: number) => (n > 0 ? `Tiết kiệm ${money(n)}` : n < 0 ? `Tốn thêm ${money(-n)}` : 'Không đổi tiền')

function SuggestionCard({ s, ctx, onDismiss }: { s: Suggestion; ctx: Ctx; onDismiss: () => void }) {
  const applySuggestion = useStore((st) => st.applySuggestion)
  const undo = useStore((st) => st.undoLastEdit)
  const [open, setOpen] = useState(false)
  const lessons = [...s.lessons].sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))
  const pending = pendingChanges(s, ctx)
  const done = s.changes.filter((c) => changeState(s, c, ctx) === 'done').length
  const impact = useMemo(() => changesImpact(pending, ctx), [ctx, s.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const partial = done > 0 || pending.length < s.changes.length
  const finished = !pending.length
  const applyRest = () => {
    applySuggestion(pending)
    toast(`Đã đổi ${pending.length} ca`, { label: 'Hoàn tác', run: undo })
  }
  return (
    <Card className={clsx(finished && 'opacity-70')}>
      <div className="flex flex-wrap items-start gap-4 px-5 py-4" data-testid="suggestion-card">
        <div className="min-w-0 flex-1 basis-96">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={s.kind === 'fix' ? 'red' : s.kind === 'cost' ? 'green' : 'blue'}>{KIND_LABEL[s.kind]}</Badge>
            <Badge>{SCOPE_LABEL[s.scope]}</Badge>
            {partial && <Badge tone="green" className="tnum"><span data-testid="suggestion-progress">Đã đổi {done}/{s.changes.length} ca</span></Badge>}
          </div>
          <div className="mt-1 font-semibold"><WandSparkles size={13} className="mr-1 inline text-emerald-700" /><EntityText text={s.title} /></div>
          <div className="text-slate-600"><EntityText text={s.reason} /></div>
          {!finished && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {impact.saving > 0 && <span className="font-semibold text-emerald-800">{partial ? 'Phần còn lại: ' : ''}Tiết kiệm {money(impact.saving)}/tuần</span>}
              {impact.saving < 0 && <span className="text-slate-700">{partial ? 'Phần còn lại: ' : ''}Tốn thêm {money(-impact.saving)}</span>}
              {impact.kmSaved > 0 && <span className="text-slate-600">Bớt {Math.round(impact.kmSaved)} km</span>}
              {!partial && s.prefGain > 0 && <span className="text-sky-800">{s.prefGain} ca về đúng nguyện vọng</span>}
              {!partial && s.load.map((l) => l.before !== l.after && <span key={l.teacherId} className="tnum text-slate-600"><EntityText text={l.teacherId} />: {l.before} → {l.after} ca</span>)}
              {!partial && s.referLoss > 0 && <span className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle size={11} />{s.referLoss} ca ra ngoài Refer tạm</span>}
              {s.scope === 'day' && <span className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle size={11} />Lớp đổi giáo viên một ngày</span>}
              {s.estimatedKm && <span className="text-slate-500">Có km ước tính</span>}
              {impact.newUrgent.length > 0 && <span className="inline-flex items-center gap-1 font-medium text-red-700"><AlertTriangle size={11} />Áp dụng phần còn lại sẽ gây {impact.newUrgent.length} cảnh báo do lịch đã đổi</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" aria-label="Bỏ qua đề xuất" title="Bỏ qua" onClick={onDismiss}><X size={14} /></Button>
          <Button aria-expanded={open} onClick={() => setOpen((x) => !x)}><ChevronDown size={14} className={clsx('transition-transform', open && 'rotate-180')} />Đổi từng ca ({s.changes.length})</Button>
          {finished ? <Badge tone="green"><Check size={11} />Xong</Badge> : (
            <Button variant="primary" disabled={impact.newUrgent.length > 0} onClick={applyRest}>{partial ? `Áp dụng ${pending.length} ca còn lại` : 'Áp dụng tất cả'}</Button>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t border-slate-100">
          {s.changes.length > 1 && <p className="flex gap-1.5 bg-slate-50 px-5 py-2.5 text-xs text-slate-600"><Info size={12} className="mt-0.5 shrink-0 text-sky-600" />Đổi lẻ thường chưa tiết kiệm: tiền chỉ giảm khi người cũ không còn ca nào tại trường trong ngày đó, nên số ở từng dòng có thể khác với số của cả đề xuất.</p>}
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {lessons.map((l) => <LessonRow key={l.id} s={s} lessonId={l.id} ctx={ctx} />)}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  )
}

function LessonRow({ s, lessonId, ctx }: { s: Suggestion; lessonId: string; ctx: Ctx }) {
  const applySuggestion = useStore((st) => st.applySuggestion)
  const undo = useStore((st) => st.undoLastEdit)
  const planned = s.lessons.find((l) => l.id === lessonId)!
  const change = s.changes.find((c) => c.lessonId === lessonId)!
  const state = changeState(s, change, ctx)
  const move = useMemo(() => (state === 'pending' ? planLessonMove(s, lessonId, ctx) : null), [state, ctx]) // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: string | null) => { const t = id ? ctx.teacherById.get(id) : null; return t ? teacherLabel(t) : 'Chưa có GV' }
  const paired = (move?.changes.length ?? 0) > 1
  return (
    <tr data-testid="suggestion-row" data-state={state} className={clsx(state === 'done' && 'bg-emerald-50/50')}>
      <td className="tnum whitespace-nowrap py-2.5 pl-5 pr-2 text-slate-600">{dayLabel(planned.date)} · {planned.start ?? `Tiết ${planned.period}`}</td>
      <td className="px-3 py-2.5"><EntityAnchor kind="school" id={planned.schoolId}>{ctx.schoolById.get(planned.schoolId)?.fullName}</EntityAnchor></td>
      <td className="whitespace-nowrap px-3 py-2.5">{planned.className ?? '—'} · {planned.subject ?? '—'}</td>
      <td className="px-3 py-2.5 text-slate-600"><EntityText text={name(planned.teacherId)} /> → <b className="text-slate-800"><EntityText text={name(change.teacherId)} /></b></td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        {move?.ok && <span data-testid="row-saving" data-saving={move.saving} className={clsx('tnum', move.saving > 0 ? 'font-medium text-emerald-800' : move.saving < 0 ? 'text-amber-800' : 'text-slate-500')}>{signedSaving(move.saving)}</span>}
        {move && !move.ok && <span className="inline-flex items-center gap-1 text-red-700" title={move.newUrgent.map((i) => i.detail).join('; ')}><AlertTriangle size={11} />Sẽ gây trùng lịch</span>}
      </td>
      <td className="whitespace-nowrap py-2.5 pl-2 pr-5 text-right">
        {state === 'done' && <span className="inline-flex items-center gap-1 font-medium text-emerald-800"><Check size={12} />Đã đổi</span>}
        {state === 'overridden' && <span className="text-slate-500" title="Ca này đã được đổi sang người khác hoặc không còn trong lịch">Lịch đã khác</span>}
        {move && (
          paired ? (
            <Button className="!py-0.5 text-xs" disabled={!move.ok} title="Các ca này đang vướng giờ nhau nên phải đổi cùng lúc" onClick={() => { applySuggestion(move.changes); toast(`Đã đổi ${move.changes.length} ca cùng lúc`, { label: 'Hoàn tác', run: undo }) }}>Đổi cùng lúc {move.changes.length} ca</Button>
          ) : (
            <Button className="!py-0.5 text-xs" disabled={!move.ok} onClick={() => openReassignConfirm({ lessonId, teacherId: change.teacherId })}>Đổi ca này</Button>
          )
        )}
      </td>
    </tr>
  )
}
