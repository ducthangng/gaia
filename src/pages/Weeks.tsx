import { Archive, CopyPlus, FileSpreadsheet, LockOpen } from 'lucide-react'
import { exportWeekSheet } from '../services/exports'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Card, PageHeader, toast } from '../components/ui'
import { coverage } from '../domain/issues'
import { buildContext } from '../domain/context'
import { addDays, money, shortDate } from '../domain/time'
import { weekCosts } from '../hooks'
import { useStore } from '../store'

export function WeeksPage() {
  const s = useStore()
  const navigate = useNavigate()
  const latest = s.weeks.at(-1)!
  const [source, setSource] = useState(latest.id)
  const rows = useMemo(() => [...s.weeks].reverse().map((w) => {
    const ctx = buildContext(w, s)
    return { week: w, cov: coverage(w.lessons), cost: weekCosts(ctx).reduce((sum, c) => sum + c.cost, 0) }
  // eslint-disable-next-line
  }), [s.weeks, s.teachers, s.schools, s.settings, s.kmOverrides, s.leaves])
  const nextStart = addDays(s.weeks.map((w) => w.startDate).sort().at(-1)!, 7)
  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <PageHeader title="Lịch tuần & lưu trữ" subtitle="Tuần đã lưu trữ được đóng băng: số km và chi phí không đổi khi biểu giá thay đổi, phục vụ đối soát và chấm công." />
      <Card title="Lập kế hoạch tuần mới">
        <div className="flex flex-wrap items-center gap-3 p-5">
          <span>Sao chép từ</span>
          <select aria-label="Tuần nguồn" value={source} onChange={(e) => setSource(e.target.value)}>
            {[...s.weeks].reverse().map((w) => <option key={w.id} value={w.id}>{shortDate(w.startDate)} – {shortDate(w.endDate)}</option>)}
          </select>
          <span>sang tuần {shortDate(nextStart)} – {shortDate(addDays(nextStart, 6))}</span>
          <Button variant="primary" onClick={() => {
            s.planNewWeek(source)
            toast('Đã tạo tuần mới từ lịch cố định. Ca dạy bù, hỗ trợ, chuyên đề không được sao chép')
            navigate('/')
          }}><CopyPlus size={14} />Tạo tuần mới</Button>
        </div>
      </Card>
      <Card title="Các tuần">
        <table className="w-full">
          <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
            <tr><th className="px-5 py-3 font-medium">Tuần</th><th className="font-medium">Trạng thái</th><th className="text-right font-medium">Số ca</th><th className="text-right font-medium">Độ phủ</th><th className="text-right font-medium">Chi phí</th><th className="px-4 text-right font-medium">Thao tác</th></tr>
          </thead>
          <tbody className="tnum divide-y divide-slate-100">
            {rows.map(({ week: w, cov, cost }) => (
              <tr key={w.id} className={w.id === s.activeWeekId ? 'bg-emerald-50/40' : ''}>
                <td className="px-5 py-3"><button className="font-medium hover:text-emerald-700 hover:underline" onClick={() => { s.setActiveWeek(w.id); navigate('/') }}>{shortDate(w.startDate)} – {shortDate(w.endDate)}</button><span className="ml-2 text-xs text-slate-500">{w.label}</span></td>
                <td>{w.status === 'planning' ? <Badge tone="green">Đang lập</Badge> : <Badge>Đã lưu trữ</Badge>}</td>
                <td className="text-right">{w.lessons.length}</td>
                <td className="text-right">{(cov.ratio * 100).toFixed(1)}%</td>
                <td className="text-right">{money(cost)}</td>
                <td className="px-5 py-2.5 text-right">
                  <Button variant="ghost" className="mr-1" title="Xuất lịch tuần này theo mẫu Gaia" data-testid={`export-${w.id}`} onClick={async () => {
                    const n = await exportWeekSheet(buildContext(w, s))
                    toast(n ? `Đã xuất, nhưng ${n} ca không còn ô trống nên chưa có trong file` : 'Đã xuất lịch tuần theo mẫu Gaia')
                  }}><FileSpreadsheet size={13} />Excel</Button>
                  {w.status === 'planning' ? (
                    <Button onClick={() => { s.archiveWeek(w.id); toast('Đã đóng băng và lưu trữ tuần') }}><Archive size={13} />Lưu trữ</Button>
                  ) : (
                    <Button variant="ghost" onClick={() => { s.reopenWeek(w.id); toast('Đã mở lại tuần để chỉnh sửa') }}><LockOpen size={13} />Mở lại</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
