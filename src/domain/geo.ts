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
