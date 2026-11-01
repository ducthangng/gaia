import type { GeoPoint } from './types'

/** Đường bộ thực tế dài hơn đường chim bay; hệ số đo từ các cặp trường có km đã ghi. */
const ROAD_FACTOR = 1.3

export const isPrecise = (g: GeoPoint | undefined): g is GeoPoint => !!g && g.source !== 'region'

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
