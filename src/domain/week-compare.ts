import { dayIndex } from './time'
import type { Lesson, Week } from './types'

/** Những gì khác nhau giữa hai ca được ghép cặp (cùng lớp, cùng môn ở cùng trường). */
export type LessonField = 'day' | 'time' | 'teacher' | 'status' | 'code'

export interface LessonPair {
  /** Ca ở tuần A (tuần gốc); null = lớp mới có ở tuần B. */
  a: Lesson | null
  /** Ca ở tuần B (tuần so sánh); null = lớp không còn ở tuần B. */
  b: Lesson | null
  changes: LessonField[]
}

export interface SchoolDiff {
  schoolId: string
  countA: number
  countB: number
  /** Chỉ có ở một tuần: trường bắt đầu hoặc ngừng có lịch. */
  presence: 'both' | 'onlyA' | 'onlyB'
  added: LessonPair[]
  removed: LessonPair[]
  changed: LessonPair[]
}

export interface TeacherDiff {
  teacherId: string
  countA: number
  countB: number
  /** Ca GV nhận thêm ở tuần B: lớp mới, hoặc lớp trước do GV khác dạy. */
  gained: LessonPair[]
  /** Ca GV không còn dạy ở tuần B: lớp bỏ, chuyển GV khác, hoặc trường báo nghỉ. */
  lost: LessonPair[]
  /** Vẫn là ca của GV nhưng đổi ngày, giờ hoặc mã. */
  changed: LessonPair[]
  schoolsAdded: string[]
  schoolsRemoved: string[]
}

export interface WeekComparison {
  pairs: LessonPair[]
  schools: SchoolDiff[]
  teachers: TeacherDiff[]
}

/** GV thực sự dạy ca này; ca trường báo nghỉ, huỷ hoặc đã có ca dạy thay thì không tính. */
export const teacherOf = (l: Lesson | null): string | null =>
  l && l.status !== 'school_off' && l.status !== 'cancelled' && l.status !== 'replaced' ? l.teacherId : null

const label = (l: Lesson) => l.className ?? l.note ?? ''

// Ghép từ chặt tới lỏng: trùng hết, rồi cùng ngày (đổi giờ), rồi cùng lớp (đổi ngày).
const PASSES: ((l: Lesson) => string | null)[] = [
  (l) => `${dayIndex(l.date)}|${l.session}|${label(l)}|${l.subject}|${l.start}|${l.end}|${l.type}`,
  (l) => `${dayIndex(l.date)}|${l.session}|${label(l)}|${l.subject}|${l.start}|${l.end}`,
  (l) => `${dayIndex(l.date)}|${label(l)}|${l.subject}`,
  (l) => (label(l) ? `${label(l)}|${l.subject}` : null),
]

const byTime = (x: Lesson, y: Lesson) => x.date.localeCompare(y.date) || (x.start ?? '').localeCompare(y.start ?? '') || x.period - y.period || x.track - y.track

function fieldsOf(a: Lesson, b: Lesson): LessonField[] {
  const out: LessonField[] = []
  if (dayIndex(a.date) !== dayIndex(b.date)) out.push('day')
  if (a.start !== b.start || a.end !== b.end || a.session !== b.session) out.push('time')
  if (teacherOf(a) !== teacherOf(b)) out.push('teacher')
  if (a.status !== b.status) out.push('status')
  if (a.code !== b.code) out.push('code')
  return out
}

