import { FileDown, Info } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, PageHeader, Stat } from '../components/ui'
import { dayLabel, money, weekDates } from '../domain/time'
import { useWeekContext, weekCosts } from '../hooks'
import { exportWeek } from '../services/exports'

export function CostsPage() {
  const ctx = useWeekContext()
  const [sort, setSort] = useState<'cost' | 'name'>('cost')
  const dates = weekDates(ctx.week.startDate)
  const rows = useMemo(() => weekCosts(ctx).filter((c) => c.km > 0 || c.cost > 0), [ctx])
  const name = (id: string) => ctx.teacherById.get(id)?.name ?? id
  const sorted = [...rows].sort((a, b) => (sort === 'cost' ? b.cost - a.cost : name(a.teacherId).localeCompare(name(b.teacherId), 'vi')))
  const total = rows.reduce((s, r) => s + r.cost, 0)
  const km = rows.reduce((s, r) => s + r.km, 0)
  const dayTotals = dates.map((_, i) => rows.reduce((s, r) => s + r.days[i].cost, 0))
  const estimated = rows.filter((r) => r.hasEstimate).length
  const reported = ctx.week.reported
  const tier = ctx.settings.costPolicy === 'tier'
  const from = ctx.week.reportedFrom ?? ctx.week.startDate
  const inWorkbook = (i: number) => dates[i] >= from
  const compareOn = !!reported && tier && ctx.week.status === 'archived'
  const reportedSum = (r: (typeof rows)[number]) => r.days.reduce((s, d, i) => s + (inWorkbook(i) ? d.cost : 0), 0)
  const recordedTotal = ctx.week.legs.reduce((sum, l) => sum + l.cost, 0)
  const unrecordedDays = rows.reduce((n, r) => n + r.days.filter((d) => d.legs.length && !ctx.week.legs.some((l) => l.teacherId === r.teacherId && l.date === d.date)).length, 0)
  const mismatches = compareOn ? sorted.filter((r) => (reported?.[r.teacherId]?.cost ?? 0) !== reportedSum(r)).length : 0

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Chi phí di chuyển"
        subtitle="Có ca sáng: xuất phát từ Nhà. Chỉ có ca chiều: xuất phát từ Văn phòng. Mỗi lần đổi trường trong ngày là một chặng mới."
        actions={<>
          <select aria-label="Sắp xếp" value={sort} onChange={(e) => setSort(e.target.value as 'cost' | 'name')}><option value="cost">Chi phí cao nhất</option><option value="name">Theo tên</option></select>
          <Button onClick={() => exportWeek(ctx)}><FileDown size={14} />Xuất Excel</Button>
          <Button onClick={() => window.open('/print/costs', '_blank')}><FileDown size={14} />Xuất PDF</Button>
        </>}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Tổng chi phí tuần" value={money(total)} />
        <Stat label="Tổng quãng đường" value={`${Math.round(km).toLocaleString('vi-VN')} km`} hint="Gồm chặng cuối về nhà" />
        <Stat label="Giáo viên có di chuyển" value={rows.length} />
        {compareOn ? (
          <Stat label="Đối soát với workbook" value={mismatches ? `Lệch ${mismatches} GV` : 'Khớp 100%'} tone={mismatches ? 'warning' : undefined} hint={from !== ctx.week.startDate ? `Cột CTP tính từ ${from} do tuần vắt qua hai tháng` : 'So với cột CTP từng giáo viên'} />
        ) : <Stat label="GV có chặng ước tính km" value={estimated} tone={estimated ? 'warning' : undefined} hint="Chưa từng ghi nhận km cho chặng đó" />}
      </div>
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600">
        <Info size={14} className="mt-0.5 shrink-0 text-sky-600" />
        {tier ? (
          <span>Đang tính theo <b>bậc khoảng cách của workbook</b> (mỗi chặng một mức, chặng về nhà không tính tiền). Đổi sang km × đơn giá tại <Link className="text-emerald-700 underline" to="/settings">Cấu hình</Link>.</span>
        ) : (
          <span>Đang tính theo <b>km × {money(ctx.settings.ratePerKm)}</b> trên toàn lộ trình gồm chặng về nhà. Đơn giá này là giá trị tạm, kết quả sẽ không khớp workbook. <Link className="text-emerald-700 underline" to="/settings">Cấu hình</Link></span>
        )}
      </div>
      {!compareOn && tier && unrecordedDays > 0 && ctx.week.legs.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>Workbook mới ghi {money(recordedTotal)} cho tuần này vì còn {unrecordedDays} ngày dạy của giáo viên chưa điền XUẤT PHÁT và SỐ KM. Số trên đây là dự kiến đủ cả tuần, nên cao hơn.</span>
        </div>
      )}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-200 text-xs text-slate-500">
              <tr>
                <th className="sticky left-0 bg-white px-4 py-2 text-left font-medium">Giáo viên</th>
                {dates.map((d) => <th key={d} className="px-2 py-2 text-right font-medium">{dayLabel(d)}</th>)}
                <th className="px-2 py-2 text-right font-medium">Km</th>
                <th className="px-4 py-2 text-right font-medium">Tổng</th>
                {compareOn && <th className="px-4 py-2 text-right font-medium">Workbook</th>}
              </tr>
            </thead>
            <tbody className="tnum divide-y divide-slate-100">
              {sorted.map((r) => {
                const rep = reported?.[r.teacherId]?.cost ?? 0
                return (
                  <tr key={r.teacherId} className="hover:bg-slate-50">
                    <td className="sticky left-0 bg-white px-4 py-1.5"><Link to={`/teachers/${r.teacherId}`} className="font-medium hover:text-emerald-700 hover:underline">{name(r.teacherId)}</Link>{r.hasEstimate && <Badge tone="amber" className="ml-1.5">ước tính</Badge>}</td>
                    {r.days.map((d) => (
                      <td key={d.date} className="px-2 py-1.5 text-right" title={d.legs.length ? `${d.legs.map((l) => `${l.start} ${l.km}km`).join(' → ')} → về nhà ${d.returnKm}km` : undefined}>
                        {d.legs.length ? (d.cost ? d.cost.toLocaleString('vi-VN') : <span className="text-slate-400">0</span>) : ''}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right text-slate-500">{Math.round(r.km)}</td>
                    <td className="px-4 py-1.5 text-right font-semibold">{r.cost.toLocaleString('vi-VN')}</td>
                    {compareOn && <td className={`px-4 py-1.5 text-right ${rep === reportedSum(r) ? 'text-slate-500' : 'font-medium text-amber-700'}`}>{rep.toLocaleString('vi-VN')}</td>}
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="tnum border-t-2 border-slate-200 font-semibold">
              <tr>
                <td className="sticky left-0 bg-white px-4 py-2">Tổng cộng</td>
                {dayTotals.map((t, i) => <td key={i} className="px-2 py-2 text-right">{t ? t.toLocaleString('vi-VN') : ''}</td>)}
                <td className="px-2 py-2 text-right">{Math.round(km).toLocaleString('vi-VN')}</td>
                <td className="px-4 py-2 text-right">{total.toLocaleString('vi-VN')}</td>
                {compareOn && <td className="px-4 py-2 text-right text-slate-500">{rows.reduce((s, r) => s + (reported?.[r.teacherId]?.cost ?? 0), 0).toLocaleString('vi-VN')}</td>}
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  )
}
