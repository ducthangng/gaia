import { describe, expect, it } from 'vitest'
import seedJson from '../data/seed.json'
import { blockers, leaveCovers, preferenceViolations } from './constraints'
import { buildContext, type World } from './context'
import { decodePlusCode, googleDirectionsUrl, haversineKm, isPrecise, parseLatLng, roadKm, wardOf } from './geo'
import { movementTo } from './movement'
import { applyChanges, MAX_LOAD_SHIFT, suggestOptimizations } from './optimize'
import { coverOptions, openLessons } from './cover-plan'
import { explainLessonChange, tierText } from './cost-explain'
import { dataDiff } from './data-diff'
import { createSchool, createTeacher, emptyProfile, nextTeacherId, schoolDraftErrors, schoolFullName, teacherIdError } from './create-records'
import { rankCandidates } from './recommend'
import { applySchoolAddress, missingSchoolFields, missingTeacherFields, parseCoordinate } from './data-quality'
import { applyProfile, dropHomeKm, dropHomeLegs, locateAddress, profileErrors, profileFrom } from './teacher-profile'
import { deriveRoute, routeForWeek } from './route'
import { axisHeight, axisY, buildAxis, hourRange, isMorning, layoutDay, prettyName, sessionBands } from './timetable'
import { applyBulk, applyDraft, draftErrors, draftFrom, inScope, newLesson, reassign, type BulkScope } from './lesson-edit'
import { healthOf, issueScore, newIssues, schoolLoad, touchesSchool, weekIssues } from './issues'
import { affectedByLeave, applyLeave, applyLessonLeave, revertLeave, revertLessonLeave } from './leave'
import { DEFAULT_SETTINGS, teacherLabel, type GeoPoint, type Lesson, type Seed, type Teacher } from './types'

const weekDatesOf = (start: string) => Array.from({ length: 7 }, (_, i) => new Date(Date.parse(start) + i * 864e5).toISOString().slice(0, 10))
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
  it('nhãn ghi đúng là khu vực mong muốn', () => {
    expect(preferenceViolations(teacher({ areas: ['VŨNG TÀU'] }), lesson({}), school)[0].label).toContain('mong muốn')
  })
  it('vị trí nhà giúp ước tính km sát hơn, nhưng số đã ghi vẫn được ưu tiên', () => {
    const near = seed.schools.find((x) => x.geo?.source === 'pluscode')!
    const home = { lat: near.geo!.lat + 0.1, lng: near.geo!.lng, source: 'ward' as const }
    const t = teacher({ id: 'H', homeGeo: home })
    const book = buildContext(week, { ...world, teachers: [...world.teachers, t] }).book
    const est = book.fromHome('H', near.id)
    expect(est.source).toBe('estimated')
    expect(est.km).toBeGreaterThan(11)
    expect(est.km).toBeLessThan(20)
    const recorded = buildContext(week, { ...world, teachers: [...world.teachers, t], distances: { ...world.distances, home: { [`H|${near.id}`]: 5 } } }).book
    expect(recorded.fromHome('H', near.id)).toEqual({ km: 5, source: 'recorded' })
  })
  it('vị trí theo phường không được coi là chính xác', () => {
    expect(isPrecise({ lat: 1, lng: 1, source: 'ward' })).toBe(false)
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
  it('điểm lỗi: nghiêm trọng xếp trên không kịp, không kịp xếp trên ghi chú', () => {
    const make = (kind: 'overlap' | 'travel' | 'refer') => ({ kind, lesson: lesson({}), detail: '' })
    const a = issueScore([make('overlap')])
    const b = issueScore([make('travel'), make('travel')])
    const c = issueScore([make('refer'), make('refer'), make('refer')])
    expect(a.rank).toBeGreaterThan(b.rank)
    expect(b.rank).toBeGreaterThan(c.rank)
    expect([a.urgent, b.urgent, c.urgent]).toEqual([1, 2, 0])
  })
  it.each([
    ['230 Đường Lưu Chí Hiếu, Rạch Dừa, Hồ Chí Minh', 'Rạch Dừa'],
    ['Hẻm 850 Đường 30/4, Phường Phước Thắng, Thành phố Vũng Tàu.', 'Phước Thắng'],
    ['Số 236 Bình Giã, Phường 8 (hoặc khu vực Tam Thắng), Thành phố Vũng Tàu', 'Phường 8'],
    ['J2RX+FQ6, P. Mỹ Xuân, TX, Phú Mỹ, Hồ Chí Minh, Vietnam', 'Mỹ Xuân'],
    ['G6FC+RWG, Ấp Tây, Tam Long, Hồ Chí Minh, Vietnam', 'Tam Long'],
    ['CS1 : J69Q+VQX, Ngãi Giao, Hồ Chí Minh CS2 : J5PX+9PH, Ngãi Giao', 'Ngãi Giao'],
    ['G3RC+W9H', 'Phú Mỹ'],
  ])('phường/xã của "%s"', (address, ward) => {
    expect(wardOf({ address, region: 'Phú Mỹ' })).toBe(ward)
  })
  it('không có địa chỉ thì dùng khu vực', () => {
    expect(wardOf({ address: null, region: 'Bà Rịa' })).toBe('Bà Rịa')
    expect(wardOf({ address: null, region: null })).toBe('—')
  })
})

describe('lịch dạng lưới giờ', () => {
  it('ca trùng giờ tách làn, ca nối tiếp dùng chung làn', () => {
    const r = layoutDay([
      lesson({ id: 'a', start: '07:30', end: '08:05' }),
      lesson({ id: 'b', start: '07:30', end: '08:05' }),
      lesson({ id: 'c', start: '08:05', end: '08:40' }),
    ])
    expect(r.lanes).toBe(2)
    expect(r.placed.find((p) => p.lesson.id === 'c')!.lane).toBe(0)
    expect(r.placed.find((p) => p.lesson.id === 'b')!.lane).toBe(1)
  })
  it('ca không có giờ không bị đoán vị trí; thiếu giờ kết thúc dùng thời lượng mặc định', () => {
    const r = layoutDay([lesson({ id: 'a', start: null, end: null }), lesson({ id: 'b', start: '09:00', end: null })])
    expect(r.untimed.map((l) => l.id)).toEqual(['a'])
    expect(r.placed[0].endMin).toBe(9 * 60 + 35)
  })
  it('khung giờ mở rộng theo dữ liệu', () => {
    expect(hourRange([])).toEqual({ from: 7, to: 17 })
    expect(hourRange([lesson({ start: '06:45', end: '07:20' }), lesson({ start: '17:30', end: '18:10' })])).toEqual({ from: 6, to: 19 })
  })
})

