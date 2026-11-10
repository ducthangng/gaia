import { describe, expect, it } from 'vitest'
import { compareWeeks, pairLessons } from './week-compare'
import type { Lesson, Week } from './types'

const lesson = (over: Partial<Lesson>): Lesson => ({
  id: 'x', weekId: 'w', teacherId: 'T1', originalTeacherId: null, schoolId: 'S1', date: '2026-11-02', session: 'AM', period: 1, track: 0,
  className: '1A', subject: 'STEM', start: '07:30', end: '08:05', code: 'S', company: null, note: null, type: 'regular', status: 'assigned', ...over,
})
const week = (id: string, lessons: Lesson[]): Week => ({ id, label: id, startDate: id, endDate: id, status: 'planning', lessons, legs: [] })

// Tuần A bắt đầu 02/11, tuần B 09/11: cùng thứ thì lệch đúng 7 ngày.
const A = '2026-11-02'
const B = '2026-11-09'

describe('so sánh hai tuần', () => {
  it('ghép ca cùng thứ, cùng lớp dù khác ngày lịch', () => {
    const pairs = pairLessons([lesson({ id: 'a1' })], [lesson({ id: 'b1', date: '2026-11-09' })])
    expect(pairs).toEqual([{ a: expect.objectContaining({ id: 'a1' }), b: expect.objectContaining({ id: 'b1' }), changes: [] }])
  })

  it('nhận ra đổi giờ, đổi thứ và đổi GV', () => {
    const r = compareWeeks(
      week(A, [lesson({ id: 'a1' }), lesson({ id: 'a2', className: '2A' }), lesson({ id: 'a3', className: '3A' })]),
      week(B, [
        lesson({ id: 'b1', date: '2026-11-09', start: '08:15', end: '08:50' }),
        lesson({ id: 'b2', className: '2A', date: '2026-11-11' }),
        lesson({ id: 'b3', className: '3A', date: '2026-11-09', teacherId: 'T2' }),
      ]),
    )
    const s = r.schools[0]
    expect(s.added).toHaveLength(0)
    expect(s.removed).toHaveLength(0)
    const byClass = Object.fromEntries(s.changed.map((p) => [p.a!.className, p.changes]))
    expect(byClass).toEqual({ '1A': ['time'], '2A': ['day'], '3A': ['teacher'] })

    const t1 = r.teachers.find((t) => t.teacherId === 'T1')!
    const t2 = r.teachers.find((t) => t.teacherId === 'T2')!
    expect(t1.lost.map((p) => p.a!.id)).toEqual(['a3'])
    expect(t1.changed.map((p) => p.b!.id).sort()).toEqual(['b1', 'b2'])
    expect(t2.gained.map((p) => p.b!.id)).toEqual(['b3'])
    expect([t1.countA, t1.countB, t2.countA, t2.countB]).toEqual([3, 2, 0, 1])
  })

  it('lớp mới, lớp bỏ và trường chỉ có ở một tuần', () => {
    const r = compareWeeks(
      week(A, [lesson({ id: 'a1' }), lesson({ id: 'a2', schoolId: 'OLD' })]),
      week(B, [lesson({ id: 'b1', date: '2026-11-09' }), lesson({ id: 'b2', className: '5C', date: '2026-11-09' }), lesson({ id: 'b3', schoolId: 'NEW', date: '2026-11-10' })]),
    )
    const of = (id: string) => r.schools.find((s) => s.schoolId === id)!
    expect(of('S1').added.map((p) => p.b!.id)).toEqual(['b2'])
    expect(of('OLD').presence).toBe('onlyA')
    expect(of('NEW').presence).toBe('onlyB')
    const t1 = r.teachers.find((t) => t.teacherId === 'T1')!
    expect(t1.schoolsAdded).toEqual(['NEW'])
    expect(t1.schoolsRemoved).toEqual(['OLD'])
  })

  it('trường báo nghỉ: GV mất ca, trường thấy đổi trạng thái', () => {
    const r = compareWeeks(week(A, [lesson({ id: 'a1' })]), week(B, [lesson({ id: 'b1', date: '2026-11-09', status: 'school_off' })]))
    expect(r.schools[0].changed[0].changes).toEqual(['teacher', 'status'])
    expect(r.teachers[0].lost.map((p) => p.b!.id)).toEqual(['b1'])
    expect(r.teachers[0].countB).toBe(0)
  })

  it('hai ca giống hệt nhau trong ngày ghép đủ cặp, không báo thừa', () => {
    const two = (d: string, p: string) => [lesson({ id: `${p}1`, date: d }), lesson({ id: `${p}2`, date: d, period: 2 })]
    const r = compareWeeks(week(A, two('2026-11-02', 'a')), week(B, two('2026-11-09', 'b')))
    expect(r.schools[0].added.length + r.schools[0].removed.length + r.schools[0].changed.length).toBe(0)
  })
})

describe('so sánh trên dữ liệu thật', async () => {
  const { default: seedJson } = await import('../data/seed.json')
  const weeks = (seedJson as unknown as { weeks: Week[] }).weeks
  it('mọi ca đều được ghép hoặc báo thêm/bỏ đúng một lần', () => {
    const [a, b] = weeks.slice(-2)
    const r = compareWeeks(a, b)
    expect(r.pairs.filter((p) => p.a).length).toBe(a.lessons.length)
    expect(r.pairs.filter((p) => p.b).length).toBe(b.lessons.length)
    // Lịch cố định: phần lớn ca ghép được với tuần trước.
    expect(r.pairs.filter((p) => p.a && p.b).length).toBeGreaterThan(b.lessons.length * 0.7)
  })
})

describe('xoá tuần', async () => {
  const { useStore } = await import('../store')
  const base = (id: string) => week(id, [lesson({ id: `l-${id}`, weekId: id, date: id })])
  const reset = () => useStore.setState({ weeks: [base(A), base(B)], activeWeekId: B, leaves: [] })

  it('xoá mềm, chuyển tuần đang xem, khôi phục được', () => {
    reset()
    expect(useStore.getState().deleteWeek(B)).toBe(true)
    let s = useStore.getState()
    expect(s.weeks.find((w) => w.id === B)!.deletedAt).toBeTruthy()
    expect(s.activeWeekId).toBe(A)
    expect(s.deleteWeek(A)).toBe(false)
    s.restoreWeek(B)
    s = useStore.getState()
    expect(s.weeks.find((w) => w.id === B)!.deletedAt).toBeUndefined()
  })

  it('tuần đã xoá không sửa được, xoá vĩnh viễn thì mất hẳn', () => {
    reset()
    useStore.getState().deleteWeek(B)
    useStore.getState().markSchoolOff(`l-${B}`, true)
    expect(useStore.getState().weeks.find((w) => w.id === B)!.lessons[0].status).toBe('assigned')
    useStore.getState().purgeWeek(B)
    expect(useStore.getState().weeks.map((w) => w.id)).toEqual([A])
  })

  it('tạo tuần mới trùng ngày tuần đã xoá thì thay bản đã xoá', () => {
    reset()
    useStore.getState().deleteWeek(B)
    const id = useStore.getState().planNewWeek(A)
    const s = useStore.getState()
    expect(id).toBe(B)
    expect(s.weeks.filter((w) => w.id === B)).toHaveLength(1)
    expect(s.weeks.find((w) => w.id === B)!.deletedAt).toBeUndefined()
  })
})
