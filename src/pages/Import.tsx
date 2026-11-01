import clsx from 'clsx'
import { ImagePlus, Loader2, Plus, ScanLine, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Card, PageHeader, toast } from '../components/ui'
import { parseSchedule, type OcrRow } from '../domain/ocr-parse'
import { DAY_LABELS, dayLabel, weekDates } from '../domain/time'
import type { Lesson } from '../domain/types'
import { recognizeImage } from '../services/ocr'
import { useActiveWeek, useStore } from '../store'

const SUBJECTS = ['STEM', 'STEM-AI', 'STEM AI - ROBOTICS', 'CDS', 'AI', 'KNS']
const LOW_CONFIDENCE = 70

type Status = 'new' | 'changed' | 'same' | 'incomplete'
const STATUS: Record<Status, { label: string; tone: 'green' | 'amber' | 'slate' | 'red' }> = {
  new: { label: 'Ca mới', tone: 'green' },
  changed: { label: 'Đổi giờ/môn', tone: 'amber' },
  same: { label: 'Không đổi', tone: 'slate' },
  incomplete: { label: 'Thiếu thông tin', tone: 'red' },
}

export function ImportPage() {
  const schools = useStore((s) => s.schools)
  const weeks = useStore((s) => s.weeks)
  const applyOcr = useStore((s) => s.applyOcr)
  const active = useActiveWeek()
  const planning = weeks.filter((w) => w.status === 'planning')
  const [schoolId, setSchoolId] = useState('')
  const [weekId, setWeekId] = useState(planning.some((w) => w.id === active.id) ? active.id : (planning.at(-1)?.id ?? ''))
  const [image, setImage] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ ratio: number; status: string } | null>(null)
  const [rows, setRows] = useState<OcrRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [removeIds, setRemoveIds] = useState<string[]>([])
  const [done, setDone] = useState<string | null>(null)

  const week = weeks.find((w) => w.id === weekId)
  const dates = week ? weekDates(week.startDate) : []
  const existing = useMemo(() => week?.lessons.filter((l) => l.schoolId === schoolId && l.className && l.status !== 'replaced') ?? [], [week, schoolId])

  const match = (r: OcrRow): Lesson | undefined => existing.find((l) => l.date === dates[r.day ?? -1] && l.className === r.className && (l.subject === r.subject || !r.subject || !l.subject))
  const statusOf = (r: OcrRow): Status => {
    if (r.day === null || !r.className || !r.start || !r.end) return 'incomplete'
    const m = match(r)
    if (!m) return r.subject ? 'new' : 'incomplete'
    return m.start === r.start && m.end === r.end && (!r.subject || m.subject === r.subject) ? 'same' : 'changed'
  }
  const matchedIds = new Set((rows ?? []).map(match).filter(Boolean).map((l) => l!.id))
  const missing = rows ? existing.filter((l) => !matchedIds.has(l.id)) : []
  const counts = (rows ?? []).reduce<Record<Status, number>>((acc, r) => { acc[statusOf(r)]++; return acc }, { new: 0, changed: 0, same: 0, incomplete: 0 })

  const run = async (source: File | string) => {
    setError(null)
    setRows(null)
    setDone(null)
    setRemoveIds([])
    setImage(typeof source === 'string' ? source : URL.createObjectURL(source))
    setProgress({ ratio: 0, status: 'Đang khởi động' })
    try {
      const words = await recognizeImage(source, (ratio, status) => setProgress({ ratio, status }))
      const parsed = parseSchedule(words)
      setRows(parsed)
      if (!parsed.length) setError('Không nhận ra ca dạy nào trong ảnh. Có thể nhập tay bên dưới hoặc thử ảnh rõ, thẳng hơn.')
    } catch (e) {
      setRows([])
      setError(`Không chạy được OCR (${e instanceof Error ? e.message : 'lỗi không rõ'}). Lần đầu cần có mạng để tải mô hình tiếng Việt. Vẫn có thể nhập tay bên dưới.`)
    } finally {
      setProgress(null)
    }
  }
  const patch = (id: string, p: Partial<OcrRow>) => setRows((rs) => rs!.map((r) => (r.id === id ? { ...r, ...p } : r)))
  const canApply = !!schoolId && !!week && !!rows?.length && counts.incomplete === 0 && (counts.new + counts.changed + removeIds.length > 0)

  return (
    <div className="mx-auto max-w-[1300px] space-y-4">
      <PageHeader title="Nhập ảnh lịch học" subtitle="Tải ảnh chụp hoặc scan lịch của trường, kiểm tra dữ liệu đọc được, rồi duyệt để cập nhật vào lịch tuần. Không có gì được ghi vào lịch trước khi duyệt." />
      <Card>
        <div className="flex flex-wrap items-end gap-3 p-4">
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Trường</span>
            <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)} className="w-80">
              <option value="">Chọn trường…</option>
              {schools.map((s) => <option key={s.id} value={s.id}>{s.fullName}{s.address ? ` · ${s.address}` : ''}</option>)}
            </select>
          </label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">Áp dụng cho tuần đang lập</span>
            <select value={weekId} onChange={(e) => setWeekId(e.target.value)}>
              {!planning.length && <option value="">Chưa có tuần đang lập</option>}
              {planning.map((w) => <option key={w.id} value={w.id}>{w.startDate} → {w.endDate}</option>)}
            </select>
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-emerald-700 px-2.5 py-1.5 font-medium text-white hover:bg-emerald-800">
            <ImagePlus size={14} />Tải ảnh lịch
            <input data-testid="ocr-file" type="file" accept="image/*" className="sr-only" onChange={(e) => e.target.files?.[0] && run(e.target.files[0])} />
          </label>
          <Button onClick={() => run('/sample-schedule.png')}><ScanLine size={14} />Thử với ảnh mẫu</Button>
          <Button variant="ghost" onClick={() => { setError(null); setRows([{ id: `manual-${Date.now()}`, day: 0, start: null, end: null, className: null, subject: null, confidence: 100, raw: 'Nhập tay' }]) }}>Nhập tay</Button>
        </div>
        {progress && (
          <div className="flex items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-slate-600">
            <Loader2 size={14} className="animate-spin" />
            {progress.status} {Math.round(progress.ratio * 100)}%
          </div>
        )}
        {error && <div className="border-t border-red-100 bg-red-50 px-4 py-2.5 text-red-800">{error}</div>}
        {done && <div className="border-t border-emerald-100 bg-emerald-50 px-4 py-2.5 text-emerald-900">{done} <Link className="underline" to={`/schools/${schoolId}`}>Xem lịch trường</Link></div>}
      </Card>

      {rows && (
        <div className={clsx('grid gap-4', image && 'xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]')}>
          {image && (
            <Card title="Ảnh gốc"><div className="max-h-[640px] overflow-auto p-2"><img src={image} alt="Ảnh lịch đã tải lên" className="w-full" /></div></Card>
          )}
          <Card title={`Xem trước dữ liệu (${rows.length} ca)`} actions={<div className="flex gap-1">
            {(Object.keys(STATUS) as Status[]).filter((k) => counts[k]).map((k) => <Badge key={k} tone={STATUS[k].tone}>{STATUS[k].label}: {counts[k]}</Badge>)}
          </div>}>
            <div className="overflow-x-auto">
              <table className="w-full" data-testid="ocr-rows">
                <thead className="border-b border-slate-200 text-left text-xs text-slate-500"><tr>
                  <th className="px-3 py-2 font-medium">Thứ</th><th className="px-1 font-medium">Bắt đầu</th><th className="px-1 font-medium">Kết thúc</th><th className="px-1 font-medium">Lớp</th><th className="px-1 font-medium">Môn</th><th className="px-1 font-medium">Độ tin cậy</th><th className="px-1 font-medium">Đối chiếu</th><th />
                </tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => {
                    const st = statusOf(r)
                    return (
                      <tr key={r.id} className={clsx(r.confidence < LOW_CONFIDENCE && 'bg-amber-50/60')} title={`OCR đọc: ${r.raw}`}>
                        <td className="px-3 py-1"><select aria-label="Thứ" value={r.day ?? ''} onChange={(e) => patch(r.id, { day: e.target.value === '' ? null : Number(e.target.value) })}>
                          <option value="">?</option>{DAY_LABELS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                        </select></td>
                        <td className="px-1"><input aria-label="Bắt đầu" type="time" value={r.start ?? ''} onChange={(e) => patch(r.id, { start: e.target.value || null })} /></td>
                        <td className="px-1"><input aria-label="Kết thúc" type="time" value={r.end ?? ''} onChange={(e) => patch(r.id, { end: e.target.value || null })} /></td>
                        <td className="px-1"><input aria-label="Lớp" className="w-16" value={r.className ?? ''} onChange={(e) => patch(r.id, { className: e.target.value.trim() || null })} /></td>
                        <td className="px-1"><select aria-label="Môn" value={r.subject ?? ''} onChange={(e) => patch(r.id, { subject: e.target.value || null })}>
                          <option value="">?</option>{SUBJECTS.map((s) => <option key={s}>{s}</option>)}
                        </select></td>
                        <td className="tnum px-1 text-xs">{r.confidence < LOW_CONFIDENCE ? <span className="font-medium text-amber-700">{r.confidence}%</span> : <span className="text-slate-500">{r.confidence}%</span>}</td>
                        <td className="px-1"><Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge></td>
                        <td className="px-2"><button aria-label="Xoá dòng" className="text-slate-400 hover:text-red-600" onClick={() => setRows((rs) => rs!.filter((x) => x.id !== r.id))}><Trash2 size={13} /></button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 p-2">
              <Button variant="ghost" onClick={() => setRows((rs) => [...rs!, { id: `manual-${Date.now()}`, day: rs!.at(-1)?.day ?? 0, start: null, end: null, className: null, subject: null, confidence: 100, raw: 'Nhập tay' }])}><Plus size={13} />Thêm dòng</Button>
            </div>
            {schoolId && missing.length > 0 && (
              <div className="border-t border-slate-100 px-4 py-3">
                <div className="mb-1.5 font-medium">{missing.length} ca đang có trong lịch nhưng không thấy trong ảnh</div>
                <p className="mb-2 text-xs text-slate-500">Chỉ tick ca thực sự bị bỏ. Ảnh có thể chỉ chụp một phần lịch nên mặc định sẽ giữ lại.</p>
                <ul className="grid max-h-40 gap-1 overflow-y-auto md:grid-cols-2">
                  {missing.map((l) => (
                    <li key={l.id}><label className="flex items-center gap-1.5"><input type="checkbox" checked={removeIds.includes(l.id)} onChange={(e) => setRemoveIds((x) => (e.target.checked ? [...x, l.id] : x.filter((y) => y !== l.id)))} />{dayLabel(l.date)} · {l.start ?? `tiết ${l.period}`} · {l.className} · {l.subject}</label></li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <span className="text-xs text-slate-600">
                {!schoolId ? 'Chọn trường để đối chiếu với lịch hiện tại.' : !week ? 'Cần có một tuần đang lập.' : counts.incomplete ? `Còn ${counts.incomplete} dòng thiếu thông tin.` : `Ca mới sẽ được đưa vào danh sách cần giáo viên; ca đang có GV giữ nguyên GV.`}
              </span>
              <Button variant="primary" disabled={!canApply} onClick={() => {
                const r = applyOcr(weekId, schoolId, rows, removeIds)
                const msg = `Đã cập nhật: thêm ${r.added}, sửa ${r.updated}, bỏ ${r.removed} ca.`
                setDone(msg)
                toast(msg)
                setRows(null)
                setImage(null)
              }}>Duyệt và cập nhật lịch</Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
