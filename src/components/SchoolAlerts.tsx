import { AlertOctagon, AlertTriangle, Info } from 'lucide-react'
import { googleDirectionsUrl } from '../domain/geo'
import type { Issue } from '../domain/issues'
import type { Ctx } from '../hooks'

export const SEVERITY_ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info }
export const SEVERITY_COLOR = { critical: 'text-red-600', warning: 'text-amber-600', info: 'text-sky-600' }

export const travelLink = (i: Issue, ctx: Ctx) => {
  const a = i.related && ctx.schoolById.get(i.related.schoolId)
  const b = ctx.schoolById.get(i.lesson.schoolId)
  return a && b ? googleDirectionsUrl({ name: a.fullName, geo: a.geo, address: a.address }, { name: b.fullName, geo: b.geo, address: b.address }) : null
}

/** Mô tả cặp ca để điều phối thấy ngay GV đi từ đâu sang đâu, lúc mấy giờ. */
export function PairDetail({ issue: i, ctx }: { issue: Issue; ctx: Ctx }) {
  if (!i.related) return null
  const from = ctx.schoolById.get(i.related.schoolId)?.fullName
  const to = ctx.schoolById.get(i.lesson.schoolId)?.fullName
  return (
    <div className="mt-1 text-xs text-slate-600">
      <span className="tnum font-medium">{i.related.start}–{i.related.end}</span> lớp {i.related.className ?? '—'} tại {from}
      {' → '}
      <span className="tnum font-medium">{i.lesson.start}–{i.lesson.end}</span> lớp {i.lesson.className ?? '—'} tại {to}
    </div>
  )
}
