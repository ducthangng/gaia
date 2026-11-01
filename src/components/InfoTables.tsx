import clsx from 'clsx'
import { Check, CircleAlert, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { missingSchoolFields, missingTeacherFields, parseCoordinate } from '../domain/data-quality'
import { isPrecise, wardOf } from '../domain/geo'
import { schoolLoad } from '../domain/issues'
import { AREA_OPTIONS, profileErrors, profileFrom, recordedHomeKmCount, type ProfileDraft } from '../domain/teacher-profile'
import type { GeoPoint, School, Teacher } from '../domain/types'
import { useWeekContext } from '../hooks'
import { useStore } from '../store'
import { EntityAnchor } from './EntityLink'
import { TextCell, ViewSwitch } from './InlineCell'
import { openNewSchoolDialog } from './NewSchoolDialog'
import { openNewTeacherDialog } from './TeacherProfileDialog'
import { Badge, Button, toast } from './ui'

const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={clsx('sticky top-0 z-10 whitespace-nowrap border-b border-slate-200 bg-slate-100 px-3 py-3 text-left text-xs font-semibold text-slate-600', className)}>{children}</th>
)

const ANY = '__any__'

/** Lọc theo từng loại thông tin còn thiếu. Một thông tin ai cũng thiếu sẽ không làm mất tác dụng của bộ lọc. */
const passes = (missing: string[], filter: string) => !filter || (filter === ANY ? missing.length > 0 : missing.includes(filter))

function Toolbar({ title, q, setQ, filter, setFilter, fields, shown, total, missingOf, extra, action }: { action?: ReactNode; title: string; q: string; setQ: (v: string) => void; filter: string; setFilter: (v: string) => void; fields: string[]; shown: number; total: number; missingOf: string[][]; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ViewSwitch />
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      <input aria-label="Tìm trong bảng" className="w-60" placeholder="Tìm tên, mã, địa chỉ…" value={q} onChange={(e) => setQ(e.target.value)} />
      <label className="flex items-center gap-1.5">Lọc
        <select aria-label="Lọc theo thông tin thiếu" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">Tất cả</option>
          <option value={ANY}>Còn thiếu bất kỳ ({missingOf.filter((m) => m.length).length})</option>
          {fields.map((f) => <option key={f} value={f}>Thiếu {f} ({missingOf.filter((m) => m.includes(f)).length})</option>)}
        </select>
      </label>
      {extra}
      {action}
      <span className="ml-auto flex items-center gap-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-3 w-4 rounded-sm bg-amber-100" />Còn thiếu</span>
        <span data-testid="table-count">{shown}/{total} dòng · Bấm vào ô để sửa, lưu tự động</span>
      </span>
    </div>
  )
}

const MissingCell = ({ missing }: { missing: string[] }) => missing.length
  ? <span title={missing.join(', ')} className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-amber-800"><CircleAlert size={12} />Thiếu {missing.length}<span className="font-normal text-amber-700">: {missing.join(', ')}</span></span>
  : <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><Check size={12} />Đủ</span>

const GEO_TEXT: Record<GeoPoint['source'], { label: string; tone: 'green' | 'amber' }> = {
  pluscode: { label: 'Plus Code', tone: 'green' },
  street: { label: 'Theo tên đường', tone: 'green' },
  manual: { label: 'Nhập tay', tone: 'green' },
  ward: { label: 'Theo phường/xã', tone: 'green' },
  region: { label: 'Gần đúng', tone: 'amber' },
}

