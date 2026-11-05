import { DEFAULT_SETTINGS, type Distances, type Leave, type Lesson, type Office, type School, type Settings, type Teacher, type Week } from '../domain/types'
import type { Entity } from './api'

/** Phần state được lưu trên server. */
export interface SyncedState {
  teachers: Teacher[]
  schools: School[]
  offices: Office[]
  leaves: Leave[]
  weeks: Week[]
  distances: Distances
  kmOverrides: Record<string, number>
  settings: Settings
  anonymized: boolean
}

/** `${collection}|${id}` -> giá trị. Collection không chứa '|' nên tách ở dấu '|' đầu tiên. */
export type EntityIndex = Map<string, unknown>

const DISTANCE_KINDS = ['home', 'office', 'pair'] as const
export const entityKey = (c: string, id: string) => `${c}|${id}`
const splitKey = (key: string) => {
  const i = key.indexOf('|')
  return { c: key.slice(0, i), id: key.slice(i + 1) }
}

// Giữ nguyên tham chiếu phần "tuần không kèm ca" khi tuần không đổi, để so sánh nhanh.
const weekMeta = new WeakMap<Week, Omit<Week, 'lessons'>>()
const metaOf = (w: Week) => {
  let m = weekMeta.get(w)
  if (!m) {
    const { lessons: _lessons, ...rest } = w
    m = rest
    weekMeta.set(w, m)
  }
  return m
}

export function indexState(s: SyncedState): EntityIndex {
  const out: EntityIndex = new Map()
  for (const x of s.teachers) out.set(entityKey('teacher', x.id), x)
  for (const x of s.schools) out.set(entityKey('school', x.id), x)
  for (const x of s.offices) out.set(entityKey('office', x.id), x)
  for (const x of s.leaves) out.set(entityKey('leave', x.id), x)
  for (const w of s.weeks) {
    out.set(entityKey('week', w.id), metaOf(w))
    for (const l of w.lessons) out.set(entityKey('lesson', l.id), l)
  }
  for (const kind of DISTANCE_KINDS) for (const [k, km] of Object.entries(s.distances[kind])) out.set(entityKey('distance', `${kind}|${k}`), km)
  for (const [k, km] of Object.entries(s.kmOverrides)) out.set(entityKey('kmOverride', k), km)
  out.set(entityKey('settings', 'default'), s.settings)
  return out
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]))
  }
  // undefined và thiếu khoá là như nhau: JSON (và jsonb trên server) không giữ undefined.
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/** Những gì cần gửi lên: bản ghi mới, đã sửa (data mới) và đã xoá (data null). */
export function diffIndex(base: EntityIndex, now: EntityIndex): Entity[] {
  const out: Entity[] = []
  for (const [key, v] of now) {
    if (!base.has(key) || !deepEqual(base.get(key), v)) out.push({ ...splitKey(key), data: v })
  }
  for (const key of base.keys()) if (!now.has(key)) out.push({ ...splitKey(key), data: null })
  return out
}

export const emptyState = (): SyncedState => ({
  teachers: [], schools: [], offices: [], leaves: [], weeks: [],
  distances: { home: {}, office: {}, pair: {} }, kmOverrides: {}, settings: DEFAULT_SETTINGS, anonymized: false,
})

/**
 * Đưa thay đổi từ server vào state, trả về state mới (bản ghi không đổi giữ nguyên tham chiếu).
 * Bản ghi trong `keep` (người dùng đang sửa, chưa gửi) được giữ nguyên bản ở máy.
 */
