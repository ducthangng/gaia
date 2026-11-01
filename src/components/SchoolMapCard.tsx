import { ExternalLink, MapPin } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { googleSearchUrl, isPrecise, parseLatLng } from '../domain/geo'
import { schoolTransfers, type Issue } from '../domain/issues'
import type { School } from '../domain/types'
import type { Ctx } from '../hooks'
import { useStore } from '../store'
import { Badge, Button, Card, toast } from './ui'
import type { MapLink } from './TravelMap'

const TravelMap = lazy(() => import('./TravelMap'))

const SOURCE_LABEL = { pluscode: 'Vị trí theo Plus Code', street: 'Vị trí theo tên đường', manual: 'Toạ độ nhập tay', region: 'Vị trí gần đúng theo khu vực' }

export function SchoolMapCard({ school: s, ctx, issues, active, onSelect }: { school: School; ctx: Ctx; issues: Issue[]; active: Issue | null; onSelect: (i: Issue | null) => void }) {
  const updateSchool = useStore((st) => st.updateSchool)
  const [coord, setCoord] = useState('')
  const place = (id: string) => {
    const x = ctx.schoolById.get(id)
    return x?.geo ? { id, name: x.fullName, lat: x.geo.lat, lng: x.geo.lng, approximate: !isPrecise(x.geo) } : null
  }
  const links: MapLink[] = []
  for (const i of issues) {
    if (i.kind !== 'travel' || !i.related) continue
    const from = place(i.related.schoolId)
    const to = place(i.lesson.schoolId)
    if (from && to) links.push({ id: `${i.lesson.id}-${i.related.id}`, from, to, problem: true, active: i === active, label: i.detail, onClick: () => onSelect(i) })
  }
  const transfers = schoolTransfers(ctx, s.id)
  let missing = 0
  for (const t of transfers) {
    const here = place(s.id)
    const other = place(t.otherSchoolId)
    if (!here || !other) { missing += t.count; continue }
    links.push({ id: `t-${t.otherSchoolId}`, from: here, to: other, problem: false, active: false, label: `${t.count} lượt di chuyển với ${other.name} trong tuần` })
  }
  const save = () => {
    const parsed = parseLatLng(coord)
    if (!parsed) { toast('Toạ độ chưa đúng, ví dụ: 10.5054, 107.1761'); return }
    updateSchool(s.id, { geo: { ...parsed, source: 'manual' } })
    setCoord('')
    toast('Đã lưu toạ độ trường')
  }
  const focus = place(s.id)
  return (
    <Card
      title={<span className="inline-flex items-center gap-1.5"><MapPin size={14} />Bản đồ di chuyển</span>}
      actions={s.geo ? <Badge tone={isPrecise(s.geo) ? 'green' : 'amber'}>{SOURCE_LABEL[s.geo.source]}</Badge> : <Badge tone="amber">Chưa có toạ độ</Badge>}
    >
      {focus ? (
        <Suspense fallback={<div className="h-80 animate-pulse bg-slate-100" />}>
          <TravelMap focus={focus} links={links} />
        </Suspense>
      ) : <div className="px-4 py-6 text-center text-slate-500">Trường này chưa có địa chỉ để đặt lên bản đồ.</div>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-4 py-2 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-amber-500" />Chặng không kịp</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-0.5 w-5 bg-slate-400" />Có giáo viên đi lại trong tuần</span>
        {missing > 0 && <span>{missing} lượt chưa vẽ được vì thiếu toạ độ</span>}
        {(!s.geo || !isPrecise(s.geo)) && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <a className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline" href={googleSearchUrl({ name: s.fullName, address: s.address })} target="_blank" rel="noreferrer"><ExternalLink size={12} />Tìm trên Google Maps</a>
            <input aria-label="Toạ độ trường" className="w-44 text-xs" placeholder="Dán toạ độ: 10.50, 107.17" value={coord} onChange={(e) => setCoord(e.target.value)} />
            <Button className="!py-0.5 text-xs" onClick={save}>Lưu</Button>
          </span>
        )}
      </div>
    </Card>
  )
}
