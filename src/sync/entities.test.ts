import { describe, expect, it } from 'vitest'
import seedJson from '../data/seed.json'
import { DEFAULT_SETTINGS, type Seed } from '../domain/types'
import { applyEntities, diffIndex, emptyState, entityKey, indexState, recordSynced, type SyncedState } from './entities'

const seed = seedJson as unknown as Seed
const state: SyncedState = { ...seed, settings: DEFAULT_SETTINGS, kmOverrides: { 'w|VT001|2026-11-02|x': 9 }, anonymized: true }
const asEntities = (s: SyncedState) => diffIndex(new Map(), indexState(s))
// Server trả jsonb: thứ tự khoá đổi, undefined biến mất.
const viaJson = <T,>(x: T): T => JSON.parse(JSON.stringify(x))

describe('đồng bộ: chuyển state <-> bản ghi', () => {
  it('state -> bản ghi -> state giữ nguyên dữ liệu', () => {
    const back = applyEntities(emptyState(), viaJson(asEntities(state)))
    expect(diffIndex(indexState(back), indexState(state))).toEqual([])
    expect(back.weeks.map((w) => w.lessons.length)).toEqual(seed.weeks.map((w) => w.lessons.length))
    expect(back.weeks.flatMap((w) => w.lessons.map((l) => l.id))).toEqual(seed.weeks.flatMap((w) => w.lessons.map((l) => l.id)))
  })

  it('ca tách khỏi tuần, km tách theo loại', () => {
    const idx = indexState(state)
    const week = idx.get(entityKey('week', seed.weeks[0].id)) as object
    expect('lessons' in week).toBe(false)
    const [k, km] = Object.entries(seed.distances.home)[0]
    expect(idx.get(entityKey('distance', `home|${k}`))).toBe(km)
  })

  it('chỉ gửi đúng phần đã sửa', () => {
    const base = indexState(state)
    const w = state.weeks.at(-1)!
    const edited: SyncedState = {
      ...state,
      weeks: state.weeks.map((x) => (x === w ? { ...x, lessons: x.lessons.slice(1).map((l, i) => (i === 0 ? { ...l, teacherId: 'VT002' } : l)) } : x)),
      teachers: state.teachers.map((t, i) => (i === 0 ? { ...t } : t)), // sao chép nhưng không đổi
      distances: { ...state.distances, office: { ...state.distances.office, 'BR|moi': 5 } },
    }
    const changes = diffIndex(base, indexState(edited))
    expect(changes.map((c) => `${c.c}|${c.id}|${c.data === null ? 'del' : 'up'}`).sort()).toEqual(
      [`lesson|${w.lessons[0].id}|del`, `lesson|${w.lessons[1].id}|up`, 'distance|office|BR|moi|up'].sort(),
    )
  })

  it('nhận thay đổi từ server: chỉ thay bản ghi đổi, giữ tham chiếu phần còn lại', () => {
    const w = state.weeks.at(-1)!
    const lesson = { ...w.lessons[0], teacherId: 'VT009' }
    const fresh = { ...w.lessons[0], id: 'new1' }
    const next = applyEntities(state, [
      { c: 'lesson', id: lesson.id, data: lesson },
      { c: 'lesson', id: 'new1', data: fresh },
      { c: 'teacher', id: state.teachers[1].id, data: null },
      { c: 'kmOverride', id: 'w|VT001|2026-11-02|x', data: null },
    ])
    const nw = next.weeks.at(-1)!
    expect(nw.lessons[0]).toBe(lesson)
    expect(nw.lessons.at(-1)).toBe(fresh)
    expect(nw.lessons[1]).toBe(w.lessons[1])
    expect(next.weeks[0]).toBe(state.weeks[0])
    expect(next.schools).toBe(state.schools)
    expect(next.teachers).toHaveLength(state.teachers.length - 1)
    expect(next.kmOverrides).toEqual({})
  })

  it('bản ghi đang sửa ở máy được giữ, và vẫn còn trong danh sách cần gửi', () => {
    const t = state.teachers[0]
    const local = { ...state, teachers: state.teachers.map((x) => (x === t ? { ...x, name: 'Sửa ở máy' } : x)) }
    const base = indexState(state)
    const key = entityKey('teacher', t.id)
    const remote = [{ c: 'teacher', id: t.id, data: { ...t, name: 'Người khác sửa' } }]
    const next = applyEntities(local, remote, new Set([key]))
    expect(next.teachers[0].name).toBe('Sửa ở máy')
    recordSynced(base, remote)
    expect(diffIndex(base, indexState(next)).map((c) => c.id)).toEqual([t.id])
  })

  it('cấu hình thiếu khoá mới được gộp với mặc định', () => {
    const { weights: _w, ...old } = DEFAULT_SETTINGS
    const next = applyEntities(emptyState(), [{ c: 'settings', id: 'default', data: { ...old, ratePerKm: 4000 } }])
    expect(next.settings).toEqual({ ...DEFAULT_SETTINGS, ratePerKm: 4000 })
  })
})
