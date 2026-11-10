import { CheckCircle2, CircleAlert, Link2, Upload } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, PageHeader, toast } from '../components/ui'
import { addDays } from '../domain/time'
import { detectMonday, parseCsv, parsePreferencesGrid, parseReferGrid, parseWeekGrid, sheetIdFromUrl } from '../domain/sheet-grid'
import { fetchSheetTab } from '../services/sheets'
import { useLiveWeeks, useStore } from '../store'

type Kind = 'week' | 'preferences' | 'refer'

const KINDS: Record<Kind, { label: string; tab: string; help: string }> = {
  week: { label: 'Lịch tuần (bố cục workbook hiện tại)', tab: 'Thang 11 - Tuan 1', help: 'Mỗi giáo viên 22 dòng, mỗi ngày 12 cột như sheet đang dùng. CSV không có màu ô, nên ca nghỉ và dạy thay chỉ nhận qua mã và ghi chú.' },
  preferences: { label: 'Nguyện vọng giáo viên', tab: 'Nguyện vọng', help: 'Các cột: MÃ GV | GIỚI TÍNH | KM TỐI ĐA | KẾT THÚC TRƯỚC | KHÔNG NHẬN BUỔI' },
  refer: { label: 'Danh sách Refer', tab: 'Refer', help: 'Các cột: TRƯỜNG | MÃ GV. Tên trường viết đúng như cột TRƯỜNG của Danh Sách Trường.' },
}

