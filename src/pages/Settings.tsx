import { RotateCcw } from 'lucide-react'
import { openResetDialog } from '../components/ResetDataDialog'
import { Badge, Button, Card, PageHeader, toast } from '../components/ui'
import { DEFAULT_SETTINGS, type Settings, type Tier } from '../domain/types'
import { useStore } from '../store'

const WEIGHTS: { key: keyof Settings['weights']; label: string; hint: string }[] = [
  { key: 'distance', label: 'Khoảng cách', hint: 'Từ vị trí liền trước, hoặc Nhà/Văn phòng' },
  { key: 'refer', label: 'Giáo viên Refer', hint: 'Thuộc danh sách của trường' },
  { key: 'preference', label: 'Nguyện vọng', hint: 'Không vi phạm nguyện vọng đã khai' },
  { key: 'availability', label: 'Rảnh / bận', hint: 'GV bận luôn xếp sau GV rảnh' },
  { key: 'subject', label: 'Năng lực môn', hint: 'Bổ sung ngoài tài liệu: đã dạy môn này hoặc đúng nhóm năng lực' },
]

function Num({ label, value, onChange, unit }: { label: string; value: number; onChange: (v: number) => void; unit?: string }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-slate-700">{label}</span>
      <span className="flex items-center gap-1.5 text-slate-500">
        <input type="number" min={0} className="tnum w-24 text-right" value={value} onChange={(e) => onChange(Number(e.target.value))} />
        {unit}
      </span>
    </label>
  )
}

function TierTable({ title, tiers, onChange }: { title: string; tiers: Tier[]; onChange: (t: Tier[]) => void }) {
  return (
    <div>
      <div className="mb-1.5 font-medium">{title}</div>
      <table className="w-full">
        <tbody className="tnum divide-y divide-slate-100">
          {tiers.map((t, i) => (
            <tr key={i}>
              <td className="py-1 text-slate-600">{i === 0 ? 'Dưới' : t.below === null ? `Từ ${tiers[i - 1].below} km trở lên` : `${tiers[i - 1].below} km đến dưới`}</td>
              <td className="py-1">{t.below !== null && <span className="flex items-center gap-1"><input aria-label="Mốc km" type="number" className="w-16 text-right" value={t.below} onChange={(e) => onChange(tiers.map((x, n) => (n === i ? { ...x, below: Number(e.target.value) } : x)))} /> km</span>}</td>
              <td className="py-1 text-right"><input aria-label="Số tiền" type="number" step={10000} className="w-24 text-right" value={t.amount} onChange={(e) => onChange(tiers.map((x, n) => (n === i ? { ...x, amount: Number(e.target.value) } : x)))} /> đ</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SettingsPage() {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const totalWeight = Object.values(settings.weights).reduce((a, b) => a + b, 0)
  return (
    <div className="mx-auto max-w-[1000px] space-y-4">
      <PageHeader title="Cấu hình" subtitle="Thay đổi áp dụng ngay cho các tuần đang lập. Tuần đã lưu trữ giữ nguyên số liệu đã đóng băng." />
      <Card title="Cách tính chi phí di chuyển">
        <div className="space-y-4 p-4">
          <div className="grid gap-2 md:grid-cols-2">
            <label className="flex gap-2 rounded-md border border-slate-200 p-3">
              <input type="radio" name="policy" checked={settings.costPolicy === 'tier'} onChange={() => update({ costPolicy: 'tier' })} />
              <span><b>Theo bậc khoảng cách</b> <Badge tone="green">Workbook đang dùng</Badge><br /><span className="text-xs text-slate-500">Mỗi chặng một mức tiền. Khớp cột THÀNH TIỀN và CTP của Gaia.</span></span>
            </label>
            <label className="flex gap-2 rounded-md border border-slate-200 p-3">
              <input type="radio" name="policy" checked={settings.costPolicy === 'perKm'} onChange={() => update({ costPolicy: 'perKm' })} />
              <span><b>Km × đơn giá + phụ cấp</b> <Badge tone="amber">Theo tài liệu, số tạm</Badge><br /><span className="text-xs text-slate-500">Toàn lộ trình gồm chặng về nhà. Tài liệu chưa nêu đơn giá nên các số dưới đây cần Gaia xác nhận.</span></span>
            </label>
          </div>
          {settings.costPolicy === 'tier' ? (
            <div className="grid gap-6 md:grid-cols-2">
              <TierTable title="Xuất phát từ Nhà (N)" tiers={settings.tiersFromHome} onChange={(tiersFromHome) => update({ tiersFromHome })} />
              <TierTable title="Từ Văn phòng (V) hoặc địa điểm khác (K)" tiers={settings.tiersFromOther} onChange={(tiersFromOther) => update({ tiersFromOther })} />
            </div>
          ) : (
            <div className="max-w-md space-y-2">
              <Num label="Đơn giá" unit="đ/km" value={settings.ratePerKm} onChange={(ratePerKm) => update({ ratePerKm })} />
              <Num label="Cự ly đặc biệt từ" unit="km/ngày" value={settings.longRouteKm} onChange={(longRouteKm) => update({ longRouteKm })} />
              <Num label="Phụ cấp cự ly đặc biệt" unit="đ/ngày" value={settings.longRouteAllowance} onChange={(longRouteAllowance) => update({ longRouteAllowance })} />
            </div>
          )}
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Trọng số điểm phù hợp" actions={<span className="tnum text-xs text-slate-500">Tổng {totalWeight}, quy về thang 100</span>}>
          <div className="space-y-3 p-4">
            {WEIGHTS.map((w) => (
              <label key={w.key} className="block">
                <span className="flex justify-between"><span>{w.label}</span><span className="tnum font-medium">{settings.weights[w.key]}</span></span>
                <input type="range" min={0} max={50} className="w-full !border-0 !p-0" value={settings.weights[w.key]} onChange={(e) => update({ weights: { ...settings.weights, [w.key]: Number(e.target.value) } })} />
                <span className="text-xs text-slate-500">{w.hint}</span>
              </label>
            ))}
          </div>
        </Card>
        <Card title="Di chuyển giữa hai trường">
          <div className="space-y-2 p-4">
            <Num label="Tốc độ trung bình" unit="km/h" value={settings.travelSpeedKmh} onChange={(travelSpeedKmh) => update({ travelSpeedKmh: Math.max(1, travelSpeedKmh) })} />
            <Num label="Thời gian đệm" unit="phút" value={settings.travelBufferMin} onChange={(travelBufferMin) => update({ travelBufferMin })} />
            <p className="pt-1 text-xs text-slate-500">Hai ca khác trường cần cách nhau ít nhất: km ÷ tốc độ + thời gian đệm. Đây là giá trị tạm, cần Gaia xác nhận.</p>
          </div>
        </Card>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => { update(DEFAULT_SETTINGS); toast('Đã khôi phục cấu hình mặc định') }}><RotateCcw size={13} />Khôi phục cấu hình mặc định</Button>
<Button variant="danger" onClick={openResetDialog}>Về dữ liệu mới nhất</Button>
      </div>
    </div>
  )
}
