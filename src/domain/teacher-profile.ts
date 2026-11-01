import { decodePlusCode } from './geo'
import type { Distances, Gender, GeoPoint, Place, RecordedLeg, Teacher } from './types'

export const AREA_OPTIONS = ['PHÚ MỸ', 'CHÂU ĐỨC', 'BÀ RỊA', 'VŨNG TÀU', 'PHƯỚC HẢI']

export interface ProfileDraft {
  name: string
  phone: string
  address: string
  district: string
  officeId: string
  track: string
  areas: string[]
  gender: Gender | ''
  maxKm: string
  onlineOnly: boolean
}

export const profileFrom = (t: Teacher): ProfileDraft => ({
  name: t.name,
  phone: t.phone ?? '',
  address: t.address ?? '',
  district: t.district ?? '',
  officeId: t.officeId,
  track: t.track ?? '',
  areas: t.areas,
  gender: t.gender ?? '',
  maxKm: t.maxKm === null ? '' : String(t.maxKm),
  onlineOnly: t.onlineOnly,
})

export function profileErrors(d: ProfileDraft): string[] {
  const out: string[] = []
  if (!d.name.trim()) out.push('Cần có họ tên')
  if (d.phone.trim() && !/^[\d .+-]{8,15}$/.test(d.phone.trim())) out.push('Số điện thoại chưa đúng')
  if (d.maxKm.trim() && !(Number(d.maxKm) > 0)) out.push('Phạm vi di chuyển phải là số km lớn hơn 0')
  return out
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
// Lỗi gõ đã gặp trong dữ liệu thật.
const TYPOS: Record<string, string> = { 'rach rua': 'rach dua' }

export interface LocatedAddress {
  geo?: GeoPoint
  area?: string
}

/** Định vị địa chỉ ngay trên máy: Plus Code nếu có, không thì tâm phường/xã nhận ra trong địa chỉ. */
export function locateAddress(address: string, places: Place[]): LocatedAddress {
  let text = fold(address)
  for (const [wrong, right] of Object.entries(TYPOS)) text = text.replace(wrong, right)
  const place = places.find((p) => text.includes(fold(p.name)))
  const exact = decodePlusCode(address)
  if (exact) return { geo: { ...exact, source: 'pluscode' }, area: place?.name }
  return place ? { geo: { lat: place.lat, lng: place.lng, source: 'ward' }, area: place.name } : {}
}

export function applyProfile(t: Teacher, d: ProfileDraft, places: Place[]): Teacher {
  const address = d.address.trim() || null
  const addressChanged = address !== t.address
  const located = addressChanged && address ? locateAddress(address, places) : {}
  return {
    ...t,
    name: d.name.trim(),
    phone: d.phone.trim() || null,
    address,
    district: d.district.trim().toUpperCase() || null,
    officeId: d.officeId,
    track: d.track || null,
    areas: d.areas,
    gender: d.gender || null,
    maxKm: d.maxKm.trim() ? Number(d.maxKm) : null,
    onlineOnly: d.onlineOnly,
    homeGeo: addressChanged ? located.geo : t.homeGeo,
    homeArea: addressChanged ? located.area : t.homeArea,
  }
}

/** Số km từ nhà đã ghi chỉ đúng với địa chỉ cũ: chuyển nhà thì phải bỏ, nếu không chi phí sẽ sai mà không ai biết. */
export function dropHomeKm(distances: Distances, teacherId: string): Distances {
  return { ...distances, home: Object.fromEntries(Object.entries(distances.home).filter(([k]) => !k.startsWith(`${teacherId}|`))) }
}

export const dropHomeLegs = (legs: RecordedLeg[], teacherId: string) => legs.filter((l) => !(l.teacherId === teacherId && l.start === 'N'))

export const recordedHomeKmCount = (distances: Distances, teacherId: string) =>
  Object.keys(distances.home).filter((k) => k.startsWith(`${teacherId}|`)).length
