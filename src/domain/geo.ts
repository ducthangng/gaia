import type { GeoPoint } from './types'

/** Đường bộ thực tế dài hơn đường chim bay; hệ số đo từ các cặp trường có km đã ghi. */
const ROAD_FACTOR = 1.3

export const isPrecise = (g: GeoPoint | undefined): g is GeoPoint => !!g && g.source !== 'region' && g.source !== 'ward'

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(h))
}

export const roadKm = (a: GeoPoint, b: GeoPoint) => Math.max(1, Math.round(haversineKm(a, b) * ROAD_FACTOR))

/** Nhận toạ độ dán từ Google Maps: "10.5054, 107.1761". */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/)
  if (!m) return null
  const lat = Number(m[1])
  const lng = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null
}

export interface MapPlace {
  name: string
  geo?: GeoPoint
  address?: string | null
}

const placeParam = (p: MapPlace) => (isPrecise(p.geo) ? `${p.geo.lat},${p.geo.lng}` : [p.name, p.address].filter(Boolean).join(', '))

/** Link chỉ đường Google Maps: không cần API key, mở ra quãng đường và thời gian thực tế. */
export const googleDirectionsUrl = (from: MapPlace, to: MapPlace) =>
  `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(placeParam(from))}&destination=${encodeURIComponent(placeParam(to))}&travelmode=driving`

export const googleSearchUrl = (p: MapPlace) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeParam(p))}`

const CITY = /^(thành phố |tp\.?\s*)?(hồ chí minh|ho chi minh|hcm)$|^(việt nam|vietnam)$/i
const WARD_PREFIX = /^(phường|xã|p\.|x\.)\s*/i

/** Phường/xã lấy từ địa chỉ; địa chỉ chỉ có Plus Code hoặc không có thì dùng khu vực của trường. */
export function wardOf(school: { address: string | null; region: string | null }): string {
  const fallback = school.region?.trim() || '—'
  if (!school.address) return fallback
  const parts = school.address
    .split(/\bCS2\b/)[0]
    .replace(/\(.*?\)/g, '')
    .replace(/^CS1\s*:\s*/i, '')
    .split(',')
    .map((p) => p.trim().replace(/\.$/, ''))
    .filter((p) => p && !CITY.test(p))
  const named = parts.find((p) => WARD_PREFIX.test(p))
  if (named) return /\d/.test(named) ? named : named.replace(WARD_PREFIX, '')
  const rest = parts.slice(1)
  const last = rest.at(-1)?.replace(/^thành phố\s*/i, '')
  return last || fallback
}

const OLC = '23456789CFGHJMPQRVWX'
const PLUS_CODE = /\b([23456789CFGHJMPQRVWX]{4})\+([23456789CFGHJMPQRVWX]{2,3})\b/
/** Tâm Bà Rịa - Vũng Tàu: Plus Code rút gọn trong vùng đều nằm trong phạm vi 0,5 độ quanh điểm này. */
const OLC_REFERENCE = { lat: 10.5, lng: 107.25 }

/** Giải Plus Code rút gọn ngay trên máy, không gọi dịch vụ nào. */
export function decodePlusCode(text: string | null | undefined): { lat: number; lng: number } | null {
  const m = text?.match(PLUS_CODE)
  if (!m) return null
  const [head, tail] = [m[1], m[2]]
  const at = (c: string) => OLC.indexOf(c)
  let lat = Math.floor(OLC_REFERENCE.lat + 90) + at(head[0]) * 0.05 + at(head[2]) * 0.0025 + at(tail[0]) * 0.000125
  let lng = Math.floor(OLC_REFERENCE.lng + 180) + at(head[1]) * 0.05 + at(head[3]) * 0.0025 + at(tail[1]) * 0.000125
  let sizeLat = 0.000125
  let sizeLng = 0.000125
  if (tail.length === 3) {
    sizeLat /= 5
    sizeLng /= 4
    lat += Math.floor(at(tail[2]) / 4) * sizeLat
    lng += (at(tail[2]) % 4) * sizeLng
  }
  lat += sizeLat / 2 - 90
  lng += sizeLng / 2 - 180
  if (lat <= OLC_REFERENCE.lat - 0.5) lat += 1
  else if (lat > OLC_REFERENCE.lat + 0.5) lat -= 1
  if (lng <= OLC_REFERENCE.lng - 0.5) lng += 1
  else if (lng > OLC_REFERENCE.lng + 0.5) lng -= 1
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 }
}
