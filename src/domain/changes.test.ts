import { describe, expect, it } from 'vitest'
import seedJson from '../data/seed.json'
import { preferenceViolations, blockers } from './constraints'
import { buildContext, type World } from './context'
import { googleDirectionsUrl, haversineKm, isPrecise, parseLatLng, roadKm } from './geo'
import { healthOf, schoolLoad, schoolTransfers, touchesSchool, weekIssues } from './issues'
import { affectedByLeave, applyLeave, revertLeave } from './leave'
import { DEFAULT_SETTINGS, teacherLabel, type GeoPoint, type Lesson, type Seed, type Teacher } from './types'

const seed = seedJson as unknown as Seed
const world: World = { ...seed, settings: DEFAULT_SETTINGS, kmOverrides: {} }
const week = seed.weeks.at(-1)!
const lesson = (over: Partial<Lesson>): Lesson => ({
  id: 'x', weekId: week.id, teacherId: 'T', originalTeacherId: null, schoolId: 'a', date: '2026-11-02', session: 'AM', period: 1, track: 0,
  className: '1A', subject: 'STEM', start: '07:30', end: '08:05', code: 'S', company: null, note: null, type: 'regular', status: 'assigned', ...over,
})
const teacher = (over: Partial<Teacher> = {}): Teacher => ({ ...seed.teachers[0], id: 'T', name: 'T', active: true, preferences: [], maxKm: null, areas: [], onlineOnly: false, ...over })

describe('phân loại cảnh báo và độ khoẻ', () => {
  const [a, b] = seed.schools.filter((s) => s.geo)
  const worldWith = { ...world, teachers: [...world.teachers, teacher()] }
  const issuesFor = (lessons: Lesson[]) => weekIssues(buildContext({ ...week, lessons }, worldWith))

  it('trùng giờ là đỏ, không kịp di chuyển là vàng, còn lại ok', () => {
    const overlap = issuesFor([lesson({ id: '1', schoolId: a.id }), lesson({ id: '2', schoolId: a.id, className: '1B' })])
    expect(overlap.filter((i) => i.kind === 'overlap')).toHaveLength(1)
    expect(healthOf(overlap)).toBe('critical')

    const travel = issuesFor([lesson({ id: '1', schoolId: a.id }), lesson({ id: '2', schoolId: b.id, start: '08:05', end: '08:40', className: '1B' })])
    const t = travel.find((i) => i.kind === 'travel')!
    expect(t.needMin).toBeGreaterThan(t.gapMin!)
    expect(t.related?.schoolId).toBe(a.id)
    expect(healthOf(travel)).toBe('warning')

    expect(healthOf(issuesFor([lesson({ id: '1', schoolId: a.id })]))).toBe('ok') // chỉ ngoài Refer
    expect(healthOf(issuesFor([lesson({ id: '1', schoolId: a.id, teacherId: null, status: 'needs_cover' })]))).toBe('critical')
  })

  it('cảnh báo không kịp hiện ở cả hai trường', () => {
    const t = issuesFor([lesson({ id: '1', schoolId: a.id }), lesson({ id: '2', schoolId: b.id, start: '08:05', end: '08:40', className: '1B' })]).find((i) => i.kind === 'travel')!
    expect(touchesSchool(t, a.id)).toBe(true)
    expect(touchesSchool(t, b.id)).toBe(true)
    expect(touchesSchool(t, 'khac')).toBe(false)
  })
})

describe('xin nghỉ', () => {
  const r = { teacherId: 'T', from: '2026-11-03', to: '2026-11-04', sessions: ['AM' as const] }
  const ls = [
    lesson({ id: 'trong', date: '2026-11-03' }),
    lesson({ id: 'chieu', date: '2026-11-03', session: 'PM' }),
    lesson({ id: 'ngoai', date: '2026-11-05' }),
    lesson({ id: 'hotro', date: '2026-11-04', code: 'CM', className: null }),
    lesson({ id: 'khac', date: '2026-11-03', teacherId: 'U' }),
  ]
  const byId = (xs: Lesson[], id: string) => xs.find((l) => l.id === id)!

  it('xem trước đúng các ca trong khoảng và đúng buổi', () => {
    expect(affectedByLeave(ls, r).map((l) => l.id)).toEqual(['trong', 'hotro'])
  })
  it('ca dạy cần người thay, ca hỗ trợ bị huỷ, ca khác giữ nguyên', () => {
    const after = applyLeave(ls, r)
    expect(byId(after, 'trong')).toMatchObject({ status: 'needs_cover', teacherId: null, originalTeacherId: 'T' })
    expect(byId(after, 'hotro').status).toBe('cancelled')
    expect(byId(after, 'chieu').status).toBe('assigned')
    expect(byId(after, 'ngoai').status).toBe('assigned')
    expect(byId(after, 'khac').teacherId).toBe('U')
  })
  it('huỷ nghỉ trả ca về GV, nhưng giữ ca đã có người thay', () => {
    const covered = applyLeave(ls, r).map((l) => (l.id === 'hotro' ? l : l.id === 'trong' ? { ...l, teacherId: 'U', status: 'assigned' as const } : l))
    const back = revertLeave(covered, r)
    expect(byId(back, 'trong').teacherId).toBe('U')
    expect(byId(back, 'hotro')).toMatchObject({ status: 'assigned', teacherId: 'T', originalTeacherId: null })
    expect(byId(revertLeave(applyLeave(ls, r), r), 'trong')).toMatchObject({ status: 'assigned', teacherId: 'T' })
  })
})

