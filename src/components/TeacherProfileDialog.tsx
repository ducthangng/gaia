import clsx from 'clsx'
import { MapPin, X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import { seed } from '../data/load'
import { isPrecise } from '../domain/geo'
import { useLocation, useNavigate } from 'react-router-dom'
import { emptyProfile, nextTeacherId, teacherIdError } from '../domain/create-records'
import { AREA_OPTIONS, locateAddress, profileErrors, profileFrom, recordedHomeKmCount, type ProfileDraft } from '../domain/teacher-profile'
import { teacherLabel, type Gender } from '../domain/types'
import { useStore } from '../store'
import { Button, toast } from './ui'

const NEW = '__new__'
const useRequest = create<{ id: string | null; set: (id: string | null) => void }>((set) => ({ id: null, set: (id) => set({ id }) }))
export const openProfileDialog = (id: string) => useRequest.getState().set(id)
export const openNewTeacherDialog = () => useRequest.getState().set(NEW)

const Field = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
  <label className={clsx('block', className)}><span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>{children}</label>
)

export function TeacherProfileDialog() {
  const { id, set } = useRequest()
  const teacher = useStore((s) => s.teachers.find((t) => t.id === id))
  if (id === NEW) return <NewDialog close={() => set(null)} />
  if (!id || !teacher) return null
  return <Dialog key={id} id={id} close={() => set(null)} />
}

function Dialog({ id, close }: { id: string; close: () => void }) {
  const teacher = useStore((s) => s.teachers.find((t) => t.id === id))!
  const distances = useStore((s) => s.distances)
  const save = useStore((s) => s.saveTeacherProfile)
  const [d, setD] = useState<ProfileDraft>(() => profileFrom(teacher))
  const patch = (p: Partial<ProfileDraft>) => setD((x) => ({ ...x, ...p }))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  const errors = profileErrors(d)
  const addressChanged = d.address.trim() !== (teacher.address ?? '')
  const dropped = recordedHomeKmCount(distances, id)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Sửa thông tin giáo viên" data-testid="profile-dialog" className="flex max-h-[90vh] w-[620px] max-w-full flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold">Sửa thông tin {teacherLabel(teacher)}</h2>
          <button aria-label="Đóng" className="text-slate-400 hover:text-slate-700" onClick={close}><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <ProfileFields d={d} patch={patch} notice={addressChanged ? <AddressNotice address={d.address} dropped={dropped} /> : null} />
          {errors.length > 0 && <div className="rounded-md bg-red-50 px-3 py-2 text-red-800" data-testid="profile-errors">{errors.join('. ')}.</div>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <Button onClick={close}>Huỷ</Button>
          <Button variant="primary" disabled={errors.length > 0} onClick={() => { save(id, d); toast('Đã lưu thông tin giáo viên'); close() }}>Lưu</Button>
        </footer>
      </div>
    </div>
  )
}

function AddressNotice({ address, dropped }: { address: string; dropped: number }) {
  const located = locateAddress(address, seed.places ?? [])
  return (
    <div className="space-y-0.5 rounded-md bg-amber-50 px-3 py-2 text-amber-950" data-testid="address-notice">
      <div className="flex items-center gap-1.5"><MapPin size={13} />{located.geo ? (isPrecise(located.geo) ? 'Nhận ra vị trí chính xác từ Plus Code.' : `Nhận ra ${located.area}: đặt vị trí nhà ở tâm phường/xã.`) : 'Chưa nhận ra vị trí từ địa chỉ này, bản đồ sẽ không vẽ được chặng từ nhà.'}</div>
      {dropped > 0 && <div className="text-xs">{dropped} số km từ nhà đã ghi sẽ bị bỏ và tính lại ở các tuần đang lập. Tuần đã lưu trữ giữ nguyên.</div>}
    </div>
  )
}

