import { decodePlusCode, isPrecise, parseLatLng } from './geo'
import { locateAddress } from './teacher-profile'
import type { Distances, Place, School, Teacher } from './types'

export function missingTeacherFields(t: Teacher): string[] {
  const out: string[] = []
  if (!t.phone) out.push('SĐT')
  if (!t.address) out.push('Địa chỉ')
  if (!t.homeGeo) out.push('Vị trí nhà')
  if (!t.track) out.push('Năng lực')
  if (!t.areas.length) out.push('Khu vực mong muốn')
  if (!t.gender) out.push('Giới tính')
  return out
}

export function missingSchoolFields(s: School, distances: Pick<Distances, 'office'>): string[] {
  const out: string[] = []
  if (!s.address) out.push('Địa chỉ')
  if (!isPrecise(s.geo)) out.push('Toạ độ chính xác')
  if (!Object.keys(distances.office).some((k) => k.endsWith(`|${s.id}`))) out.push('Km từ văn phòng')
  return out
}

/** Sửa địa chỉ trường: Plus Code cho vị trí chính xác. Địa chỉ chữ chưa kiểm chứng được nên hạ toạ độ cũ xuống mức gần đúng. */
export function applySchoolAddress(s: School, address: string, places: Place[]): School {
  const text = address.trim() || null
  if (text === s.address) return s
  const exact = decodePlusCode(text)
  if (exact) return { ...s, address: text, geo: { ...exact, source: 'pluscode' } }
  if (s.geo?.source === 'manual') return { ...s, address: text }
  const near = text ? locateAddress(text, places).geo : undefined
  return { ...s, address: text, geo: s.geo ? { ...s.geo, source: 'region' } : near && { ...near, source: 'region' } }
}

/** Ô toạ độ nhận cả "10.5, 107.1" lẫn Plus Code. */
export const parseCoordinate = (text: string) => parseLatLng(text) ?? decodePlusCode(text)
