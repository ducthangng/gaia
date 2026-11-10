import { Archive, ArchiveRestore, CopyPlus, FileSpreadsheet, GitCompareArrows, LockOpen, Trash2 } from 'lucide-react'
import { exportWeekSheet } from '../services/exports'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge, Button, Card, PageHeader, toast } from '../components/ui'
import { coverage } from '../domain/issues'
import { buildContext } from '../domain/context'
import { addDays, money, shortDate } from '../domain/time'
import { isLiveWeek, type Week } from '../domain/types'
import { weekCosts } from '../hooks'
import { useLiveWeeks, useStore } from '../store'

const weekText = (w: Week) => `${shortDate(w.startDate)} – ${shortDate(w.endDate)}`

export function WeeksPage() {
  const s = useStore()
  const navigate = useNavigate()
  const weeks = useLiveWeeks()
  const deleted = useMemo(() => s.weeks.filter((w) => !isLiveWeek(w)).sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!)), [s.weeks])
  const latest = weeks.at(-1)!
  const [source, setSource] = useState(latest.id)
  const [cmpA, setCmpA] = useState((weeks.at(-2) ?? latest).id)
  const [cmpB, setCmpB] = useState(latest.id)
  const rows = useMemo(() => [...weeks].reverse().map((w) => {
    const ctx = buildContext(w, s)
    return { week: w, cov: coverage(w.lessons), cost: weekCosts(ctx).reduce((sum, c) => sum + c.cost, 0) }
  // eslint-disable-next-line
  }), [weeks, s.teachers, s.schools, s.settings, s.kmOverrides, s.leaves])
  const nextStart = addDays(weeks.map((w) => w.startDate).sort().at(-1)!, 7)
  const replacesDeleted = deleted.some((w) => w.id === nextStart)
  const live = (id: string) => (weeks.some((w) => w.id === id) ? id : latest.id)

  const remove = (w: Week) => {
    const note = w.status === 'archived' ? '\nTuần này đã lưu trữ (đã chốt km và chi phí).' : ''
    if (!confirm(`Xoá lịch tuần ${weekText(w)} (${w.lessons.length} ca)?${note}\nTuần sẽ bị ẩn khỏi mọi màn hình, khôi phục được ở mục "Tuần đã xoá".`)) return
    if (!s.deleteWeek(w.id)) {
      toast('Không xoá được: phải còn ít nhất một tuần')
      return
    }
    toast(`Đã xoá tuần ${weekText(w)}`, { label: 'Hoàn tác', run: () => s.restoreWeek(w.id) })
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <PageHeader title="Lịch tuần & lưu trữ" subtitle="Tuần đã lưu trữ được đóng băng: số km và chi phí không đổi khi biểu giá thay đổi, phục vụ đối soát và chấm công." />
      <Card title="Lập kế hoạch tuần mới">
        <div className="flex flex-wrap items-center gap-3 p-5">
          <span>Sao chép từ</span>
          <select aria-label="Tuần nguồn" value={live(source)} onChange={(e) => setSource(e.target.value)}>
            {[...weeks].reverse().map((w) => <option key={w.id} value={w.id}>{weekText(w)}</option>)}
          </select>
          <span>sang tuần {shortDate(nextStart)} – {shortDate(addDays(nextStart, 6))}</span>
          <Button variant="primary" onClick={() => {
            if (replacesDeleted && !confirm(`Tuần ${shortDate(nextStart)} đang nằm trong mục "Tuần đã xoá". Tạo tuần mới sẽ xoá hẳn bản cũ đó. Tiếp tục?`)) return
            s.planNewWeek(live(source))
            toast('Đã tạo tuần mới từ lịch cố định. Ca dạy bù, hỗ trợ, chuyên đề không được sao chép')
            navigate('/')
          }}><CopyPlus size={14} />Tạo tuần mới</Button>
        </div>
      </Card>
      <Card title="So sánh hai tuần">
        <div className="flex flex-wrap items-center gap-3 p-5">
          <span>So</span>
          <select aria-label="Tuần A" value={live(cmpA)} onChange={(e) => setCmpA(e.target.value)}>
            {[...weeks].reverse().map((w) => <option key={w.id} value={w.id}>{weekText(w)}</option>)}
          </select>
          <span>với</span>
          <select aria-label="Tuần B" value={live(cmpB)} onChange={(e) => setCmpB(e.target.value)}>
            {[...weeks].reverse().map((w) => <option key={w.id} value={w.id}>{weekText(w)}</option>)}
          </select>
          <Button onClick={() => navigate(`/weeks/compare?a=${live(cmpA)}&b=${live(cmpB)}&view=school`)}><GitCompareArrows size={14} />Trường thay đổi gì</Button>
          <Button onClick={() => navigate(`/weeks/compare?a=${live(cmpA)}&b=${live(cmpB)}&view=teacher`)}><GitCompareArrows size={14} />Giáo viên thay đổi gì</Button>
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
                <td className="px-5 py-3"><button className="font-medium hover:text-emerald-700 hover:underline" onClick={() => { s.setActiveWeek(w.id); navigate('/') }}>{weekText(w)}</button><span className="ml-2 text-xs text-slate-500">{w.label}</span></td>
                <td>{w.status === 'planning' ? <Badge tone="green">Đang lập</Badge> : <Badge>Đã lưu trữ</Badge>}</td>
                <td className="text-right">{w.lessons.length}</td>
                <td className="text-right">{(cov.ratio * 100).toFixed(1)}%</td>
                <td className="text-right">{money(cost)}</td>
                <td className="whitespace-nowrap px-5 py-2.5 text-right">
                  <Button variant="ghost" className="mr-1" title="Xuất lịch tuần này theo mẫu Gaia" data-testid={`export-${w.id}`} onClick={async () => {
                    const n = await exportWeekSheet(buildContext(w, s))
                    toast(n ? `Đã xuất, nhưng ${n} ca không còn ô trống nên chưa có trong file` : 'Đã xuất lịch tuần theo mẫu Gaia')
                  }}><FileSpreadsheet size={13} />Excel</Button>
                  {w.status === 'planning' ? (
                    <Button onClick={() => { s.archiveWeek(w.id); toast('Đã đóng băng và lưu trữ tuần') }}><Archive size={13} />Lưu trữ</Button>
                  ) : (
                    <Button variant="ghost" onClick={() => { s.reopenWeek(w.id); toast('Đã mở lại tuần để chỉnh sửa') }}><LockOpen size={13} />Mở lại</Button>
                  )}
                  <Button variant="ghost" className="ml-1 text-red-700" title={weeks.length > 1 ? 'Xoá tuần (khôi phục được)' : 'Phải còn ít nhất một tuần'} disabled={weeks.length <= 1} data-testid={`delete-${w.id}`} onClick={() => remove(w)}><Trash2 size={13} />Xoá</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {deleted.length > 0 && (
        <Card title={`Tuần đã xoá (${deleted.length})`}>
          <table className="w-full">
            <tbody className="tnum divide-y divide-slate-100">
              {deleted.map((w) => (
                <tr key={w.id} className="text-slate-500">
                  <td className="px-5 py-3"><span className="font-medium text-slate-700">{weekText(w)}</span><span className="ml-2 text-xs">{w.label}</span></td>
                  <td>{w.status === 'planning' ? 'Đang lập' : 'Đã lưu trữ'}</td>
                  <td className="text-right">{w.lessons.length} ca</td>
                  <td className="text-right text-xs">Xoá lúc {new Date(w.deletedAt!).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-right">
                    <Button onClick={() => { s.restoreWeek(w.id); toast(`Đã khôi phục tuần ${weekText(w)}`) }}><ArchiveRestore size={13} />Khôi phục</Button>
                    <Button variant="ghost" className="ml-1 text-red-700" onClick={() => {
                      if (confirm(`Xoá vĩnh viễn tuần ${weekText(w)} cùng ${w.lessons.length} ca? Không khôi phục lại được trên giao diện.`)) {
                        s.purgeWeek(w.id)
                        toast('Đã xoá vĩnh viễn')
                      }
                    }}><Trash2 size={13} />Xoá vĩnh viễn</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