function ProfileFields({ d, patch, notice }: { d: ProfileDraft; patch: (p: Partial<ProfileDraft>) => void; notice: ReactNode }) {
  const offices = useStore((s) => s.offices)
  return (
    <>
          <div className="flex gap-3">
            <Field label="Họ tên" className="flex-1"><input aria-label="Họ tên" className="w-full" value={d.name} onChange={(e) => patch({ name: e.target.value })} /></Field>
            <Field label="Số điện thoại" className="w-40"><input aria-label="Số điện thoại" className="w-full" value={d.phone} onChange={(e) => patch({ phone: e.target.value })} /></Field>
          </div>
          <Field label="Địa chỉ nhà (có thể dán Plus Code để định vị chính xác)"><input aria-label="Địa chỉ nhà" className="w-full" value={d.address} onChange={(e) => patch({ address: e.target.value })} /></Field>
          {notice}
          <div className="flex flex-wrap gap-3">
            <Field label="Quận/huyện"><input aria-label="Quận/huyện" className="w-36" value={d.district} onChange={(e) => patch({ district: e.target.value })} /></Field>
            <Field label="Văn phòng"><select aria-label="Văn phòng" value={d.officeId} onChange={(e) => patch({ officeId: e.target.value })}>{offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
            <Field label="Năng lực"><select aria-label="Năng lực" value={d.track} onChange={(e) => patch({ track: e.target.value })}><option value="">Chưa rõ</option><option>TÍCH HỢP</option><option>STEM/CDS/AI</option></select></Field>
            <Field label="Giới tính"><select aria-label="Giới tính" value={d.gender} onChange={(e) => patch({ gender: e.target.value as Gender | '' })}><option value="">Chưa khai</option><option value="F">Nữ</option><option value="M">Nam</option></select></Field>
            <Field label="Km tối đa"><input aria-label="Km tối đa" className="w-20" inputMode="numeric" value={d.maxKm} onChange={(e) => patch({ maxKm: e.target.value })} /></Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-slate-500">Khu vực mong muốn</legend>
            <div className="flex flex-wrap gap-1.5">
              {AREA_OPTIONS.map((a) => {
                const on = d.areas.includes(a)
                return <button key={a} aria-pressed={on} onClick={() => patch({ areas: on ? d.areas.filter((x) => x !== a) : [...d.areas, a] })} className={clsx('rounded-full border px-2.5 py-0.5 text-xs font-medium', on ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100')}>{a}</button>
              })}
            </div>
          </fieldset>
          <label className="flex items-center gap-2"><input type="checkbox" aria-label="Chỉ làm online" checked={d.onlineOnly} onChange={(e) => patch({ onlineOnly: e.target.checked })} />Chỉ làm online (không xếp ca tại trường)</label>
    </>
  )
}

function NewDialog({ close }: { close: () => void }) {
  const teachers = useStore((s) => s.teachers)
  const offices = useStore((s) => s.offices)
  const addTeacher = useStore((s) => s.addTeacher)
  const navigate = useNavigate()
  const { search } = useLocation()
  const [code, setCode] = useState(() => nextTeacherId(teachers))
  const [d, setD] = useState<ProfileDraft>(() => emptyProfile(offices[0]?.id ?? 'BR'))
  const patch = (p: Partial<ProfileDraft>) => setD((x) => ({ ...x, ...p }))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  const idError = teacherIdError(code, teachers)
  const errors = [...(idError ? [idError] : []), ...profileErrors(d)]
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Thêm giáo viên" data-testid="new-teacher-dialog" className="flex max-h-[90vh] w-[620px] max-w-full flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="font-semibold">Thêm giáo viên</h2>
          <button aria-label="Đóng" className="text-slate-400 hover:text-slate-700" onClick={close}><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <Field label="Mã giáo viên"><input aria-label="Mã giáo viên" className="tnum w-32" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <ProfileFields d={d} patch={patch} notice={d.address.trim() ? <AddressNotice address={d.address} dropped={0} /> : null} />
          {errors.length > 0 && <div className="rounded-md bg-red-50 px-3 py-2 text-red-800" data-testid="profile-errors">{errors.join('. ')}.</div>}
          <p className="text-xs text-slate-500">Nên chọn năng lực: nếu chưa chọn, giáo viên này sẽ bị trừ điểm về môn dạy khi hệ thống gợi ý người dạy.</p>
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <Button onClick={close}>Huỷ</Button>
          <Button variant="primary" disabled={errors.length > 0} onClick={() => {
            const id = addTeacher(code, d)
            toast(`Đã thêm giáo viên ${id}`)
            close()
            if (!search.includes('view=table')) navigate(`/teachers/${id}`)
          }}>Thêm giáo viên</Button>
        </footer>
      </div>
    </div>
  )
}