/** Ghép ca của tuần A với tuần B theo từng trường; ca không ghép được là lớp thêm hoặc bỏ. */
export function pairLessons(a: Lesson[], b: Lesson[]): LessonPair[] {
  const schools = new Set([...a, ...b].map((l) => l.schoolId))
  const out: LessonPair[] = []
  for (const schoolId of schools) {
    let leftA = a.filter((l) => l.schoolId === schoolId).sort(byTime)
    let leftB = b.filter((l) => l.schoolId === schoolId).sort(byTime)
    for (const key of PASSES) {
      const pool = new Map<string, Lesson[]>()
      for (const l of leftB) {
        const k = key(l)
        if (k !== null) pool.set(k, [...(pool.get(k) ?? []), l])
      }
      const used = new Set<Lesson>()
      const rest: Lesson[] = []
      for (const l of leftA) {
        const k = key(l)
        const match = k === null ? undefined : pool.get(k)?.shift()
        if (match) {
          used.add(match)
          out.push({ a: l, b: match, changes: fieldsOf(l, match) })
        } else rest.push(l)
      }
      leftA = rest
      leftB = leftB.filter((l) => !used.has(l))
    }
    for (const l of leftA) out.push({ a: l, b: null, changes: [] })
    for (const l of leftB) out.push({ a: null, b: l, changes: [] })
  }
  return out
}

const sortPairs = (ps: LessonPair[]) => ps.sort((x, y) => byTime((x.b ?? x.a)!, (y.b ?? y.a)!))

export function compareWeeks(weekA: Week, weekB: Week): WeekComparison {
  const pairs = pairLessons(weekA.lessons, weekB.lessons)

  const schoolMap = new Map<string, SchoolDiff>()
  const school = (id: string) => {
    let d = schoolMap.get(id)
    if (!d) {
      d = { schoolId: id, countA: 0, countB: 0, presence: 'both', added: [], removed: [], changed: [] }
      schoolMap.set(id, d)
    }
    return d
  }
  for (const p of pairs) {
    const d = school((p.a ?? p.b)!.schoolId)
    if (p.a) d.countA++
    if (p.b) d.countB++
    if (!p.a) d.added.push(p)
    else if (!p.b) d.removed.push(p)
    else if (p.changes.length) d.changed.push(p)
  }
  for (const d of schoolMap.values()) {
    d.presence = d.countA === 0 ? 'onlyB' : d.countB === 0 ? 'onlyA' : 'both'
    sortPairs(d.added)
    sortPairs(d.removed)
    sortPairs(d.changed)
  }

  const teacherMap = new Map<string, TeacherDiff>()
  const teacher = (id: string) => {
    let d = teacherMap.get(id)
    if (!d) {
      d = { teacherId: id, countA: 0, countB: 0, gained: [], lost: [], changed: [], schoolsAdded: [], schoolsRemoved: [] }
      teacherMap.set(id, d)
    }
    return d
  }
  for (const p of pairs) {
    const ta = teacherOf(p.a)
    const tb = teacherOf(p.b)
    if (ta) teacher(ta).countA++
    if (tb) teacher(tb).countB++
    if (ta && ta === tb) {
      if (p.changes.some((c) => c !== 'teacher' && c !== 'status')) teacher(ta).changed.push(p)
      continue
    }
    if (ta) teacher(ta).lost.push(p)
    if (tb) teacher(tb).gained.push(p)
  }
  for (const d of teacherMap.values()) {
    const at = (w: Week) => new Set(w.lessons.filter((l) => teacherOf(l) === d.teacherId).map((l) => l.schoolId))
    const sa = at(weekA)
    const sb = at(weekB)
    d.schoolsAdded = [...sb].filter((x) => !sa.has(x))
    d.schoolsRemoved = [...sa].filter((x) => !sb.has(x))
    sortPairs(d.gained)
    sortPairs(d.lost)
    sortPairs(d.changed)
  }

  // Chỗ nhiều thay đổi lên đầu.
  const sn = (d: SchoolDiff) => d.added.length + d.removed.length + d.changed.length
  const tn = (d: TeacherDiff) => d.gained.length + d.lost.length + d.changed.length
  return {
    pairs,
    schools: [...schoolMap.values()].sort((x, y) => sn(y) - sn(x)),
    teachers: [...teacherMap.values()].sort((x, y) => tn(y) - tn(x)),
  }
}

/** Có gì khác không, để lọc "chỉ hiện chỗ thay đổi". */
export const schoolChanged = (d: SchoolDiff) => d.added.length + d.removed.length + d.changed.length > 0
export const teacherChanged = (d: TeacherDiff) => d.gained.length + d.lost.length + d.changed.length > 0
