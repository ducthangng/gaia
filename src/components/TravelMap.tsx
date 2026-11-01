import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'

export interface MapDot {
  id: string
  name: string
  lat: number
  lng: number
  approximate: boolean
  /** Nhà giáo viên: không gửi toạ độ cho máy chủ tìm đường bên ngoài. */
  noRouting?: boolean
}

export interface RoadInfo {
  km: number
  minutes: number
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Đường đi từ OSRM; chỉ gửi toạ độ trường và văn phòng. Lỗi mạng thì giữ đường thẳng nét đứt. */
async function fetchRoad(a: MapDot, b: MapDot, signal: AbortSignal) {
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`, { signal })
    if (!res.ok) return null
    const route = (await res.json()).routes?.[0]
    if (!route) return null
    return {
      path: (route.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng] as [number, number]),
      info: { km: Math.round(route.distance / 100) / 10, minutes: Math.round(route.duration / 60) },
    }
  } catch {
    return null
  }
}

export default function TravelMap({ focus, from, late, onRoad }: { focus: MapDot; from: MapDot | null; late: boolean; onRoad: (info: RoadInfo | null) => void }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const onRoadRef = useRef(onRoad)
  onRoadRef.current = onRoad

  useEffect(() => {
    const m = L.map(el.current!, { scrollWheelZoom: false })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    const resize = new ResizeObserver(() => m.invalidateSize())
    resize.observe(el.current!)
    return () => {
      resize.disconnect()
      m.remove()
      map.current = null
    }
  }, [])

  const key = `${focus.id}|${focus.lat},${focus.lng}|${from?.id}|${from?.lat},${from?.lng}|${late}`
  useEffect(() => {
    const m = map.current!
    const group = layer.current!
    group.clearLayers()
    onRoadRef.current(null)
    const controller = new AbortController()
    if (from) {
      const line = L.polyline([[from.lat, from.lng], [focus.lat, focus.lng]], { color: late ? '#d97706' : '#047857', weight: 5, opacity: 0.9, dashArray: '8 8' }).addTo(group)
      if (!from.approximate && !focus.approximate && !from.noRouting) {
        fetchRoad(from, focus, controller.signal).then((road) => {
          if (!road || controller.signal.aborted) return
          line.setLatLngs(road.path)
          line.setStyle({ dashArray: undefined })
          onRoadRef.current(road.info)
          m.fitBounds(line.getBounds().pad(0.2), { maxZoom: 15 })
        })
      }
      L.circleMarker([from.lat, from.lng], { radius: 8, color: '#fff', weight: 2, fillColor: '#475569', fillOpacity: from.approximate ? 0.55 : 1 })
        .addTo(group)
        .bindTooltip(`Từ: ${esc(from.name)}${from.approximate ? ' (gần đúng)' : ''}`, { permanent: true, direction: 'top', offset: [0, -8] })
    }
    L.circleMarker([focus.lat, focus.lng], { radius: 10, color: '#fff', weight: 2, fillColor: '#047857', fillOpacity: focus.approximate ? 0.55 : 1 })
      .addTo(group)
      .bindTooltip(`${from ? 'Đến: ' : ''}${esc(focus.name)}${focus.approximate ? ' (gần đúng)' : ''}`, { permanent: true, direction: 'bottom', offset: [0, 8] })
    if (from) m.fitBounds(L.latLngBounds([[from.lat, from.lng], [focus.lat, focus.lng]]).pad(0.3), { maxZoom: 15 })
    else m.setView([focus.lat, focus.lng], 14)
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return <div ref={el} className="isolate h-full min-h-[380px] w-full" data-testid="travel-map" />
}
