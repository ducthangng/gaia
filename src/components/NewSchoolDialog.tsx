import { X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { create } from 'zustand'
import { schoolDraftErrors, schoolFullName, type SchoolDraft } from '../domain/create-records'
import { decodePlusCode } from '../domain/geo'
import { useStore } from '../store'
import { Button, toast } from './ui'

const useRequest = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }))
export const openNewSchoolDialog = () => useRequest.getState().set(true)

const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block"><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>{children}</label>
)

export function NewSchoolDialog() {
  const { open, set } = useRequest()
  return open ? <Dialog close={() => set(false)} /> : null
}

function Dialog({ close }: { close: () => void }) {
  const schools = useStore((s) => s.schools)
  const offices = useStore((s) => s.offices)
  const addSchool = useStore((s) => s.addSchool)
  const setOfficeKm = useStore((s) => s.setOfficeKm)
  const navigate = useNavigate()
  const { search } = useLocation()
  const [d, setD] = useState<SchoolDraft>({ name: '', region: '', address: '', consultant: '' })
  const [km, setKm] = useState<Record<string, string>>({})
  const patch = (p: Partial<SchoolDraft>) => setD((x) => ({ ...x, ...p }))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  const kmBad = Object.values(km).some((v) => v.trim() && !(Number(v) >= 0))
  const errors = [...schoolDraftErrors(d, schools), ...(kmBad ? ['Số km phải là số'] : [])]
  const regions = [...new Set(schools.map((s) => s.region?.trim()).filter(Boolean))] as string[]
  const hasCode = !!decodePlusCode(d.address)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Thêm trường" data-testid="new-school-dialog" className="flex max-h-[90vh] w-[560px] max-w-full flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold">Thêm trường</h2>
          <button aria-label="Đóng" className="text-slate-400 hover:text-slate-700" onClick={close}><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid grid-cols-[minmax(0,1fr)_170px] gap-3">
            <Field label="Tên trường"><input autoFocus aria-label="Tên trường" className="w-full" placeholder="TH Nguyễn Trãi" value={d.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
            <Field label="Khu vực">
              <input aria-label="Khu vực" className="w-full" list="school-regions" value={d.region} onChange={(e) => patch({ region: e.target.value })} />
              <datalist id="school-regions">{regions.map((r) => <option key={r} value={r} />)}</datalist>
            </Field>
          </div>
          <Field label="Địa chỉ (dán Plus Code nếu có để định vị chính xác)"><input aria-label="Địa chỉ trường" className="w-full" value={d.address} onChange={(e) => patch({ address: e.target.value })} /></Field>
          {d.address.trim() && <p className="text-xs text-slate-600" data-testid="school-locate">{hasCode ? 'Nhận ra vị trí chính xác từ Plus Code.' : 'Địa chỉ chữ chưa định vị được chính xác. Có thể nhập toạ độ sau trong Bảng thông tin.'}</p>}
          <div className="flex flex-wrap gap-3">
            {offices.map((o) => (
              <Field key={o.id} label={`Km từ ${o.name}`}><input aria-label={`Km từ ${o.name}`} className="tnum w-28 text-right" inputMode="decimal" value={km[o.id] ?? ''} onChange={(e) => setKm((x) => ({ ...x, [o.id]: e.target.value }))} /></Field>
            ))}
            <div className="min-w-44 flex-1"><Field label="Phụ trách"><input aria-label="Phụ trách" className="w-full" value={d.consultant} onChange={(e) => patch({ consultant: e.target.value })} /></Field></div>
          </div>
          {d.name.trim() && d.region.trim() && <p className="text-slate-600">Tên hiển thị: <b data-testid="school-fullname">{schoolFullName(d)}</b></p>}
          {errors.length > 0 && (d.name.trim() || d.region.trim()) && <div className="rounded-md bg-red-50 px-3 py-2 text-red-800" data-testid="school-errors">{errors.join('. ')}.</div>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <Button onClick={close}>Huỷ</Button>
          <Button variant="primary" disabled={errors.length > 0} onClick={() => {
            const id = addSchool(d)
            for (const [office, v] of Object.entries(km)) if (v.trim()) setOfficeKm(office, id, Number(v))
            toast(`Đã thêm ${schoolFullName(d)}`)
            close()
            if (!search.includes('view=table')) navigate(`/schools/${id}`)
          }}>Thêm trường</Button>
        </footer>
      </div>
    </div>
  )
}