describe('giáo viên đi tới ca dạy từ đâu', () => {
  const [a, b] = seed.schools.filter((s) => s.geo)
  const w = (lessons: Lesson[]) => buildContext({ ...week, lessons, legs: [] }, { ...world, teachers: [...world.teachers, teacher()] })
  const first = lesson({ id: '1', schoolId: a.id })
  it('ca sáng đầu ngày đi từ Nhà, ca chiều đầu ngày đi từ Văn phòng', () => {
    expect(movementTo(first, w([first]))!.origin.kind).toBe('home')
    const pm = lesson({ id: '2', schoolId: a.id, session: 'PM', start: '14:00', end: '14:35' })
    expect(movementTo(pm, w([pm]))!.origin.kind).toBe('office')
  })
  it('đổi trường sát giờ là không kịp, đủ giờ là kịp', () => {
    const tight = lesson({ id: '2', schoolId: b.id, start: '08:05', end: '08:40' })
    const m = movementTo(tight, w([first, tight]))!
    expect(m.origin).toMatchObject({ kind: 'school', schoolId: a.id })
    expect(m.verdict).toBe('late')
    const roomy = lesson({ id: '3', schoolId: b.id, start: '11:00', end: '11:35' })
    expect(movementTo(roomy, w([first, roomy]))!.verdict).toBe('ok')
  })
  it('cùng trường thì không phải di chuyển', () => {
    const next = lesson({ id: '2', schoolId: a.id, start: '08:10', end: '08:45' })
    expect(movementTo(next, w([first, next]))).toMatchObject({ alreadyThere: true, verdict: 'ok' })
  })
  it('trùng giờ và ca chưa có giáo viên', () => {
    const clash = lesson({ id: '2', schoolId: b.id, start: '07:45', end: '08:20' })
    expect(movementTo(clash, w([first, clash]))!.verdict).toBe('overlap')
    expect(movementTo(lesson({ teacherId: null }), w([]))).toBeNull()
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
  it('khu vực mong muốn đã nạp đủ cho giáo viên đang dạy', () => {
    const active = seed.teachers.filter((t) => t.active)
    expect(active.filter((t) => t.areas.length).length).toBeGreaterThanOrEqual(active.length - 1)
  })
  it('địa chỉ và vị trí nhà giáo viên không có trong seed ẩn danh', () => {
    expect(seed.teachers.every((t) => t.address === null && t.phone === null && !t.homeGeo && !t.homeArea)).toBe(true)
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

describe('sửa một ca', () => {
  const d = (over = {}) => ({ ...draftFrom(lesson({})), ...over })
  it('bắt lỗi giờ và thiếu tên lớp', () => {
    expect(draftErrors(d())).toEqual([])
    expect(draftErrors(d({ start: '', end: '' }))).toHaveLength(1)
    expect(draftErrors(d({ start: '09:00', end: '08:00' }))).toEqual(['Giờ kết thúc phải sau giờ bắt đầu'])
    expect(draftErrors(d({ className: '', note: '' }))).toEqual(['Cần có tên lớp hoặc ghi chú'])
    expect(draftErrors(d({ className: '', note: 'Họp với trường' }))).toEqual([])
  })
  it('đổi giờ sang chiều thì đổi buổi; đổi môn thì đổi mã quy đổi', () => {
    const x = applyDraft(lesson({}), d({ start: '14:00', end: '14:35', subject: 'KNS' }))
    expect(x).toMatchObject({ session: 'PM', subject: 'KNS', code: 'K' })
  })
  it('ca hỗ trợ giữ nguyên mã khi đổi môn', () => {
    expect(applyDraft(lesson({ code: 'CM' }), d({ subject: 'KNS' })).code).toBe('CM')
  })
  it('bỏ giáo viên thành cần GV; thêm giáo viên thành đã xếp', () => {
    expect(applyDraft(lesson({}), d({ teacherId: '' }))).toMatchObject({ teacherId: null, status: 'needs_cover' })
    expect(applyDraft(lesson({ teacherId: null, status: 'needs_cover' }), d({ teacherId: 'U' }))).toMatchObject({ teacherId: 'U', status: 'assigned' })
  })
  it('có GV gốc thì người mới là dạy thay; trả về GV gốc là ca thường', () => {
    const open = lesson({ teacherId: null, originalTeacherId: 'A', status: 'needs_cover' })
    expect(applyDraft(open, d({ teacherId: 'B' }))).toMatchObject({ type: 'substitute', originalTeacherId: 'A' })
    expect(applyDraft({ ...open, teacherId: 'B', type: 'substitute', status: 'assigned' }, d({ teacherId: 'A' }))).toMatchObject({ type: 'regular', originalTeacherId: null })
  })
  it('sửa giờ không làm sống lại ca trường đã báo nghỉ', () => {
    expect(applyDraft(lesson({ status: 'school_off' }), d({ start: '09:00', end: '09:35' })).status).toBe('school_off')
  })
  it('ca mới có mã quy đổi theo môn và chưa có GV thì cần GV', () => {
    const x = newLesson('n', 'w', 's', d({ teacherId: '', subject: 'STEM' }))
    expect(x).toMatchObject({ code: 'S', status: 'needs_cover', schoolId: 's' })
    expect(newLesson('n', 'w', 's', d({ teacherId: 'T', subject: 'CDS' }))).toMatchObject({ code: 'C', status: 'assigned', teacherId: 'T' })
  })
})

describe('đổi lịch hàng loạt', () => {
  const ls = [
    lesson({ id: 'a', schoolId: 's', date: '2026-11-02' }),
    lesson({ id: 'b', schoolId: 's', date: '2026-11-02', session: 'PM', start: '14:00', end: '14:35', teacherId: 'U' }),
    lesson({ id: 'c', schoolId: 's', date: '2026-11-03' }),
    lesson({ id: 'x', schoolId: 'khac', date: '2026-11-02' }),
    lesson({ id: 'r', schoolId: 's', date: '2026-11-02', status: 'replaced' }),
  ]
  const scope = (over: Partial<BulkScope> = {}): BulkScope => ({ schoolId: 's', date: '2026-11-02', session: 'ALL', teacherId: '', ...over })
  const changed = (next: typeof ls) => next.filter((l, i) => l !== ls[i]).map((l) => l.id)
  it('phạm vi lọc đúng trường, ngày, buổi, giáo viên', () => {
    expect(ls.filter((l) => inScope(l, scope())).map((l) => l.id)).toEqual(['a', 'b'])
    expect(ls.filter((l) => inScope(l, scope({ session: 'PM' }))).map((l) => l.id)).toEqual(['b'])
    expect(ls.filter((l) => inScope(l, scope({ date: '' }))).map((l) => l.id)).toEqual(['a', 'b', 'c'])
    expect(ls.filter((l) => inScope(l, scope({ date: '', teacherId: 'U' }))).map((l) => l.id)).toEqual(['b'])
  })
  it('trường nghỉ cả ngày rồi khôi phục', () => {
    const off = applyBulk(ls, scope(), { kind: 'school_off' })
    expect(changed(off)).toEqual(['a', 'b'])
    const back = applyBulk(off, scope(), { kind: 'restore' })
    expect(back.find((l) => l.id === 'a')!.status).toBe('assigned')
  })
  it('dời sang ngày khác và lùi giờ, tự đổi buổi', () => {
    expect(applyBulk(ls, scope(), { kind: 'move', toDate: '2026-11-04' }).find((l) => l.id === 'a')!.date).toBe('2026-11-04')
    const later = applyBulk(ls, scope({ session: 'AM' }), { kind: 'shift', minutes: 300 }).find((l) => l.id === 'a')!
    expect(later).toMatchObject({ start: '12:30', end: '13:05', session: 'PM' })
    expect(applyBulk(ls, scope({ session: 'AM' }), { kind: 'shift', minutes: -30 }).find((l) => l.id === 'a')!.start).toBe('07:00')
  })
  it('đổi giáo viên cho các ca của một người; bỏ trống thành cần GV', () => {
    const next = applyBulk(ls, scope({ date: '', teacherId: 'T' }), { kind: 'teacher', toTeacherId: 'V' })
    expect(changed(next)).toEqual(['a', 'c'])
    expect(next.find((l) => l.id === 'b')!.teacherId).toBe('U')
    expect(applyBulk(ls, scope({ teacherId: 'U' }), { kind: 'teacher', toTeacherId: '' }).find((l) => l.id === 'b')).toMatchObject({ teacherId: null, status: 'needs_cover' })
  })
  it('ca đã đúng thì không tính là thay đổi', () => {
    expect(changed(applyBulk(ls, scope(), { kind: 'move', toDate: '2026-11-02' }))).toEqual([])
  })
})

describe('báo trước cảnh báo phát sinh', () => {
  const [a] = seed.schools.filter((s) => s.geo)
  const w = (lessons: Lesson[]) => weekIssues(buildContext({ ...week, lessons, legs: [] }, { ...world, teachers: [...world.teachers, teacher()] }))
  it('chỉ liệt kê cảnh báo mới do thay đổi gây ra', () => {
    const base = [lesson({ id: '1', schoolId: a.id }), lesson({ id: '2', schoolId: a.id, start: '09:00', end: '09:35', className: '1B' })]
    const moved = [base[0], { ...base[1], start: '07:40', end: '08:15' }]
    const fresh = newIssues(w(base), w(moved))
    expect(fresh.map((i) => i.kind)).toEqual(['overlap'])
    expect(newIssues(w(base), w(base))).toEqual([])
  })
})

describe('trục giờ thu gọn', () => {
  const am = { startMin: 7 * 60 + 15, endMin: 7 * 60 + 55 }
  const pm = { startMin: 14 * 60, endMin: 14 * 60 + 35 }
  it('khoảng trống dài thu thành dải, khoảng ngắn giữ nguyên', () => {
    expect(buildAxis([am, pm]).map((s) => s.kind)).toEqual(['slots', 'gap', 'slots'])
    expect(buildAxis([am, { startMin: 8 * 60, endMin: 8 * 60 + 40 }]).map((s) => s.kind)).toEqual(['slots'])
  })
  it('toạ độ tăng dần và ca chiều không bị đẩy xa', () => {
    const axis = buildAxis([am, pm])
    const y1 = axisY(axis, am.startMin, 26, 24)
    const y2 = axisY(axis, am.endMin, 26, 24)
    const y3 = axisY(axis, pm.startMin, 26, 24)
    expect(y1).toBe(0)
    expect(y2).toBeGreaterThan(y1)
    expect(y3).toBe(axisHeight(axis.slice(0, 2), 26, 24))
    expect(axisHeight(axis, 26, 24)).toBeLessThan(26 * 12)
  })
  it('ca ngắn được giữ đủ chỗ đọc, không đè lên ca kế tiếp', () => {
    const r = layoutDay([lesson({ id: 'a', start: '08:00', end: '08:15' }), lesson({ id: 'b', start: '08:20', end: '08:55' })])
    expect(r.lanes).toBe(2)
  })
  it('viết tên dễ đọc', () => {
    expect(prettyName('TRẦN LAN HƯƠNG')).toBe('Trần Lan Hương')
    expect(prettyName('ĐINH THANH NGÀ')).toBe('Đinh Thanh Ngà')
  })
})

describe('xin nghỉ theo ca', () => {
  const a = lesson({ id: 'a', start: '07:30', end: '08:05' })
  const b = lesson({ id: 'b', start: '08:10', end: '08:45', className: '1B' })
  const hotro = lesson({ id: 'h', start: '09:00', end: '09:35', code: 'CM', className: null })
  it('chỉ ca được chọn chuyển đi, ca khác trong buổi giữ nguyên', () => {
    const next = applyLessonLeave([a, b, hotro], 'T', ['a', 'h'])
    expect(next[0]).toMatchObject({ teacherId: null, originalTeacherId: 'T', status: 'needs_cover' })
    expect(next[1]).toBe(b)
    expect(next[2].status).toBe('cancelled')
  })
  it('không đụng ca của giáo viên khác', () => {
    const other = lesson({ id: 'o', teacherId: 'U' })
    expect(applyLessonLeave([other], 'T', ['o'])[0]).toBe(other)
  })
  it('huỷ nghỉ trả đúng ca đó về, ca đã có người thay thì giữ', () => {
    const left = applyLessonLeave([a, b], 'T', ['a', 'b'])
    const back = revertLessonLeave(left, 'T', 'a')
    expect(back[0]).toMatchObject({ teacherId: 'T', status: 'assigned', originalTeacherId: null })
    expect(back[1].status).toBe('needs_cover')
    const covered = { ...left[0], teacherId: 'U', status: 'assigned' as const }
    expect(revertLessonLeave([covered], 'T', 'a')[0].teacherId).toBe('U')
  })
  const leave = { id: 'l', teacherId: 'T', date: a.date, session: 'AM' as const, kind: 'leave' as const, note: 'Nghỉ', lessonId: 'a', start: '07:30', end: '08:05' }
  it('nghỉ theo ca chỉ khoá đúng khung giờ, ca khác cùng buổi vẫn nhận được', () => {
    expect(leaveCovers(leave, a)).toBe(true)
    expect(leaveCovers(leave, b)).toBe(false)
    expect(leaveCovers(leave, lesson({ id: 'x', start: '07:45', end: '08:20' }))).toBe(true)
    const ctx = buildContext(week, world)
    expect(blockers(teacher(), b, [], [leave], ctx.book, DEFAULT_SETTINGS)).toEqual([])
    expect(blockers(teacher(), a, [], [leave], ctx.book, DEFAULT_SETTINGS).map((x) => x.kind)).toEqual(['leave'])
  })
  it('nghỉ theo buổi vẫn khoá cả buổi', () => {
    const whole = { ...leave, lessonId: undefined, start: undefined, end: undefined }
    expect(leaveCovers(whole, b)).toBe(true)
    expect(leaveCovers(whole, lesson({ session: 'PM', start: '14:00', end: '14:35' }))).toBe(false)
  })
})

describe('sửa thông tin giáo viên', () => {
  const places = [{ name: 'Rạch Dừa', lat: 10.37, lng: 107.11 }, { name: 'Bà Rịa', lat: 10.5, lng: 107.17 }]
  it('Plus Code giải đúng như bản Python', () => {
    expect(decodePlusCode('J348+3JW')).toEqual({ lat: 10.605237, lng: 107.066578 })
    const q = decodePlusCode('H6H5+F84, Nghĩa Thành')!
    expect(q.lat).toBeCloseTo(10.578637, 5)
    expect(q.lng).toBeCloseTo(107.208328, 5)
    expect(decodePlusCode('12 Lê Lợi')).toBeNull()
  })
  it('định vị địa chỉ: Plus Code chính xác, tên phường gần đúng, kể cả viết sai dấu hay lỗi gõ', () => {
    expect(locateAddress('G6Q7+H58, Bà Rịa', places)).toMatchObject({ geo: { source: 'pluscode' }, area: 'Bà Rịa' })
    expect(locateAddress('1 Hàn Thuyên, P. Rach Dua', places)).toMatchObject({ geo: { source: 'ward', lat: 10.37 }, area: 'Rạch Dừa' })
    expect(locateAddress('32 Cao Bá Quát, Phường Rạch Rừa', places).area).toBe('Rạch Dừa')
    expect(locateAddress('Đâu đó', places)).toEqual({})
  })
  it('đổi địa chỉ thì định vị lại; không đổi địa chỉ thì giữ nguyên vị trí', () => {
    const t = teacher({ address: 'Cũ', homeGeo: { lat: 1, lng: 1, source: 'pluscode' }, homeArea: 'Cũ', phone: null })
    const same = applyProfile(t, { ...profileFrom(t), phone: '0901234567' }, places)
    expect(same.homeGeo).toEqual(t.homeGeo)
    expect(same.phone).toBe('0901234567')
    const moved = applyProfile(t, { ...profileFrom(t), address: '5 Lê Lợi, Rạch Dừa' }, places)
    expect(moved).toMatchObject({ homeArea: 'Rạch Dừa', homeGeo: { source: 'ward' } })
    const unknown = applyProfile(t, { ...profileFrom(t), address: 'Không rõ' }, places)
    expect(unknown.homeGeo).toBeUndefined()
  })
  it('chuyển nhà thì bỏ km từ nhà đã ghi của đúng người đó', () => {
    const d = { home: { 'A|s': 5, 'AB|s': 6 }, office: {}, pair: {} }
    expect(dropHomeKm(d, 'A').home).toEqual({ 'AB|s': 6 })
    const leg = (teacherId: string, start: 'N' | 'V') => ({ teacherId, date: 'd', session: 'AM' as const, period: 1, start, km: 1, cost: 0 })
    expect(dropHomeLegs([leg('A', 'N'), leg('A', 'V'), leg('B', 'N')], 'A').map((l) => l.start + l.teacherId)).toEqual(['VA', 'NB'])
  })
  it('kiểm tra dữ liệu nhập', () => {
    const d = profileFrom(teacher())
    expect(profileErrors({ ...d, name: ' ' })).toEqual(['Cần có họ tên'])
    expect(profileErrors({ ...d, name: 'A', phone: 'abc' })).toEqual(['Số điện thoại chưa đúng'])
    expect(profileErrors({ ...d, name: 'A', phone: '', maxKm: '-3' })).toHaveLength(1)
    expect(profileErrors({ ...d, name: 'A', phone: '0332 999 864', maxKm: '20' })).toEqual([])
  })
})

describe('đề xuất tối ưu trên dữ liệu thật', () => {
  const ctx = buildContext(week, world)
  const t0 = Date.now()
  const list = suggestOptimizations(ctx)
  const ms = Date.now() - t0
  const realCost = (lessons: Lesson[]) => {
    const c = buildContext({ ...week, lessons }, world)
    return world.teachers.reduce((sum, t) => sum + weekDatesOf(week.startDate).reduce((x, d) => x + deriveRoute(t, d, c.dayLessons.get(`${t.id}|${d}`) ?? [], week.id, [], c).cost, 0), 0)
  }
  it('chạy đủ nhanh và có đề xuất', () => {
    expect(list.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(4000)
  })
  it('không đề xuất nào làm phát sinh trùng lịch hay không kịp', () => {
    const before = weekIssues(ctx)
    for (const s of list) {
      const after = weekIssues(buildContext({ ...week, lessons: applyChanges(week.lessons, s.changes) }, world))
      expect(newIssues(before, after).filter((i) => ['overlap', 'travel', 'leave', 'uncovered'].includes(i.kind)), s.title).toEqual([])
    }
  })
  it('số tiết kiệm công bố đúng bằng chênh lệch chi phí thực tế', () => {
    const base = realCost(week.lessons)
    for (const s of list.filter((x) => x.kind !== 'fix')) {
      expect(base - realCost(applyChanges(week.lessons, s.changes)), s.title).toBe(s.saving)
    }
  })
  it('mỗi giáo viên chỉ một đề xuất nên cộng dồn được', () => {
    const ids = list.flatMap((s) => s.teacherIds)
    expect(new Set(ids).size).toBe(ids.length)
    const moves = list.filter((x) => x.kind !== 'fix')
    const all = moves.flatMap((s) => s.changes)
    expect(realCost(week.lessons) - realCost(applyChanges(week.lessons, all))).toBe(moves.reduce((a, s) => a + s.saving, 0))
  })
  it('không đề xuất nào làm ai tăng giảm quá nhiều ca', () => {
    for (const s of list) for (const l of s.load) expect(Math.abs(l.after - l.before), s.title).toBeLessThanOrEqual(MAX_LOAD_SHIFT)
  })
  it('không đề xuất nào làm giáo viên mất hết ca', () => {
    for (const s of list) for (const l of s.load) expect(l.after, s.title).toBeGreaterThan(0)
  })
  it('không làm xấu nguyện vọng, không giao cho GV chỉ làm online hoặc quản lý', () => {
    for (const s of list) {
      expect(s.prefGain).toBeGreaterThanOrEqual(0)
      for (const c of s.changes) {
        const t = ctx.teacherById.get(c.teacherId)!
        expect(t.onlineOnly || t.isManager).toBe(false)
      }
    }
  })
  it('tuần đã lưu trữ không có đề xuất', () => {
    const old = seed.weeks[0]
    expect(suggestOptimizations(buildContext(old, world))).toEqual([])
  })
  it('sửa được ca chưa có giáo viên', () => {
    const open = week.lessons.find((l) => l.status === 'assigned' && l.code === 'S')!
    const c = buildContext({ ...week, lessons: week.lessons.map((l) => (l.id === open.id ? { ...l, teacherId: null, originalTeacherId: open.teacherId, status: 'needs_cover' as const } : l)) }, world)
    const fix = suggestOptimizations(c).find((s) => s.kind === 'fix' && s.lessons[0].id === open.id)
    expect(fix).toBeTruthy()
    expect(fix!.changes[0].teacherId).not.toBe(open.teacherId)
  })
})

describe('mức độ đầy đủ thông tin', () => {
  it('liệt kê đúng thông tin giáo viên còn thiếu', () => {
    const t = teacher({ phone: null, address: null, areas: [], gender: null, track: null })
    expect(missingTeacherFields(t)).toEqual(['SĐT', 'Địa chỉ', 'Vị trí nhà', 'Năng lực', 'Khu vực mong muốn', 'Giới tính'])
    const full = teacher({ phone: '0901234567', address: 'A', homeGeo: { lat: 1, lng: 1, source: 'ward' }, areas: ['BÀ RỊA'], gender: 'F', track: 'TÍCH HỢP' })
    expect(missingTeacherFields(full)).toEqual([])
  })
  it('liệt kê đúng thông tin trường còn thiếu; vị trí gần đúng tính là thiếu', () => {
    const base = { ...seed.schools[0], address: 'A', geo: { lat: 1, lng: 1, source: 'pluscode' as const } }
    expect(missingSchoolFields(base, { office: { [`BR|${base.id}`]: 5 } })).toEqual([])
    expect(missingSchoolFields({ ...base, address: null, geo: { lat: 1, lng: 1, source: 'region' } }, { office: {} })).toEqual(['Địa chỉ', 'Toạ độ chính xác', 'Km từ văn phòng'])
  })
  it('sửa địa chỉ trường: Plus Code chính xác; địa chỉ chữ không làm mất toạ độ nhưng hạ xuống gần đúng', () => {
    const s = { ...seed.schools[0], geo: { lat: 1, lng: 1, source: 'street' as const } }
    expect(applySchoolAddress(s, 'J348+3JW, Phú Mỹ', []).geo).toMatchObject({ source: 'pluscode', lat: 10.605237 })
    expect(applySchoolAddress(s, '12 Đường Mới', []).geo).toMatchObject({ source: 'region', lat: 1 })
    expect(applySchoolAddress({ ...s, geo: { lat: 2, lng: 2, source: 'manual' } }, '12 Đường Mới', []).geo).toMatchObject({ source: 'manual', lat: 2 })
  })
  it('nhập toạ độ dạng số hoặc Plus Code', () => {
    expect(parseCoordinate('10.5, 107.1')).toEqual({ lat: 10.5, lng: 107.1 })
    expect(parseCoordinate('J348+3JW')).toMatchObject({ lat: 10.605237 })
    expect(parseCoordinate('abc')).toBeNull()
  })
})

describe('thêm giáo viên', () => {
  const list = [{ id: 'VT049' }, { id: 'VT001' }, { id: 'GV001' }, { id: 'CTVVT12' }]
  it('gợi ý mã kế tiếp sau mã lớn nhất', () => {
    expect(nextTeacherId(list)).toBe('VT050')
    expect(nextTeacherId([])).toBe('VT001')
  })
  it('chặn mã trống, sai định dạng, trùng (không phân biệt hoa thường)', () => {
    expect(teacherIdError('', list)).toBeTruthy()
    expect(teacherIdError('VT 50', list)).toBeTruthy()
    expect(teacherIdError('vt001', list)).toContain('đã có')
    expect(teacherIdError('VT050', list)).toBeNull()
  })
  it('hồ sơ mới đang hoạt động, định vị theo địa chỉ và được gợi ý dạy', () => {
    const places = [{ name: 'Phú Mỹ', lat: 10.6, lng: 107.05 }]
    const t = createTeacher('vt050', { ...emptyProfile('PM'), name: 'Mới', address: '1 Lê Lợi, Phú Mỹ', track: 'STEM/CDS/AI', areas: ['PHÚ MỸ'] }, places)
    expect(t).toMatchObject({ id: 'VT050', active: true, isNew: true, officeId: 'PM', homeArea: 'Phú Mỹ', homeGeo: { source: 'ward' } })
    const target = week.lessons.find((l) => l.status === 'assigned' && l.subject === 'STEM')!
    const ranked = rankCandidates({ ...target, teacherId: null, status: 'needs_cover' }, buildContext(week, { ...world, teachers: [...world.teachers, t] }))
    const me = ranked.find((c) => c.teacher.id === 'VT050')!
    expect(me.available).toBe(true)
    expect(me.taughtSubject).toBe(true)
  })
  it('CTV nhận đúng loại', () => {
    expect(createTeacher('CTVVT99', { ...emptyProfile('BR'), name: 'A' }, []).isCollaborator).toBe(true)
  })
})

describe('thêm trường', () => {
  const draft = (over = {}) => ({ name: 'TH Mới', region: 'Phú Mỹ', address: '', consultant: '', ...over })
  it('bắt buộc tên và khu vực', () => {
    expect(schoolDraftErrors(draft({ name: '', region: '' }), seed.schools)).toHaveLength(2)
    expect(schoolDraftErrors(draft(), seed.schools)).toEqual([])
  })
  it('chặn trùng trường kể cả khác dấu, hoa thường', () => {
    expect(schoolDraftErrors(draft({ name: 'th quang trung', region: 'phu my' }), seed.schools)[0]).toContain('Đã có trường')
  })
  it('trùng tên khác khu vực thì bắt buộc có địa chỉ', () => {
    const same = draft({ name: 'TH Quang Trung', region: 'Vũng Tàu' })
    expect(schoolDraftErrors(same, seed.schools)[0]).toContain('địa chỉ')
    expect(schoolDraftErrors({ ...same, address: '1 Lê Lợi' }, seed.schools)).toEqual([])
  })
  it('tạo trường: tên đầy đủ, mã không trùng, Plus Code cho vị trí chính xác', () => {
    expect(schoolFullName(draft())).toBe('TH Mới - Phú Mỹ')
    const s = createSchool(draft({ address: 'J348+3JW' }), seed.schools, [])
    expect(s).toMatchObject({ id: 'th-moi-phu-my', fullName: 'TH Mới - Phú Mỹ', isNew: true, geo: { source: 'pluscode' } })
    expect(createSchool(draft(), [...seed.schools, s], []).id).toBe('th-moi-phu-my-2')
  })
  it('trường mới chưa có ca không vào danh sách số ca nhưng thêm ca được', () => {
    const s = createSchool(draft(), seed.schools, [])
    expect(schoolLoad(week.lessons).has(s.id)).toBe(false)
    expect(newLesson('n', week.id, s.id, { date: '2026-11-02', start: '08:00', end: '08:35', className: '1A', subject: 'STEM', teacherId: '', note: '' }).schoolId).toBe(s.id)
  })
})

describe('phân biệt sáng và chiều trên lịch', () => {
  const am = { startMin: 7 * 60 + 15, endMin: 7 * 60 + 55 }
  const pm = { startMin: 14 * 60, endMin: 14 * 60 + 35 }
  it('12:00 đúng là mốc chuyển buổi', () => {
    expect([isMorning(11 * 60 + 45), isMorning(12 * 60), isMorning(13 * 60)]).toEqual([true, false, false])
  })
  it('có cả hai buổi khi lịch có ca sáng và chiều, dù khoảng nghỉ trưa bị thu gọn', () => {
    expect(sessionBands(buildAxis([am, pm])).map((b) => b.session)).toEqual(['AM', 'PM'])
  })
  it('chỉ có một buổi thì chỉ hiện buổi đó', () => {
    expect(sessionBands(buildAxis([am])).map((b) => b.session)).toEqual(['AM'])
    expect(sessionBands(buildAxis([pm])).map((b) => b.session)).toEqual(['PM'])
  })
  it('ca vắt qua trưa được chia đúng ở 12:00', () => {
    const bands = sessionBands(buildAxis([{ startMin: 11 * 60 + 30, endMin: 12 * 60 + 30 }]))
    expect(bands).toEqual([{ session: 'AM', from: 11 * 60 + 30, to: 12 * 60 }, { session: 'PM', from: 12 * 60, to: 12 * 60 + 30 }])
  })
  it('khoảng trống trong cùng buổi không tách thành hai dải', () => {
    const bands = sessionBands(buildAxis([am, { startMin: 10 * 60, endMin: 10 * 60 + 35 }]))
    expect(bands.map((b) => b.session)).toEqual(['AM'])
    expect(bands[0].to).toBe(10 * 60 + 45)
  })
})

describe('giải thích chi phí khi đổi giáo viên', () => {
  const [a, b] = seed.schools.filter((s) => isPrecise(s.geo))
  const A = teacher({ id: 'A', name: 'Cô A', officeId: 'BR' })
  const B = teacher({ id: 'B', name: 'Cô B', officeId: 'BR' })
  const dist = { home: { [`A|${a.id}`]: 20, [`B|${a.id}`]: 13, [`B|${b.id}`]: 30 }, office: { [`BR|${a.id}`]: 18 }, pair: { [[a.id, b.id].sort().join('|')]: 8 } }
  const ctxOf = (lessons: Lesson[], legs: typeof week.legs = []) => buildContext({ ...week, lessons, legs }, { ...world, teachers: [...world.teachers, A, B], distances: dist })
  const am = lesson({ id: 'x', teacherId: 'A', schoolId: a.id })
  const texts = (r: ReturnType<typeof explainLessonChange>, id: string) => r.changes.find((c) => c.teacherId === id)!.reasons.join(' ')

  it('giảm: giáo viên mới ở gần hơn thuộc bậc rẻ hơn', () => {
    const r = explainLessonChange(am, reassign(am, 'B'), ctxOf([am]))
    expect(r.changes.find((c) => c.teacherId === 'A')!.delta).toBe(-40000)
    expect(r.changes.find((c) => c.teacherId === 'B')!.delta).toBe(30000)
    expect(r).toMatchObject({ total: -10000, verdict: 'down' })
    expect(texts(r, 'A')).toContain('giảm 40.000đ')
    expect(texts(r, 'B')).toContain('bậc 12–18 km: 30.000đ')
  })
  it('tăng: người mới phải đi thêm chặng giữa hai trường', () => {
    const other = lesson({ id: 'y', teacherId: 'B', schoolId: b.id, start: '06:00', end: '06:35' })
    const c = ctxOf([am, other])
    const stay = lesson({ id: 'z', teacherId: 'A', schoolId: a.id, start: '09:00', end: '09:35', className: '2A' })
    const r = explainLessonChange(stay, reassign(stay, 'B'), ctxOf([am, stay, other]))
    expect(c.week.lessons).toHaveLength(2)
    expect(r.changes.find((x) => x.teacherId === 'A')!.delta).toBe(0)
    expect(texts(r, 'A')).toContain('vẫn còn ca khác')
    expect(r.verdict).toBe('up')
    expect(texts(r, 'B')).toContain('Thêm chặng')
  })
  it('giữ nguyên: người mới đã có ca tại trường, người cũ vẫn còn ca', () => {
    const mine = lesson({ id: 'm', teacherId: 'A', schoolId: a.id, start: '09:00', end: '09:35', className: '2A' })
    const hers = lesson({ id: 'h', teacherId: 'B', schoolId: a.id, start: '07:30', end: '08:05', className: '3A' })
    const r = explainLessonChange(mine, reassign(mine, 'B'), ctxOf([am, mine, hers]))
    expect(r).toMatchObject({ total: 0, verdict: 'same' })
    expect(texts(r, 'B')).toContain('đã có ca khác')
    expect(r.summary).toContain('Không ai')
  })
  it('giữ nguyên do bù trừ: nói rõ hai bên ngược chiều', () => {
    const dist2 = { home: { [`A|${a.id}`]: 13, [`B|${a.id}`]: 13 }, office: {}, pair: {} }
    const r = explainLessonChange(am, reassign(am, 'B'), buildContext({ ...week, lessons: [am], legs: [] }, { ...world, teachers: [...world.teachers, A, B], distances: dist2 }))
    expect(r).toMatchObject({ total: 0, verdict: 'same' })
    expect(r.summary).toContain('bù trừ')
  })
  it('nói rõ khi điểm xuất phát đổi giữa nhà và văn phòng', () => {
    const morning = lesson({ id: 'm', teacherId: 'A', schoolId: a.id })
    const afternoon = lesson({ id: 'p', teacherId: 'A', schoolId: a.id, session: 'PM', start: '14:00', end: '14:35', className: '2A' })
    const r = explainLessonChange(morning, reassign(morning, 'B'), ctxOf([morning, afternoon]))
    expect(texts(r, 'A')).toContain('xuất phát từ văn phòng')
  })
  it('dưới bậc thấp nhất thì nói không tính tiền', () => {
    expect(tierText('N', 8, DEFAULT_SETTINGS)).toBe('dưới 12 km nên không tính tiền')
    expect(tierText('V', 30, DEFAULT_SETTINGS)).toBe('bậc từ 30 km trở lên: 110.000đ')
  })
  it('ca chưa có người nhận thì chỉ tính người mới', () => {
    const open = lesson({ id: 'o', teacherId: null, originalTeacherId: 'A', status: 'needs_cover', schoolId: a.id })
    const r = explainLessonChange(open, reassign(open, 'B'), ctxOf([open]))
    expect(r.changes.map((c) => c.teacherId)).toEqual(['B'])
  })
  it('đổi ngày tính cả ngày cũ và ngày mới của cùng giáo viên', () => {
    const later = applyDraft(am, { ...draftFrom(am), date: '2026-11-03' })
    const r = explainLessonChange(am, later, ctxOf([am]))
    expect(r.changes.map((c) => c.date).sort()).toEqual(['2026-11-02', '2026-11-03'])
    expect(r.total).toBe(0)
  })
  it('số giải thích khớp đúng chênh lệch bảng chi phí trên lịch thật, và khớp số ở dropdown', () => {
    const ctx = buildContext(week, world)
    const samples = week.lessons.filter((l) => l.status === 'assigned' && l.teacherId && l.code === 'S').filter((_, i) => i % 7 === 0).slice(0, 25)
    for (const l of samples) {
      for (const cand of rankCandidates({ ...l, teacherId: null, status: 'needs_cover' }, ctx).filter((c) => c.available).slice(0, 2)) {
        const r = explainLessonChange(l, reassign(l, cand.teacher.id), ctx)
        const nextWeek = { ...week, lessons: week.lessons.map((x) => (x.id === l.id ? reassign(x, cand.teacher.id) : x)) }
        const c2 = buildContext(nextWeek, world)
        const costOf = (w: typeof week, c: typeof ctx, id: string) => routeForWeek(w, c.teacherById.get(id)!, l.date, c).cost
        const real = [l.teacherId!, cand.teacher.id].reduce((s, id) => s + costOf(nextWeek, c2, id) - costOf(week, ctx, id), 0)
        expect(r.total, `${l.id} -> ${cand.teacher.id}`).toBe(real)
        expect(r.changes.find((x) => x.teacherId === cand.teacher.id)!.delta).toBe(cand.extraCost)
      }
    }
  })
})

describe('so dữ liệu hiện tại với bản mới nhất', () => {
  const base = { teachers: seed.teachers, schools: seed.schools, leaves: seed.leaves, weeks: seed.weeks, kmOverrides: {}, settings: DEFAULT_SETTINGS, distances: seed.distances }
  it('chưa sửa gì thì không có khác biệt', () => {
    expect(dataDiff(base, seed, DEFAULT_SETTINGS)).toEqual([])
  })
  it('liệt kê đúng từng loại thay đổi', () => {
    const w = seed.weeks.at(-1)!
    const changed = {
      ...base,
      teachers: [...seed.teachers.map((t) => (t.id === 'VT001' ? { ...t, phone: '0901234567' } : t)), teacher({ id: 'VT999', isNew: true })],
      schools: seed.schools.slice(1),
      leaves: seed.leaves.slice(2),
      weeks: [...seed.weeks.map((x) => (x.id === w.id ? { ...x, lessons: x.lessons.map((l, i) => (i < 3 ? { ...l, teacherId: 'VT001' } : l)).slice(1) } : x)), { ...w, id: '2026-11-09' }],
      kmOverrides: { a: 1 },
      settings: { ...DEFAULT_SETTINGS, ratePerKm: 1 },
    }
    const text = dataDiff(changed, seed, DEFAULT_SETTINGS).join(' | ')
    expect(text).toContain('1 giáo viên thêm mới')
    expect(text).toContain('1 giáo viên đã sửa')
    expect(text).toContain('1 trường bị thiếu')
    expect(text).toContain('1 tuần tạo thêm')
    expect(text).toContain('lịch tuần')
    expect(text).toContain('2 ngày nghỉ')
    expect(text).toContain('1 số km sửa tay')
    expect(text).toContain('Cấu hình')
  })
})

describe('số km đã ghi không phụ thuộc vị trí tiết', () => {
  const [a] = seed.schools.filter((s) => isPrecise(s.geo))
  const T = teacher({ id: 'T', name: 'T', homeGeo: undefined })
  const leg = { teacherId: 'T', date: '2026-11-02', session: 'AM' as const, period: 1, start: 'N' as const, km: 20, cost: 40000, toSchoolId: a.id }
  const ctx = buildContext({ ...week, lessons: [], legs: [leg] }, { ...world, teachers: [...world.teachers, T] })
  it('bỏ ca đầu ngày nhưng vẫn tới cùng trường thì quãng đường và tiền không đổi', () => {
    const later = lesson({ id: 'b', schoolId: a.id, period: 3, start: '09:00', end: '09:35' })
    const r = deriveRoute(T, '2026-11-02', [later], week.id, [leg], ctx)
    expect(r.legs[0]).toMatchObject({ km: 20, source: 'recorded', cost: 40000 })
  })
  it('đi tới trường khác thì không dùng số km của trường cũ', () => {
    const other = seed.schools.find((s) => s.id !== a.id)!
    const r = deriveRoute(T, '2026-11-02', [lesson({ id: 'b', schoolId: other.id })], week.id, [leg], ctx)
    expect(r.legs[0].source).not.toBe('recorded')
  })
  it('bản lưu cũ chưa có trường đến vẫn khớp theo vị trí tiết', () => {
    const { toSchoolId: _, ...old } = leg
    const r = deriveRoute(T, '2026-11-02', [lesson({ id: 'b', schoolId: a.id })], week.id, [old], ctx)
    expect(r.legs[0].km).toBe(20)
  })
  it('seed đã có trường đến cho gần như mọi chặng', () => {
    const legs = seed.weeks.flatMap((w) => w.legs)
    expect(legs.filter((l) => l.toSchoolId).length / legs.length).toBeGreaterThan(0.95)
  })
})

describe('gợi ý xếp ca trống của trường', () => {
  const schoolId = 'th-quang-trung-phu-my'
  // Tạo ca trống thật: chuyển mọi ca của một GV tại trường sang cần người thay.
  const vacate = (teacherId: string, filter: (l: Lesson) => boolean = () => true) => ({
    ...week,
    lessons: week.lessons.map((l) => (l.schoolId === schoolId && l.teacherId === teacherId && l.status === 'assigned' && filter(l) ? { ...l, teacherId: null, originalTeacherId: teacherId, status: 'needs_cover' as const } : l)),
  })
  const costOfWeek = (w: typeof week, ctx: ReturnType<typeof buildContext>) => world.teachers.reduce((s, t) => s + weekDatesOf(w.startDate).reduce((x, d) => x + routeForWeek(w, t, d, ctx).cost, 0), 0)
  const owner = week.lessons.find((l) => l.schoolId === schoolId && l.status === 'assigned' && l.code === 'S')!.teacherId!
  const tue = (l: Lesson) => l.date === '2026-11-03'
  const w = vacate(owner, tue)
  const ctx = buildContext(w, world)
  const opts = coverOptions(schoolId, ctx)

  it('không có ca trống thì không có gợi ý', () => {
    expect(coverOptions(schoolId, buildContext(week, world)).plans).toEqual([])
  })
  it('có đủ ca trống và đều có phương án', () => {
    expect(opts.open.length).toBeGreaterThan(1)
    expect(opts.plans.length).toBeGreaterThan(0)
    expect(new Set(opts.plans.flatMap((p) => p.goals))).toEqual(new Set(['fewest', 'cheapest', 'best-fit']))
  })
  it('mỗi phương án xếp mỗi ca đúng một lần', () => {
    for (const p of [...opts.plans, ...opts.soloPlans]) {
      const ids = p.changes.map((c) => c.lessonId)
      expect(new Set(ids).size).toBe(ids.length)
      expect([...ids, ...p.uncovered.map((l) => l.id)].sort()).toEqual(opts.open.map((l) => l.id).sort())
    }
  })
  it('áp dụng không phát sinh trùng lịch hay không kịp, và số tiền khớp bảng chi phí', () => {
    const before = weekIssues(ctx)
    for (const p of [...opts.plans, ...opts.soloPlans]) {
      const after = { ...w, lessons: applyChanges(w.lessons, p.changes) }
      const c2 = buildContext(after, world)
      expect(newIssues(before, weekIssues(c2)).filter((i) => ['overlap', 'travel', 'leave'].includes(i.kind))).toEqual([])
      expect(costOfWeek(after, c2) - costOfWeek(w, ctx)).toBe(p.extraCost)
    }
  })
  it('đúng thứ bậc: phương án ít người không nhiều người hơn, phương án rẻ không đắt hơn', () => {
    const covered = opts.plans.filter((p) => !p.uncovered.length)
    const fewest = covered.find((p) => p.goals.includes('fewest'))!
    const cheapest = covered.find((p) => p.goals.includes('cheapest'))!
    for (const p of covered) {
      expect(fewest.shares.length).toBeLessThanOrEqual(p.shares.length)
      expect(cheapest.extraCost).toBeLessThanOrEqual(p.extraCost)
    }
    for (const p of opts.soloPlans) expect(cheapest.extraCost).toBeLessThanOrEqual(p.extraCost)
    if (opts.soloPlans.length) expect(fewest.shares.length).toBe(1)
  })
  it('nhãn luôn đúng khi nhiều giáo viên cùng nghỉ: không phương án nào rẻ hơn "tiết kiệm nhất" hay ít người hơn "ít giáo viên nhất"', () => {
    const owners = [...new Set(week.lessons.filter((l) => l.schoolId === schoolId && l.teacherId && tue(l)).map((l) => l.teacherId!))]
    for (const n of [1, 2, 3, owners.length]) {
      const gone = new Set(owners.slice(0, n))
      const wk = { ...week, lessons: week.lessons.map((l) => (l.schoolId === schoolId && tue(l) && l.teacherId && gone.has(l.teacherId) && l.status === 'assigned' ? { ...l, teacherId: null, originalTeacherId: l.teacherId, status: 'needs_cover' as const } : l)) }
      const r = coverOptions(schoolId, buildContext(wk, world))
      const all = [...r.plans, ...r.soloPlans]
      const covered = all.filter((p) => !p.uncovered.length)
      const of = (g: 'fewest' | 'cheapest' | 'best-fit') => r.plans.find((p) => p.goals.includes(g))!
      expect(new Set(r.plans.flatMap((p) => p.goals)).size).toBe(3)
      if (covered.length) {
        expect(of('cheapest').uncovered).toEqual([])
        for (const p of covered) {
          expect(of('cheapest').extraCost, `n=${n}`).toBeLessThanOrEqual(p.extraCost)
          expect(of('fewest').shares.length, `n=${n}`).toBeLessThanOrEqual(p.shares.length)
        }
      }
    }
  })
  it('giáo viên nhận hết danh sách là một người, rẻ trước; không có GV gốc, online, quản lý', () => {
    expect(opts.soloPlans.every((p) => p.shares.length === 1 && p.uncovered.length === 0)).toBe(true)
    const costs = opts.soloPlans.map((p) => p.extraCost)
    expect(costs).toEqual([...costs].sort((a, b) => a - b))
    for (const p of [...opts.plans, ...opts.soloPlans]) {
      for (const s of p.shares) {
        const t = ctx.teacherById.get(s.teacherId)!
        expect(t.id).not.toBe(owner)
        expect(t.onlineOnly || t.isManager).toBe(false)
      }
    }
  })
  it('hai ca trùng giờ thì không một người nào nhận hết, cần ít nhất hai người', () => {
    const [a] = seed.schools.filter((s) => s.geo)
    const x = lesson({ id: 'p1', teacherId: null, status: 'needs_cover', schoolId: a.id, className: '1A' })
    const y = lesson({ id: 'p2', teacherId: null, status: 'needs_cover', schoolId: a.id, className: '1B' })
    const r = coverOptions(a.id, buildContext({ ...week, lessons: [x, y], legs: [] }, world))
    expect(r.soloPlans).toEqual([])
    expect(r.plans.find((p) => p.goals.includes('fewest'))!.shares.length).toBe(2)
  })
  it('kết quả tối ưu với bài nhỏ: khớp vét cạn về chi phí', () => {
    const [a] = seed.schools.filter((s) => isPrecise(s.geo))
    const lessons = [
      lesson({ id: 'q1', teacherId: null, status: 'needs_cover', schoolId: a.id, className: '1A' }),
      lesson({ id: 'q2', teacherId: null, status: 'needs_cover', schoolId: a.id, className: '1B', start: '09:00', end: '09:35' }),
      lesson({ id: 'q3', teacherId: null, status: 'needs_cover', schoolId: a.id, className: '1C', session: 'PM', start: '14:00', end: '14:35' }),
    ]
    const c = buildContext({ ...week, lessons, legs: [] }, world)
    const r = coverOptions(a.id, c)
    const teachersOk = world.teachers.filter((t) => t.active && !t.isManager && !t.onlineOnly).slice(0, 12)
    let best = Infinity
    for (const t1 of teachersOk) for (const t2 of teachersOk) for (const t3 of teachersOk) {
      const cost = [t1, t2, t3].filter((t, i, arr) => arr.indexOf(t) === i).reduce((s, t) => {
        const mine = lessons.filter((_, i) => [t1, t2, t3][i] === t).map((l) => ({ ...l, teacherId: t.id, status: 'assigned' as const }))
        return s + deriveRoute(t, '2026-11-02', mine, week.id, [], c).cost
      }, 0)
      best = Math.min(best, cost)
    }
    const cheapest = r.plans.find((p) => p.goals.includes('cheapest'))!
    expect(cheapest.extraCost).toBeLessThanOrEqual(best)
  })
  it('trường đông ca bị trống nhiều vẫn chạy đủ nhanh', () => {
    const big = { ...week, lessons: week.lessons.map((l) => (l.schoolId === schoolId && l.status === 'assigned' ? { ...l, teacherId: null, originalTeacherId: l.teacherId, status: 'needs_cover' as const } : l)) }
    const c = buildContext(big, world)
    expect(openLessons(c, schoolId).length).toBeGreaterThan(60)
    const t0 = Date.now()
    coverOptions(schoolId, c)
    expect(Date.now() - t0).toBeLessThan(5000)
  })
})
