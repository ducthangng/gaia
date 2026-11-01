import clsx from 'clsx'
import { AlertTriangle, ChevronDown, Info, WandSparkles, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, Empty, PageHeader, Stat, toast } from '../components/ui'
import { suggestOptimizations, type Suggestion, type SuggestionKind } from '../domain/optimize'
import { byTime } from '../domain/route'
import { dayLabel, money } from '../domain/time'
import { teacherLabel } from '../domain/types'
import { useWeekContext, type Ctx } from '../hooks'
import { useStore } from '../store'

const KIND_LABEL: Record<SuggestionKind, string> = { fix: 'Sửa lỗi', cost: 'Giảm chi phí', area: 'Đúng khu vực mong muốn' }
const SCOPE_LABEL = { week: 'Cả tuần', day: 'Một ngày', lesson: 'Một ca' }

export function OptimizePage() {
  const ctx = useWeekContext()
  const applySuggestion = useStore((s) => s.applySuggestion)
  const undo = useStore((s) => s.undoLastEdit)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [kind, setKind] = useState<SuggestionKind | 'all'>('all')
  const all = useMemo(() => suggestOptimizations(ctx).filter((s) => !dismissed.includes(s.id)), [ctx, dismissed])
  const shown = all.filter((s) => kind === 'all' || s.kind === kind)
  const moves = all.filter((s) => s.kind !== 'fix')
  const saving = moves.reduce((a, s) => a + s.saving, 0)
  const km = moves.reduce((a, s) => a + s.kmSaved, 0)
  const pref = moves.reduce((a, s) => a + s.prefGain, 0)
  const fixes = all.length - moves.length
  if (ctx.week.status !== 'planning') {
    return <div className="mx-auto max-w-[1000px]"><PageHeader title="Tối ưu lịch" /><Card><Empty>Tuần này đã lưu trữ nên không có đề xuất. Chọn tuần đang lập ở thanh trên cùng.</Empty></Card></div>
  }
  const pill = (active: boolean) => clsx('rounded-full border px-3 py-1 font-medium', active ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100')
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="Tối ưu lịch" subtitle="Các thay đổi đề xuất để lịch trơn tru hơn. Không có gì tự áp dụng: bạn xem và chọn từng đề xuất." />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lỗi sửa được" value={fixes} tone={fixes ? 'critical' : undefined} />
        <Stat label="Tiết kiệm nếu áp dụng hết" value={`${money(saving)}/tuần`} hint={`Bớt khoảng ${Math.round(km)} km`} />
        <Stat label="Ca về đúng nguyện vọng" value={pref} />
        <Stat label="Số đề xuất" value={all.length} />
      </div>
      <div role="tablist" className="mb-3 flex flex-wrap gap-1.5">
        <button role="tab" aria-selected={kind === 'all'} className={pill(kind === 'all')} onClick={() => setKind('all')}>Tất cả <span className="tnum opacity-75">{all.length}</span></button>
        {(Object.keys(KIND_LABEL) as SuggestionKind[]).map((k) => <button key={k} role="tab" aria-selected={kind === k} className={pill(kind === k)} onClick={() => setKind(k)}>{KIND_LABEL[k]} <span className="tnum opacity-75">{all.filter((s) => s.kind === k).length}</span></button>)}
      </div>
      {!shown.length ? <Card><Empty>Chưa tìm thấy thay đổi nào đáng làm trong nhóm này.</Empty></Card> : (
        <div className="space-y-2.5" data-testid="suggestions">
          {shown.map((s) => <SuggestionCard key={s.id} s={s} ctx={ctx} onDismiss={() => setDismissed((x) => [...x, s.id])} onApply={() => { applySuggestion(s.changes); toast('Đã áp dụng đề xuất', { label: 'Hoàn tác', run: undo }) }} />)}
        </div>
      )}
      <p className="mt-4 flex gap-1.5 text-xs text-slate-500"><Info size={13} className="mt-0.5 shrink-0" />Mỗi đề xuất đã được thử trên toàn bộ lịch: không phát sinh trùng lịch hay chặng không kịp, không làm nguyện vọng xấu đi, và không làm giáo viên nào tăng hay giảm quá 6 ca một tuần. Mỗi giáo viên chỉ xuất hiện một lần nên có thể áp dụng tất cả. Hệ thống chưa biết các yếu tố như quan hệ với trường hoặc nguyện vọng lớp học, nên điều phối vẫn cần cân nhắc.</p>
    </div>
  )
}

function SuggestionCard({ s, ctx, onApply, onDismiss }: { s: Suggestion; ctx: Ctx; onApply: () => void; onDismiss: () => void }) {
  const [open, setOpen] = useState(false)
  const to = new Map(s.changes.map((c) => [c.lessonId, c.teacherId]))
  const lessons = [...s.lessons].sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))
  const name = (id: string | null) => { const t = id ? ctx.teacherById.get(id) : null; return t ? teacherLabel(t) : 'Chưa có GV' }
  return (
    <Card>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1 basis-96">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={s.kind === 'fix' ? 'red' : s.kind === 'cost' ? 'green' : 'blue'}>{KIND_LABEL[s.kind]}</Badge>
            <Badge>{SCOPE_LABEL[s.scope]}</Badge>
          </div>
          <div className="mt-1 font-semibold"><WandSparkles size={13} className="mr-1 inline text-emerald-700" />{s.title}</div>
          <div className="text-slate-600">{s.reason}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {s.saving > 0 && <span className="font-semibold text-emerald-800">Tiết kiệm {money(s.saving)}/tuần</span>}
            {s.saving < 0 && <span className="text-slate-700">Tốn thêm {money(-s.saving)}</span>}
            {s.kmSaved > 0 && <span className="text-slate-600">Bớt {Math.round(s.kmSaved)} km</span>}
            {s.prefGain > 0 && <span className="text-sky-800">{s.prefGain} ca về đúng nguyện vọng</span>}
            {s.load.map((l) => l.before !== l.after && <span key={l.teacherId} className="tnum text-slate-600">{l.teacherId}: {l.before} → {l.after} ca</span>)}
            {s.referLoss > 0 && <span className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle size={11} />{s.referLoss} ca ra ngoài Refer tạm</span>}
            {s.scope === 'day' && <span className="inline-flex items-center gap-1 text-amber-800"><AlertTriangle size={11} />Lớp đổi giáo viên một ngày</span>}
            {s.estimatedKm && <span className="text-slate-500">Có km ước tính</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" aria-label="Bỏ qua đề xuất" title="Bỏ qua" onClick={onDismiss}><X size={14} /></Button>
          <Button aria-expanded={open} onClick={() => setOpen((x) => !x)}><ChevronDown size={14} className={clsx('transition-transform', open && 'rotate-180')} />{lessons.length} ca</Button>
          <Button variant="primary" onClick={onApply}>Áp dụng</Button>
        </div>
      </div>
      {open && (
        <div className="max-h-56 overflow-y-auto border-t border-slate-100">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-50">
              {lessons.map((l) => (
                <tr key={l.id}>
                  <td className="tnum whitespace-nowrap px-4 py-1 text-slate-600">{dayLabel(l.date)} · {l.start ?? `Tiết ${l.period}`}</td>
                  <td className="px-2 py-1"><Link className="hover:text-emerald-700 hover:underline" to={`/schools/${l.schoolId}`}>{ctx.schoolById.get(l.schoolId)?.fullName}</Link></td>
                  <td className="whitespace-nowrap px-2 py-1">{l.className ?? '—'} · {l.subject ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-1 text-slate-600">{name(l.teacherId)} → <b className="text-slate-800">{name(to.get(l.id) ?? null)}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
