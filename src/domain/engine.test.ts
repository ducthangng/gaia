import { describe, expect, it } from 'vitest'
import seedJson from '../data/seed.json'
import { buildContext, type World } from './context'
import { blockers, preferenceViolations } from './constraints'
import { weekIssues } from './issues'
import { rankCandidates } from './recommend'
import { deriveRoute, legCost, recordedRoute, tally } from './route'
import { cloneWeek } from './weeks'
import { DEFAULT_SETTINGS, type Lesson, type Seed, type Teacher } from './types'

const seed = seedJson as unknown as Seed
const world: World = { ...seed, settings: DEFAULT_SETTINGS, kmOverrides: {} }
const lesson = (over: Partial<Lesson>): Lesson => ({
  id: 'x', weekId: 'w', teacherId: null, originalTeacherId: null, schoolId: seed.schools[0].id, date: '2026-11-02', session: 'AM', period: 1, track: 0,
  className: '1A', subject: 'STEM', start: '07:30', end: '08:05', code: 'S', company: null, note: null, type: 'regular', status: 'assigned', ...over,
})
const teacher = (over: Partial<Teacher> = {}): Teacher => ({ ...seed.teachers[0], preferences: [], maxKm: null, ...over })

describe('biểu giá theo bậc của workbook', () => {
  it.each([
    ['N', 11, 0], ['N', 12, 30000], ['N', 17, 30000], ['N', 18, 40000], ['N', 24, 60000], ['N', 30, 80000],
    ['V', 6, 0], ['V', 7, 30000], ['V', 12, 40000], ['V', 18, 60000], ['V', 24, 80000], ['V', 30, 110000], ['K', 7, 30000],
  ] as const)('%s %d km = %dđ', (start, km, amount) => {
    expect(legCost(start, km, DEFAULT_SETTINGS)).toBe(amount)
  })

  it('tái tạo đúng từng chặng đã ghi trong workbook', () => {
    const legs = seed.weeks.flatMap((w) => w.legs)
    const wrong = legs.filter((l) => legCost(l.start, l.km, DEFAULT_SETTINGS) !== l.cost)
    // 1 ô THÀNH TIỀN trong workbook bị sửa tay.
    expect(wrong.length).toBeLessThanOrEqual(1)
    expect(legs.length).toBeGreaterThan(800)
  })

  it('tổng chi phí đã lưu trữ khớp cột CTP của từng GV', () => {
    for (const w of seed.weeks) {
      const ctx = buildContext(w, world)
      for (const t of seed.teachers) {
        const reported = w.reported?.[t.id]
        if (!reported) continue
        const total = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(Date.parse(w.startDate) + i * 86400000).toISOString().slice(0, 10)
          if (w.reportedFrom && d < w.reportedFrom) return 0
          const all = w.lessons.filter((l) => l.date === d && (l.teacherId === t.id || l.originalTeacherId === t.id))
          return recordedRoute(t, d, all, w.legs.filter((x) => x.teacherId === t.id && x.date === d), ctx).cost
        }).reduce((a, b) => a + b, 0)
        expect(total, `${w.id} ${t.id}`).toBe(reported.cost)
      }
    }
  })
})

describe('suy lộ trình theo quy tắc', () => {
  const ctx = buildContext(seed.weeks.at(-1)!, world)
  const [a, b] = seed.schools.filter((s) => !s.isExternal)
  const t = seed.teachers.find((x) => x.active)!

  it('có ca sáng: xuất phát từ Nhà', () => {
    const r = deriveRoute(t, '2026-11-02', [lesson({ teacherId: t.id, schoolId: a.id })], 'w', [], ctx)
    expect(r.legs.map((l) => l.start)).toEqual(['N'])
  })
  it('chỉ có ca chiều: xuất phát từ Văn phòng', () => {
    const r = deriveRoute(t, '2026-11-02', [lesson({ teacherId: t.id, schoolId: a.id, session: 'PM', start: '14:00', end: '14:35' })], 'w', [], ctx)
    expect(r.legs.map((l) => l.start)).toEqual(['V'])
  })
  it('cùng trường sáng chiều: một chặng; đổi trường: thêm chặng K; luôn về Nhà', () => {
    const am = lesson({ id: '1', teacherId: t.id, schoolId: a.id })
    const same = deriveRoute(t, '2026-11-02', [am, lesson({ id: '2', teacherId: t.id, schoolId: a.id, session: 'PM', start: '14:00', end: '14:35' })], 'w', [], ctx)
    expect(same.legs.length).toBe(1)
    const diff = deriveRoute(t, '2026-11-02', [am, lesson({ id: '2', teacherId: t.id, schoolId: b.id, session: 'PM', start: '14:00', end: '14:35' })], 'w', [], ctx)
    expect(diff.legs.map((l) => l.start)).toEqual(['N', 'K'])
    expect(diff.returnKm).toBeGreaterThan(0)
    expect(diff.totalKm).toBe(diff.legs[0].km + diff.legs[1].km + diff.returnKm)
  })
  it('ca nghỉ / trường báo nghỉ không phát sinh chặng', () => {
    const r = deriveRoute(t, '2026-11-02', [lesson({ teacherId: t.id, status: 'school_off' })], 'w', [], ctx)
    expect(r.legs).toEqual([])
    expect(r.cost).toBe(0)
  })
  it('công thức km × đơn giá của tài liệu tính cả chặng về nhà', () => {
    const c2 = { ...ctx, settings: { ...DEFAULT_SETTINGS, costPolicy: 'perKm' as const, ratePerKm: 1000, longRouteKm: 1e9 } }
    const r = deriveRoute(t, '2026-11-02', [lesson({ teacherId: t.id, schoolId: a.id })], 'w', [], c2)
    expect(r.cost).toBe(r.totalKm * 1000)
  })
  it('mức độ khớp với xuất phát & số km Gaia đã ghi', () => {
    let match = 0
    let total = 0
    for (const w of seed.weeks) {
      const c = buildContext(w, world)
      for (const leg of w.legs) {
        total++
        const tt = c.teacherById.get(leg.teacherId)!
        const day = c.dayLessons.get(`${leg.teacherId}|${leg.date}`) ?? []
        const r = deriveRoute(tt, leg.date, day, w.id, [], c)
        if (r.legs.some((x) => x.session === leg.session && x.period === leg.period && x.start === leg.start)) match++
      }
    }
    console.log(`Suy đúng điểm xuất phát: ${match}/${total} = ${((match / total) * 100).toFixed(1)}%`)
    expect(match / total).toBeGreaterThan(0.85)
  })
})