describe('khu vực và làm online', () => {
  const school = { ...seed.schools[0], region: 'Phú Mỹ' }
  it('trường ngoài khu vực đăng ký là vi phạm, khu vực lạ thì không so', () => {
    expect(preferenceViolations(teacher({ areas: ['VŨNG TÀU'] }), lesson({}), school)).toHaveLength(1)
    expect(preferenceViolations(teacher({ areas: ['PHÚ MỸ'] }), lesson({}), school)).toHaveLength(0)
    expect(preferenceViolations(teacher({ areas: [] }), lesson({}), school)).toHaveLength(0)
    expect(preferenceViolations(teacher({ areas: ['VŨNG TÀU'] }), lesson({}), { ...school, region: 'Hồ Tràm' })).toHaveLength(0)
  })
  it('GV chỉ làm online không xếp được ca tại trường', () => {
    const ctx = buildContext(week, world)
    expect(blockers(teacher({ onlineOnly: true }), lesson({}), [], [], ctx.book, DEFAULT_SETTINGS).map((b) => b.kind)).toEqual(['leave'])
  })
})

describe('sắp xếp và di chuyển', () => {
  it('số ca theo trường bỏ qua ca nghỉ', () => {
    const load = schoolLoad([lesson({ id: '1', schoolId: 'a' }), lesson({ id: '2', schoolId: 'a' }), lesson({ id: '3', schoolId: 'b' }), lesson({ id: '4', schoolId: 'b', status: 'school_off' })])
    expect(load.get('a')).toBe(2)
    expect(load.get('b')).toBe(1)
  })
  it('đếm số lần GV đi giữa hai trường', () => {
    const ctx = buildContext({ ...week, lessons: [lesson({ id: '1', schoolId: 'a' }), lesson({ id: '2', schoolId: 'b', start: '09:00', end: '09:30' }), lesson({ id: '3', schoolId: 'a', start: '10:00', end: '10:30' })] }, { ...world, teachers: [...world.teachers, teacher()] })
    expect(schoolTransfers(ctx, 'a')).toEqual([{ otherSchoolId: 'b', count: 2 }])
    expect(schoolTransfers(ctx, 'c')).toEqual([])
  })
})

describe('toạ độ', () => {
  const p = (lat: number, lng: number, source: GeoPoint['source'] = 'pluscode'): GeoPoint => ({ lat, lng, source })
  it('nhận toạ độ dán từ Google Maps', () => {
    expect(parseLatLng('10.5054, 107.1761')).toEqual({ lat: 10.5054, lng: 107.1761 })
    expect(parseLatLng('10.5 107.1')).toEqual({ lat: 10.5, lng: 107.1 })
    expect(parseLatLng('abc')).toBeNull()
    expect(parseLatLng('100, 200')).toBeNull()
  })
  it('hệ số đường bộ sát với km Gaia đã ghi', () => {
    const geo = new Map(seed.schools.filter((s) => isPrecise(s.geo)).map((s) => [s.id, s.geo!]))
    const ratios = Object.entries(seed.distances.pair).flatMap(([k, km]) => {
      const [a, b] = k.split('|')
      const d = geo.get(a) && geo.get(b) ? haversineKm(geo.get(a)!, geo.get(b)!) : 0
      return d > 2 ? [km / d] : []
    }).sort((x, y) => x - y)
    expect(ratios.length).toBeGreaterThan(5)
    const median = ratios[ratios.length >> 1]
    expect(median).toBeGreaterThan(1.05)
    expect(median).toBeLessThan(1.6)
    expect(roadKm(p(10.5, 107.1), p(10.5, 107.1))).toBe(1)
  })
  it('link Google Maps dùng toạ độ khi có, tên khi chỉ biết khu vực', () => {
    const u = googleDirectionsUrl({ name: 'A', geo: p(10.5, 107.1) }, { name: 'B', geo: p(10.6, 107.2, 'region') })
    expect(u).toContain('origin=10.5%2C107.1')
    expect(u).toContain('destination=B')
  })
})

describe('dữ liệu', () => {
  it('địa chỉ giáo viên không có trong seed ẩn danh', () => {
    expect(seed.teachers.every((t) => t.address === null && t.phone === null)).toBe(true)
    expect(JSON.stringify(seed).toUpperCase()).not.toContain('THAI SẢN')
  })
  it('đa số trường có lịch tuần này có toạ độ', () => {
    const ids = new Set(week.lessons.map((l) => l.schoolId))
    const withGeo = seed.schools.filter((s) => ids.has(s.id) && s.geo).length
    expect(withGeo / ids.size).toBeGreaterThan(0.7)
  })
})

describe('hiển thị giáo viên', () => {
  it('có cả mã và tên, bản ẩn danh không lặp mã', () => {
    expect(teacherLabel({ id: 'VT011', name: 'Trần Lan Hương' })).toBe('VT011 · Trần Lan Hương')
    expect(teacherLabel({ id: 'VT011', name: 'Giáo viên VT011' })).toBe('Giáo viên VT011')
  })
})
