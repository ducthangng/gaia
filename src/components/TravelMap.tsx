import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'

export interface MapPlaceDot {
  id: string
  name: string
  lat: number
  lng: number
  approximate: boolean
}

export interface MapLink {
  id: string
  from: MapPlaceDot
  to: MapPlaceDot
  problem: boolean
  active: boolean
  label: string
  onClick?: () => void
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/**
 * Đường đi thực tế từ OSRM; chỉ gửi toạ độ trường. Máy chủ lỗi hoặc điểm chỉ gần đúng thì giữ đường thẳng nét đứt.
 */
async function fetchRoad(a: MapPlaceDot, b: MapPlaceDot, signal: AbortSignal): Promise<[number, number][] | null> {
  if (a.approximate || b.approximate) return null
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`, { signal })
    if (!res.ok) return null
    const data = await res.json()
    const coords: [number, number][] | undefined = data.routes?.[0]?.geometry?.coordinates
    return coords ? coords.map(([lng, lat]) => [lat, lng]) : null
  } catch {
    return null
  }
}

export default function TravelMap({ focus, links }: { focus: MapPlaceDot; links: MapLink[] }) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    const m = L.map(el.current!, { scrollWheelZoom: false })
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

  useEffect(() => {
    const m = map.current!
    const group = layer.current!
    group.clearLayers()
    const controller = new AbortController()
    const places = new Map<string, MapPlaceDot>([[focus.id, focus]])
    for (const l of links) {
      places.set(l.from.id, l.from)
      places.set(l.to.id, l.to)
    }
    const ordered = [...links].sort((a, b) => Number(a.problem) - Number(b.problem) || Number(a.active) - Number(b.active))
    for (const l of ordered) {
      const line = L.polyline([[l.from.lat, l.from.lng], [l.to.lat, l.to.lng]], {
        color: l.problem ? '#f59e0b' : '#94a3b8',
        weight: l.active ? 5 : l.problem ? 3 : 2,
        opacity: l.problem ? 0.95 : 0.7,
        dashArray: l.from.approximate || l.to.approximate ? '6 6' : undefined,
      }).addTo(group)
      line.bindTooltip(esc(l.label), { sticky: true })
      if (l.onClick) line.on('click', l.onClick)
      if (l.active) {
        fetchRoad(l.from, l.to, controller.signal).then((road) => {
          if (road && !controller.signal.aborted) line.setLatLngs(road)
        })
      }
    }
    for (const p of places.values()) {
      const isFocus = p.id === focus.id
      L.circleMarker([p.lat, p.lng], { radius: isFocus ? 9 : 6, color: '#fff', weight: 2, fillColor: isFocus ? '#047857' : '#475569', fillOpacity: p.approximate ? 0.55 : 1 })
        .addTo(group)
        .bindTooltip(`${esc(p.name)}${p.approximate ? ' (vị trí gần đúng)' : ''}`, { permanent: isFocus, direction: 'top', offset: [0, -8] })
    }
    const active = links.find((l) => l.active)
    const bounds = L.latLngBounds((active ? [active.from, active.to] : [...places.values()]).map((p) => [p.lat, p.lng] as [number, number]))
    m.fitBounds(bounds.pad(0.25), { maxZoom: 14 })
    return () => controller.abort()
  }, [focus, links])

  return <div ref={el} className="isolate h-80 w-full" data-testid="travel-map" />
}