export function DataPage() {
  const s = useStore()
  const liveWeeks = useLiveWeeks()
  const [url, setUrl] = useState('')
  const [kind, setKind] = useState<Kind>('week')
  const [tab, setTab] = useState(KINDS.week.tab)
  const [grid, setGrid] = useState<string[][] | null>(null)
  const [source, setSource] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [monday, setMonday] = useState('')

  const received = (g: string[][], from: string) => {
    setGrid(g)
    setSource(from)
    setError(null)
    if (kind === 'week') setMonday(detectMonday(g, Number(liveWeeks.at(-1)!.startDate.slice(0, 4))) ?? addDays(liveWeeks.at(-1)!.startDate, 7))
  }
  const load = async () => {
    const id = sheetIdFromUrl(url)
    if (!id) { setError('Link Google Sheet không hợp lệ.'); return }
    setLoading(true)
    setError(null)
    try { received(await fetchSheetTab(id, tab), `Google Sheet · ${tab}`) } catch (e) { setGrid(null); setError(e instanceof Error ? e.message : 'Lỗi không rõ') } finally { setLoading(false) }
  }

  const week = grid && kind === 'week' && monday ? parseWeekGrid(grid, monday) : null
  const prefs = grid && kind === 'preferences' ? parsePreferencesGrid(grid) : null
  const refer = grid && kind === 'refer' ? parseReferGrid(grid) : null
  const knownT = new Set(s.teachers.map((t) => t.id))
  const empty = (week && !week.lessons.length) || (prefs && !prefs.length) || (refer && !refer.length)
  const overwrites = week && liveWeeks.some((w) => w.id === monday)

  const apply = () => {
    if (week) {
      if (overwrites && !window.confirm(`Tuần ${monday} đã có lịch. Thay thế toàn bộ bằng dữ liệu vừa đọc?`)) return
      const r = s.applySheetWeek(monday, `Từ Sheet ${tab}`, week.teachers, week.lessons)
      toast(`Đã nạp ${week.lessons.length} ca. Mới: ${r.newTeachers} GV, ${r.newSchools} trường`)
    } else if (prefs) {
      toast(`Đã cập nhật nguyện vọng ${s.applyPreferences(prefs)} giáo viên`)
    } else if (refer) {
      const r = s.applyRefer(refer)
      toast(`Đã nạp ${r.applied} dòng Refer${r.unknown.length ? `, ${r.unknown.length} tên trường không khớp` : ''}`)
    }
    setGrid(null)
  }

  const active = s.teachers.filter((t) => t.active)
  const gaps = [
    { label: 'Trường có địa chỉ cụ thể', done: s.schools.filter((x) => x.address).length, total: s.schools.length },
    { label: 'Trường đã xác nhận danh sách Refer', done: s.schools.filter((x) => x.referSource === 'confirmed').length, total: s.schools.length },
    { label: 'Giáo viên đã khai giới tính', done: active.filter((t) => t.gender).length, total: active.length },
    { label: 'Giáo viên có khu vực mong muốn', done: active.filter((t) => t.areas.length).length, total: active.length },
    { label: 'Giáo viên có địa chỉ nhà', done: active.filter((t) => t.address).length, total: active.length },
    { label: 'Giáo viên đã khai nguyện vọng về giờ dạy', done: active.filter((t) => t.preferences.length).length, total: active.length },
  ]

  return (
    <div className="mx-auto max-w-[1000px] space-y-6">
      <PageHeader title="Nguồn dữ liệu" subtitle="Nạp dữ liệu đầu vào từ Google Sheet. Giai đoạn frontend chỉ đọc từ Sheet, chưa ghi ngược lại." />
      <Card title={<span className="inline-flex items-center gap-1.5"><Link2 size={14} />Kết nối Google Sheet</span>} actions={<Badge tone="amber">Chỉ đọc</Badge>}>
        <div className="space-y-4 p-5">
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Link Google Sheet (chia sẻ "Bất kỳ ai có liên kết đều xem được")</span>
            <input className="w-full" placeholder="https://docs.google.com/spreadsheets/d/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Loại dữ liệu</span>
              <select value={kind} onChange={(e) => { const k = e.target.value as Kind; setKind(k); setTab(KINDS[k].tab); setGrid(null) }}>
                {(Object.keys(KINDS) as Kind[]).map((k) => <option key={k} value={k}>{KINDS[k].label}</option>)}
              </select>
            </label>
            <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Tên tab</span>
              <input className="w-48" value={tab} onChange={(e) => setTab(e.target.value)} />
            </label>
            <Button variant="primary" disabled={loading || !url} onClick={load}>{loading ? 'Đang đọc…' : 'Đọc dữ liệu'}</Button>
            <span className="text-slate-400">hoặc</span>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-100">
              <Upload size={14} />Tải file CSV
              <input data-testid="csv-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) received(parseCsv(await f.text()), f.name); e.target.value = '' }} />
            </label>
          </div>
          <p className="text-xs text-slate-500">{KINDS[kind].help}</p>
          {error && <div className="rounded-md bg-red-50 px-3 py-2 text-red-800">{error}</div>}
          {grid && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="mb-1 font-medium">Xem trước: {source}</div>
              {week && <div className="space-y-2">
                <label className="flex items-center gap-2">Tuần bắt đầu từ <input type="date" value={monday} onChange={(e) => setMonday(e.target.value)} /></label>
                <div data-testid="preview">{week.teachers.length} giáo viên ({week.teachers.filter((t) => !knownT.has(t.id)).length} mới), {week.lessons.length} ca.</div>
                {overwrites && <div className="text-amber-800">Tuần này đã có lịch, nạp sẽ thay thế toàn bộ lịch của tuần.</div>}
              </div>}
              {prefs && <div>{prefs.length} giáo viên có dữ liệu nguyện vọng.</div>}
              {refer && <div>{refer.length} dòng Refer.</div>}
              {empty ? <div className="mt-2 text-red-800">Không đọc được dòng nào. Kiểm tra tab có đúng bố cục ở trên không.</div> : <Button variant="primary" className="mt-2" onClick={apply}>Áp dụng vào hệ thống</Button>}
            </div>
          )}
        </div>
      </Card>
      <Card title="Mức độ đầy đủ của dữ liệu">
        <ul className="divide-y divide-slate-100">
          {gaps.map((g) => (
            <li key={g.label} className="flex items-center justify-between px-5 py-3">
              <span className="inline-flex items-center gap-2">{g.done === g.total ? <CheckCircle2 size={14} className="text-emerald-600" /> : <CircleAlert size={14} className="text-amber-600" />}{g.label}</span>
              <span className="tnum text-slate-600">{g.done}/{g.total}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