describe('độ chính xác của chi phí dự kiến', () => {
  it('trên các tuần đã hoàn tất, chi phí suy ra lệch dưới 7% và không phát sinh thừa chặng', () => {
    for (const w of seed.weeks.filter((x) => x.status === 'archived')) {
      const c = buildContext(w, world)
      let cost = 0
      let legs = 0
      for (const t of seed.teachers) {
        for (const d of new Set(w.lessons.map((l) => l.date))) {
          const r = deriveRoute(t, d, c.dayLessons.get(`${t.id}|${d}`) ?? [], w.id, [], c)
          cost += r.cost
          legs += r.legs.length
        }
      }
      const recorded = w.legs.reduce((s, l) => s + l.cost, 0)
      expect(Math.abs(cost - recorded) / recorded, w.id).toBeLessThan(0.07)
      expect(Math.abs(legs - w.legs.length) / w.legs.length, w.id).toBeLessThan(0.05)
    }
  })
})

describe('tiết quy đổi', () => {
  it('khớp cột tổng tiết của workbook trên hầu hết GV', () => {
    let ok = 0
    let n = 0
    for (const w of seed.weeks) {
      for (const [id, r] of Object.entries(w.reported ?? {})) {
        n++
        const got = tally(w.lessons.filter((l) => l.teacherId === id))
        if (Math.floor(r.kns) === got.kns && Math.floor(r.stem) === got.stem && Math.floor(r.cds) === got.cds) ok++
      }
    }
    console.log(`Tiết quy đổi khớp: ${ok}/${n}`)
    expect(ok / n).toBeGreaterThan(0.85)
  })
})

describe('ràng buộc', () => {
  const ctx = buildContext(seed.weeks.at(-1)!, world)
  const schools = seed.schools
  it('đón con trước 16:00 chặn ca kết thúc 16:25 nhưng không chặn ca 15:30', () => {
    const t = teacher({ preferences: [{ id: 'p', type: 'finishBy', time: '16:00' }] })
    expect(preferenceViolations(t, lesson({ session: 'PM', end: '16:25' }), undefined)).toHaveLength(1)
    expect(preferenceViolations(t, lesson({ session: 'PM', end: '15:30' }), undefined)).toHaveLength(0)
  })
  it('nguyện vọng theo ngày chỉ áp dụng ngày đã chọn', () => {
    const t = teacher({ preferences: [{ id: 'p', type: 'noSession', session: 'PM', days: [4] }] })
    expect(preferenceViolations(t, lesson({ session: 'PM', date: '2026-11-02' }), undefined)).toHaveLength(0)
    expect(preferenceViolations(t, lesson({ session: 'PM', date: '2026-11-06' }), undefined)).toHaveLength(1)
  })
  it('phạm vi km và giới tính', () => {
    const t = teacher({ maxKm: 10, gender: 'M' })
    const school = { ...schools[0], genderPreference: 'F' as const }
    expect(preferenceViolations(t, lesson({}), school, 20).map((v) => v.label)).toHaveLength(2)
  })
  it('giới tính chưa khai báo thì không suy đoán, không vi phạm', () => {
    expect(preferenceViolations(teacher({ gender: null }), lesson({}), { ...schools[0], genderPreference: 'F' })).toHaveLength(0)
  })
  it('trùng giờ, nghỉ phép và không kịp di chuyển đều bị chặn', () => {
    const t = teacher()
    const target = lesson({ id: 't', schoolId: schools[0].id, start: '08:10', end: '08:45' })
    const overlap = lesson({ id: 'o', teacherId: t.id, schoolId: schools[0].id, start: '08:00', end: '08:20' })
    expect(blockers(t, target, [overlap], [], ctx.book, DEFAULT_SETTINGS).map((b) => b.kind)).toEqual(['overlap'])
    const justBefore = lesson({ id: 'o', teacherId: t.id, schoolId: schools[1].id, start: '07:30', end: '08:05' })
    expect(blockers(t, target, [justBefore], [], ctx.book, DEFAULT_SETTINGS).map((b) => b.kind)).toEqual(['travel'])
    const sameSchool = lesson({ id: 'o', teacherId: t.id, schoolId: schools[0].id, start: '07:30', end: '08:05' })
    expect(blockers(t, target, [sameSchool], [], ctx.book, DEFAULT_SETTINGS)).toEqual([])
    const leave = { id: 'l', teacherId: t.id, date: target.date, session: target.session, kind: 'leave' as const, note: 'Nghỉ' }
    expect(blockers(t, target, [], [leave], ctx.book, DEFAULT_SETTINGS).map((b) => b.kind)).toEqual(['leave'])
  })
})

