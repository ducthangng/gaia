import { blockers, preferenceViolations, type Blocker, type PrefViolation } from './constraints'
import type { WeekContext } from './context'
import type { KmSource } from './distance'
import { byTime, deriveRoute, isOnSite } from './route'
import type { Lesson, Teacher } from './types'

export interface Candidate {
  teacher: Teacher
  score: number
  km: number
  kmSource: KmSource
  kmFrom: string
  isReferred: boolean
  taughtSubject: boolean
  violations: PrefViolation[]
  blockers: Blocker[]
  available: boolean
  extraCost: number
}

const NEAR_KM = 5
const FAR_KM = 40

export const distanceFit = (km: number) => Math.max(0, Math.min(1, (FAR_KM - km) / (FAR_KM - NEAR_KM)))

/** Môn trên workbook viết nhiều kiểu; quy về các nhóm môn lớn khi so năng lực. */
const family = (subject: string) => (subject.includes('KNS') ? 'KNS' : subject.includes('STEM') ? 'STEM' : 'CDS')

export function canTeach(t: Teacher, subject: string | null) {
  if (!subject) return true
  const f = family(subject)
  if (t.subjects.some((x) => family(x) === f)) return true
  if (f === 'KNS') return t.track === 'TÍCH HỢP'
  return t.track === 'TÍCH HỢP' || t.track === 'STEM/CDS/AI'
}

/** Điểm xuất phát thực tế: ca liền trước trong ngày, nếu không có thì Nhà (ca sáng) / Văn phòng (ca chiều). */
function distanceToLesson(t: Teacher, l: Lesson, day: Lesson[], ctx: WeekContext) {
  const prior = day.filter(isOnSite).filter((x) => byTime(x, l) < 0).sort(byTime).at(-1)
  if (prior) return { ...ctx.book.between(prior.schoolId, l.schoolId), from: ctx.schoolById.get(prior.schoolId)?.name ?? 'ca trước' }
  return l.session === 'AM'
    ? { ...ctx.book.fromHome(t.id, l.schoolId), from: 'nhà' }
    : { ...ctx.book.fromOffice(t.officeId, l.schoolId), from: ctx.officeName(t.officeId) }
}

export function evaluate(t: Teacher, l: Lesson, ctx: WeekContext): Candidate {
  const day = ctx.dayLessons.get(`${t.id}|${l.date}`) ?? []
  const school = ctx.schoolById.get(l.schoolId)
  const dist = distanceToLesson(t, l, day, ctx)
  const violations = preferenceViolations(t, l, school, dist.km)
  const blocks = blockers(t, l, day, ctx.world.leaves, ctx.book, ctx.settings)
  const isReferred = school?.referredTeacherIds.includes(t.id) ?? false
  const taughtSubject = canTeach(t, l.subject)
  const w = ctx.settings.weights
  const total = w.distance + w.refer + w.preference + w.availability + w.subject
  const raw =
    w.distance * distanceFit(dist.km) +
    w.refer * (isReferred ? 1 : 0) +
    w.preference * (violations.length ? 0 : 1) +
    w.availability * (blocks.length ? 0 : 1) +
    w.subject * (taughtSubject ? 1 : 0)
  // Cùng các chặng đã ghi như bảng chi phí, để số này khớp với số thấy được sau khi đổi.
  const recorded = ctx.week.legs.filter((r) => r.teacherId === t.id && r.date === l.date)
  const before = deriveRoute(t, l.date, day, ctx.week.id, recorded, ctx).cost
  const after = deriveRoute(t, l.date, [...day.filter((x) => x.id !== l.id), { ...l, teacherId: t.id, status: 'assigned' }], ctx.week.id, recorded, ctx).cost
  return {
    teacher: t,
    score: total ? Math.round((raw / total) * 100) : 0,
    km: dist.km,
    kmSource: dist.source,
    kmFrom: dist.from,
    isReferred,
    taughtSubject,
    violations,
    blockers: blocks,
    available: blocks.length === 0,
    extraCost: after - before,
  }
}

/** Người rảnh lên trước, sau đó xếp theo điểm; hoà điểm thì chọn phương án rẻ hơn. */
export function rankCandidates(l: Lesson, ctx: WeekContext): Candidate[] {
  return ctx.world.teachers
    .filter((t) => t.active && t.id !== l.originalTeacherId)
    .map((t) => evaluate(t, l, ctx))
    .sort((a, b) => Number(b.available) - Number(a.available) || b.score - a.score || a.extraCost - b.extraCost)
}