export function TeachersTable() {
  const ctx = useWeekContext()
  const save = useStore((s) => s.saveTeacherProfile)
  const deleteTeacher = useStore((s) => s.deleteNewTeacher)
  const distances = useStore((s) => s.distances)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const active = ctx.world.teachers.filter((t) => t.active)
  const rows = active
    .filter((t) => `${t.id} ${t.name} ${t.address ?? ''} ${t.district ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((t) => passes(missingTeacherFields(t), filter))
    .sort((a, b) => a.id.localeCompare(b.id))
  const update = (t: Teacher, patch: Partial<ProfileDraft>) => {
    const addressChanged = patch.address !== undefined && patch.address !== (t.address ?? '')
    const dropped = addressChanged ? recordedHomeKmCount(distances, t.id) : 0
    save(t.id, { ...profileFrom(t), ...patch })
    if (addressChanged) toast(`Đã lưu địa chỉ ${t.id}${dropped ? `, bỏ ${dropped} số km từ nhà cũ và tính lại` : ''}`)
  }
  const rule = (field: keyof ProfileDraft, t: Teacher) => (v: string) => profileErrors({ ...profileFrom(t), [field]: v })[0] ?? null
  return (
    <div className="flex h-full flex-col gap-4">
      <Toolbar title="Thông tin giáo viên" q={q} setQ={setQ} filter={filter} setFilter={setFilter} fields={['SĐT', 'Địa chỉ', 'Vị trí nhà', 'Năng lực', 'Khu vực mong muốn', 'Giới tính']} shown={rows.length} total={active.length} missingOf={active.map(missingTeacherFields)} action={<Button onClick={openNewTeacherDialog}><Plus size={14} />Thêm giáo viên</Button>} />
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-separate border-spacing-0" data-testid="teacher-table">
          <thead><tr>
            <Th className="left-0 z-20">Mã</Th><Th className="w-52">Họ tên</Th><Th className="w-32">SĐT</Th><Th className="w-80">Địa chỉ nhà</Th><Th>Vị trí trên bản đồ</Th><Th className="w-28">Quận/huyện</Th><Th>Văn phòng</Th><Th>Năng lực</Th><Th>Khu vực mong muốn</Th><Th>Giới tính</Th><Th className="w-16">Km tối đa</Th><Th>Online</Th><Th>Tình trạng</Th>
          </tr></thead>
          <tbody>
            {rows.map((t) => {
              const missing = missingTeacherFields(t)
              return (
                <tr key={t.id} className="align-top hover:bg-slate-50" data-testid={`row-${t.id}`}>
                  <td className="tnum sticky left-0 z-[1] border-b border-r border-slate-100 bg-white px-3 py-2.5"><EntityAnchor kind="teacher" id={t.id} className="font-medium">{t.id}</EntityAnchor></td>
                  <td className="border-b border-slate-100 px-1 py-1.5"><TextCell className="min-w-[210px]" label={`Họ tên ${t.id}`} value={t.name} required validate={rule('name', t)} onSave={(v) => update(t, { name: v })} /></td>
                  <td className="border-b border-slate-100 px-1 py-1.5"><TextCell className="min-w-[120px]" label={`SĐT ${t.id}`} inputMode="tel" value={t.phone ?? ''} required validate={rule('phone', t)} onSave={(v) => update(t, { phone: v })} /></td>
                  <td className="border-b border-slate-100 px-1 py-1.5"><TextCell className="min-w-[340px]" label={`Địa chỉ ${t.id}`} value={t.address ?? ''} required placeholder="Địa chỉ hoặc Plus Code" onSave={(v) => update(t, { address: v })} /></td>
                  <td className="border-b border-slate-100 px-3 py-2.5">{t.homeGeo ? <Badge tone="green" title={t.homeArea}>{GEO_TEXT[t.homeGeo.source].label}{t.homeArea ? `: ${t.homeArea}` : ''}</Badge> : <Badge tone="amber">Chưa định vị được</Badge>}</td>
                  <td className="border-b border-slate-100 px-1 py-1.5"><TextCell className="min-w-[110px]" label={`Quận/huyện ${t.id}`} value={t.district ?? ''} onSave={(v) => update(t, { district: v })} /></td>
                  <td className="border-b border-slate-100 px-1 py-1.5"><select aria-label={`Văn phòng ${t.id}`} className="!border-transparent !bg-transparent hover:!border-slate-300" value={t.officeId} onChange={(e) => update(t, { officeId: e.target.value })}>{ctx.world.offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></td>
                  <td className={clsx('border-b border-slate-100 px-1 py-1.5', !t.track && 'bg-amber-100')}><select aria-label={`Năng lực ${t.id}`} className="!border-transparent !bg-transparent hover:!border-slate-300" value={t.track ?? ''} onChange={(e) => update(t, { track: e.target.value })}><option value="">Chưa rõ</option><option>TÍCH HỢP</option><option>STEM/CDS/AI</option></select></td>
                  <td className={clsx('border-b border-slate-100 px-1 py-1', !t.areas.length && 'bg-amber-100')}>
                    <div className="flex gap-0.5">{AREA_OPTIONS.map((a) => {
                      const on = t.areas.includes(a)
                      return <button key={a} aria-pressed={on} aria-label={`${t.id} ${a}`} title={a} onClick={() => update(t, { areas: on ? t.areas.filter((x) => x !== a) : [...t.areas, a] })} className={clsx('whitespace-nowrap rounded border px-1 py-0.5 text-[10px] font-medium', on ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-100')}>{a.split(' ').map((w) => w[0]).join('')}</button>
                    })}</div>
                  </td>
                  <td className={clsx('border-b border-slate-100 px-1 py-1.5', !t.gender && 'bg-amber-100')}><select aria-label={`Giới tính ${t.id}`} className="!border-transparent !bg-transparent hover:!border-slate-300" value={t.gender ?? ''} onChange={(e) => update(t, { gender: e.target.value as ProfileDraft['gender'] })}><option value="">Chưa khai</option><option value="F">Nữ</option><option value="M">Nam</option></select></td>
                  <td className="border-b border-slate-100 px-1 py-1.5"><TextCell className="min-w-[64px]" label={`Km tối đa ${t.id}`} align="right" inputMode="numeric" value={t.maxKm === null ? '' : String(t.maxKm)} validate={rule('maxKm', t)} onSave={(v) => update(t, { maxKm: v })} /></td>
                  <td className="border-b border-slate-100 px-3 py-2.5 text-center"><input type="checkbox" aria-label={`Chỉ làm online ${t.id}`} checked={t.onlineOnly} onChange={(e) => update(t, { onlineOnly: e.target.checked })} /></td>
                  <td className="border-b border-slate-100 px-3 py-2.5"><div className="flex items-center gap-2"><MissingCell missing={missing} />{t.isNew && <button aria-label={`Xoá ${t.id}`} title="Xoá giáo viên vừa thêm (chỉ khi chưa có ca nào)" className="text-slate-400 hover:text-red-600" onClick={() => toast(deleteTeacher(t.id) ? `Đã xoá ${t.id}` : `${t.id} đã có ca dạy nên không xoá được`)}><Trash2 size={13} /></button>}</div></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-slate-500">Khu vực: {AREA_OPTIONS.map((a) => `${a.split(' ').map((w) => w[0]).join('')} = ${a}`).join(' · ')}. Vị trí nhà được đọc từ địa chỉ ngay trên máy, không gửi đi đâu.</p>
      </div>
    </div>
  )
}

export function SchoolsTable() {
  const ctx = useWeekContext()
  const distances = useStore((s) => s.distances)
  const updateSchool = useStore((s) => s.updateSchool)
  const saveAddress = useStore((s) => s.saveSchoolAddress)
  const setOfficeKm = useStore((s) => s.setOfficeKm)
  const deleteSchool = useStore((s) => s.deleteNewSchool)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('')
  const [onlyActive, setOnlyActive] = useState(true)
  const load = useMemo(() => schoolLoad(ctx.week.lessons), [ctx.week.lessons])
  // Trường vừa thêm chưa có ca nhưng vẫn phải thấy ngay để điền tiếp thông tin.
  const scope = ctx.world.schools.filter((s) => !onlyActive || s.isNew || (load.get(s.id) ?? 0) > 0)
  const rows = scope
    .filter((s) => `${s.fullName} ${s.address ?? ''} ${s.region ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    .filter((s) => passes(missingSchoolFields(s, distances), filter))
    .sort((a, b) => (load.get(b.id) ?? 0) - (load.get(a.id) ?? 0) || a.fullName.localeCompare(b.fullName, 'vi'))
  const kmRule = (v: string) => (v && !(Number(v) >= 0) ? 'Số km phải là số' : null)
  const kmCell = (s: School, office: string) => {
    const val = distances.office[`${office}|${s.id}`]
    return <TextCell className="min-w-[80px]" label={`Km từ ${office} ${s.fullName}`} align="right" inputMode="decimal" value={val === undefined ? '' : String(val)} validate={kmRule} onSave={(v) => setOfficeKm(office, s.id, v === '' ? null : Number(v))} />
  }
  return (
    <div className="flex h-full flex-col gap-4">
      <Toolbar title="Thông tin trường" q={q} setQ={setQ} filter={filter} setFilter={setFilter} fields={['Địa chỉ', 'Toạ độ chính xác', 'Km từ văn phòng']} shown={rows.length} total={scope.length} missingOf={scope.map((s) => missingSchoolFields(s, distances))} action={<Button onClick={openNewSchoolDialog}><Plus size={14} />Thêm trường</Button>}
        extra={<label className="flex items-center gap-1.5"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />Chỉ trường có lịch tuần này</label>} />
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full border-separate border-spacing-0" data-testid="school-table">
          <thead><tr>
            <Th className="left-0 z-20 w-64">Trường</Th><Th className="w-16 text-right">Số ca</Th><Th className="w-28">Khu vực</Th><Th className="w-96">Địa chỉ</Th><Th>Phường/xã</Th><Th className="w-48">Toạ độ / Plus Code</Th><Th>Vị trí</Th>
            {ctx.world.offices.map((o) => <Th key={o.id} className="w-24 text-right">Km từ {o.name}</Th>)}
            <Th className="w-44">Phụ trách</Th><Th>Refer</Th><Th>Tình trạng</Th>
          </tr></thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="align-top hover:bg-slate-50" data-testid={`row-${s.id}`}>
                <td className="sticky left-0 z-[1] min-w-[230px] border-b border-r border-slate-100 bg-white px-3 py-2.5"><EntityAnchor kind="school" id={s.id} className="font-medium">{s.fullName}</EntityAnchor></td>
                <td className="tnum border-b border-slate-100 px-3 py-2.5 text-right text-slate-600">{load.get(s.id) ?? 0}</td>
                <td className="border-b border-slate-100 px-1 py-1.5"><TextCell className="min-w-[100px]" label={`Khu vực ${s.fullName}`} value={s.region ?? ''} onSave={(v) => updateSchool(s.id, { region: v || null })} /></td>
                <td className="border-b border-slate-100 px-1 py-1.5"><TextCell className="min-w-[340px]" label={`Địa chỉ ${s.fullName}`} value={s.address ?? ''} required placeholder="Địa chỉ hoặc Plus Code" onSave={(v) => saveAddress(s.id, v)} /></td>
                <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2.5 text-slate-600">{wardOf(s)}</td>
                <td className="border-b border-slate-100 px-1 py-1.5"><TextCell className="min-w-[200px]" label={`Toạ độ ${s.fullName}`} value={isPrecise(s.geo) ? `${s.geo.lat}, ${s.geo.lng}` : ''} required placeholder="Dán toạ độ hoặc Plus Code" validate={(v) => (v && !parseCoordinate(v) ? 'Chưa đúng, ví dụ 10.50, 107.17' : null)} onSave={(v) => { const p = parseCoordinate(v); if (p) { updateSchool(s.id, { geo: { ...p, source: 'manual' } }); toast('Đã lưu toạ độ') } }} /></td>
                <td className="border-b border-slate-100 px-3 py-2.5">{s.geo ? <Badge tone={GEO_TEXT[s.geo.source].tone}>{GEO_TEXT[s.geo.source].label}</Badge> : <Badge tone="amber">Chưa có</Badge>}</td>
                {ctx.world.offices.map((o) => <td key={o.id} className="border-b border-slate-100 px-1 py-1.5">{kmCell(s, o.id)}</td>)}
                <td className="border-b border-slate-100 px-1 py-1.5"><TextCell className="min-w-[190px]" label={`Phụ trách ${s.fullName}`} value={s.consultant ?? ''} onSave={(v) => updateSchool(s.id, { consultant: v || null })} /></td>
                <td className="whitespace-nowrap border-b border-slate-100 px-3 py-2.5 text-xs">{s.referredTeacherIds.length} GV {s.referSource === 'derived' ? <Badge tone="amber" title="Suy từ lịch sử dạy, cần Gaia xác nhận">tạm</Badge> : <Badge tone="green">đã xác nhận</Badge>}</td>
                <td className="border-b border-slate-100 px-3 py-2.5"><div className="flex items-center gap-2"><MissingCell missing={missingSchoolFields(s, distances)} />{s.isNew && <button aria-label={`Xoá ${s.fullName}`} title="Xoá trường vừa thêm (chỉ khi chưa có ca nào)" className="text-slate-400 hover:text-red-600" onClick={() => toast(deleteSchool(s.id) ? `Đã xoá ${s.fullName}` : 'Trường đã có ca nên không xoá được')}><Trash2 size={13} /></button>}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-3 py-2 text-xs text-slate-500">Mỗi trường chỉ cần có km từ một văn phòng là đủ; ô km để trống vẫn được ước tính khi tính chi phí. Toạ độ lấy từ Google Maps: bấm chuột phải vào điểm trên bản đồ để sao chép.</p>
      </div>
    </div>
  )
}
