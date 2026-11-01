import type { WeekContext } from './context'
import type { KmSource } from './distance'
import { byTime, isOnSite, routeForWeek } from './route'
import { toMin } from './time'
import type { Lesson } from './types'

export type MovementOrigin =
  | { kind: 'home'; label: string }
  | { kind: 'office'; officeId: string; label: string }
  | { kind: 'school'; schoolId: string; label: string }

export interface Movement {
  lesson: Lesson
  /** Ca liền trước của GV trong ngày, nếu có. */
  previous: Lesson | null
  origin: MovementOrigin
  /** Đã có mặt tại trường từ ca trước nên không phải di chuyển. */
  alreadyThere: boolean
  km: number
  kmSource: KmSource
  gapMin: number | null
  needMin: number | null
  verdict: 'late' | 'overlap' | 'ok' | 'no-deadline'
}

/** GV đi tới ca này từ đâu: ca liền trước, hoặc Nhà (ca sáng) / Văn phòng (ca chiều) nếu là ca đầu ngày. */
export function movementTo(lesson: Lesson, ctx: WeekContext): Movement | null {
  const teacher = lesson.teacherId ? ctx.teacherById.get(lesson.teacherId) : null
  if (!teacher) return null
  const day = (ctx.dayLessons.get(`${teacher.id}|${lesson.date}`) ?? []).filter(isOnSite)
  const previous = day.filter((x) => x.id !== lesson.id && byTime(x, lesson) <= 0).sort(byTime).at(-1) ?? null

  if (previous) {
    const alreadyThere = previous.schoolId === lesson.schoolId
    const distance = ctx.book.between(previous.schoolId, lesson.schoolId)
    const start = toMin(lesson.start)
    const prevEnd = toMin(previous.end)
    const gapMin = start !== null && prevEnd !== null ? start - prevEnd : null
    const needMin = alreadyThere ? 0 : Math.ceil((distance.km / ctx.settings.travelSpeedKmh) * 60 + ctx.settings.travelBufferMin)
    const verdict = gapMin === null ? 'no-deadline' : gapMin < 0 ? 'overlap' : gapMin < needMin ? 'late' : 'ok'
    return {
      lesson, previous, alreadyThere, km: distance.km, kmSource: distance.source, gapMin, needMin, verdict,
      origin: { kind: 'school', schoolId: previous.schoolId, label: ctx.schoolById.get(previous.schoolId)?.fullName ?? 'Trường trước' },
    }
  }

  // Ca đầu ngày: ưu tiên số km đã ghi hoặc đã sửa trên lộ trình của ngày đó.
  const leg = routeForWeek(ctx.week, teacher, lesson.date, ctx).legs.find((l) => l.toSchoolId === lesson.schoolId)
  const base = lesson.session === 'AM' ? ctx.book.fromHome(teacher.id, lesson.schoolId) : ctx.book.fromOffice(teacher.officeId, lesson.schoolId)
  return {
    lesson, previous: null, alreadyThere: false, km: leg?.km ?? base.km, kmSource: leg?.source ?? base.source, gapMin: null, needMin: null, verdict: 'no-deadline',
    origin: lesson.session === 'AM'
      ? { kind: 'home', label: 'Nhà giáo viên' }
      : { kind: 'office', officeId: teacher.officeId, label: ctx.officeName(teacher.officeId) },
  }
}