describe('đề xuất giáo viên', () => {
  const w = seed.weeks.at(-1)!
  const ctx = buildContext(w, world)
  const target = w.lessons.find((l) => l.status === 'assigned' && l.subject === 'STEM' && l.teacherId)!
  const open = { ...target, teacherId: null, status: 'needs_cover' as const, originalTeacherId: target.teacherId }
  const ranked = rankCandidates(open, ctx)
  it('không đề xuất GV gốc, GV rảnh luôn đứng trước GV bận', () => {
    expect(ranked.some((c) => c.teacher.id === target.teacherId)).toBe(false)
    const firstBusy = ranked.findIndex((c) => !c.available)
    if (firstBusy >= 0) expect(ranked.slice(firstBusy).every((c) => !c.available)).toBe(true)
  })
  it('điểm nằm trong 0-100 và GV Refer được cộng điểm', () => {
    expect(ranked.every((c) => c.score >= 0 && c.score <= 100)).toBe(true)
    const c = ranked[0]
    const withRefer = rankCandidates(open, buildContext(w, { ...world, schools: world.schools.map((s) => s.id === open.schoolId ? { ...s, referredTeacherIds: [...s.referredTeacherIds, c.teacher.id] } : { ...s }) }))
    const without = rankCandidates(open, buildContext(w, { ...world, schools: world.schools.map((s) => s.id === open.schoolId ? { ...s, referredTeacherIds: s.referredTeacherIds.filter((x) => x !== c.teacher.id) } : s) }))
    expect(withRefer.find((x) => x.teacher.id === c.teacher.id)!.score).toBeGreaterThan(without.find((x) => x.teacher.id === c.teacher.id)!.score)
  })
})

describe('tuần & cảnh báo', () => {
  const w = seed.weeks.at(-1)!
  it('sao chép tuần giữ lớp cố định, dời ngày, GV nghỉ thành cần cover', () => {
    let n = 0
    const src = w.lessons.find((l) => l.status === 'assigned' && l.type === 'regular' && l.code === 'S')!
    const leave = { id: 'x', teacherId: src.teacherId!, date: '2026-11-09', session: src.session, kind: 'leave' as const, note: '' }
    const c = cloneWeek({ ...w, lessons: [{ ...src, date: '2026-11-02' }] }, '2026-11-09', [leave], () => `n${++n}`)
    expect(c.lessons).toHaveLength(1)
    expect(c.lessons[0].date).toBe('2026-11-09')
    expect(c.lessons[0].status).toBe('needs_cover')
    expect(c.lessons[0].originalTeacherId).toBe(src.teacherId)
  })
  it('ca dạy thay khi sao chép quay về GV gốc; ca chuyên đề không sao chép', () => {
    const base = lesson({ teacherId: 'B', originalTeacherId: 'A', type: 'substitute', schoolId: 's' })
    const c = cloneWeek({ ...w, lessons: [base, lesson({ id: 'e', type: 'event', code: 'BCTH', teacherId: 'B' })] }, '2026-11-09', [], () => 'n')
    expect(c.lessons).toHaveLength(1)
    expect(c.lessons[0].teacherId).toBe('A')
    expect(c.lessons[0].originalTeacherId).toBeNull()
  })
  it('ca chưa có GV và ngoài Refer đều phát cảnh báo', () => {
    const school = seed.schools[0]
    const week = { ...w, lessons: [lesson({ id: 'a', status: 'needs_cover', schoolId: school.id }), lesson({ id: 'b', teacherId: 'ZZZ', schoolId: school.id })] }
    const t2 = teacher({ id: 'ZZZ', active: true })
    const issues = weekIssues(buildContext(week, { ...world, teachers: [...world.teachers, t2], schools: world.schools.map((s) => (s.id === school.id ? { ...s, referredTeacherIds: [] } : s)) }))
    expect(issues.map((i) => i.kind).sort()).toEqual(['refer', 'uncovered'])
  })
})