export function applyEntities(s: SyncedState, entities: Entity[], keep: Set<string> = new Set()): SyncedState {
  const list = <T extends { id: string }>(arr: T[], c: string) => {
    const changes = entities.filter((e) => e.c === c && !keep.has(entityKey(c, e.id)))
    if (!changes.length) return arr
    const next = new Map(arr.map((x) => [x.id, x]))
    let changed = false
    for (const e of changes) {
      if (e.data === null) changed = next.delete(e.id) || changed
      else if (!deepEqual(next.get(e.id), e.data)) {
        next.set(e.id, e.data as T)
        changed = true
      }
    }
    return changed ? [...next.values()] : arr
  }

  // Tuần và ca: ca mới nối vào cuối tuần của nó, ca đã có giữ vị trí.
  let weeks = s.weeks
  const weekChanges = entities.filter((e) => e.c === 'week' && !keep.has(entityKey('week', e.id)))
  const lessonChanges = entities.filter((e) => e.c === 'lesson' && !keep.has(entityKey('lesson', e.id)))
  if (weekChanges.length || lessonChanges.length) {
    const byId = new Map(weeks.map((w) => [w.id, w]))
    for (const e of weekChanges) {
      const old = byId.get(e.id)
      if (e.data === null) byId.delete(e.id)
      else if (!old || !deepEqual(metaOf(old), e.data)) byId.set(e.id, { ...(e.data as Week), lessons: old?.lessons ?? [] })
    }
    const lessonWeek = new Map<string, string>()
    for (const w of byId.values()) for (const l of w.lessons) lessonWeek.set(l.id, w.id)
    const perWeek = new Map<string, Map<string, Lesson>>()
    const lessonsOf = (weekId: string) => {
      let m = perWeek.get(weekId)
      if (!m) {
        m = new Map((byId.get(weekId)?.lessons ?? []).map((l) => [l.id, l]))
        perWeek.set(weekId, m)
      }
      return m
    }
    for (const e of lessonChanges) {
      const at = lessonWeek.get(e.id)
      if (e.data === null) {
        if (at) lessonsOf(at).delete(e.id)
        continue
      }
      const l = e.data as Lesson
      if (at && at !== l.weekId) lessonsOf(at).delete(e.id)
      if (!byId.has(l.weekId)) continue
      const m = lessonsOf(l.weekId)
      if (!deepEqual(m.get(e.id), l)) m.set(e.id, l)
    }
    for (const [weekId, m] of perWeek) {
      const w = byId.get(weekId)
      if (!w) continue
      const lessons = [...m.values()]
      if (lessons.length !== w.lessons.length || lessons.some((l, i) => l !== w.lessons[i])) byId.set(weekId, { ...w, lessons })
    }
    weeks = [...byId.values()].sort((a, b) => a.startDate.localeCompare(b.startDate))
    if (weeks.length === s.weeks.length && weeks.every((w, i) => w === s.weeks[i])) weeks = s.weeks
  }

  let distances = s.distances
  let kmOverrides = s.kmOverrides
  let settings = s.settings
  let anonymized = s.anonymized
  for (const e of entities) {
    if (keep.has(entityKey(e.c, e.id))) continue
    if (e.c === 'distance') {
      const i = e.id.indexOf('|')
      const kind = e.id.slice(0, i) as keyof Distances
      const k = e.id.slice(i + 1)
      if (!DISTANCE_KINDS.includes(kind) || distances[kind][k] === e.data) continue
      const table = { ...distances[kind] }
      if (e.data === null) delete table[k]
      else table[k] = e.data as number
      distances = { ...distances, [kind]: table }
    } else if (e.c === 'kmOverride') {
      if (kmOverrides[e.id] === e.data) continue
      kmOverrides = { ...kmOverrides }
      if (e.data === null) delete kmOverrides[e.id]
      else kmOverrides[e.id] = e.data as number
    } else if (e.c === 'settings' && e.data !== null) {
      // Gộp với mặc định: bản lưu cũ thiếu khoá mới vẫn dùng được.
      const next = { ...DEFAULT_SETTINGS, ...(e.data as Partial<Settings>) }
      if (!deepEqual(next, settings)) settings = next
    } else if (e.c === 'meta' && e.id === 'seed' && e.data) {
      anonymized = !!(e.data as { anonymized?: boolean }).anonymized
    }
  }

  return {
    teachers: list(s.teachers, 'teacher'),
    schools: list(s.schools, 'school'),
    offices: list(s.offices, 'office'),
    leaves: list(s.leaves, 'leave'),
    weeks, distances, kmOverrides, settings, anonymized,
  }
}

/** Đặt lại bản đã đồng bộ cho những bản ghi vừa nhận từ server. */
export function recordSynced(base: EntityIndex, entities: Entity[]) {
  for (const e of entities) {
    if (e.c === 'meta') continue
    const key = entityKey(e.c, e.id)
    if (e.data === null) base.delete(key)
    else base.set(key, e.c === 'settings' ? { ...DEFAULT_SETTINGS, ...(e.data as object) } : e.data)
  }
}
