import { DistanceBook, type KmSource } from './distance'
import { toMin } from './time'
import type { Lesson, RecordedLeg, Settings, StartType, Teacher, Tier, Week } from './types'

export interface RouteLeg {
  start: StartType
  fromLabel: string
  fromSchoolId: string | null
  toSchoolId: string
  /** Vị trí ca đầu tiên của chặng, dùng để đối chiếu với workbook. */
  session: Lesson['session']
  period: number
  km: number
  source: KmSource
  cost: number
}

export interface DayRoute {
  teacherId: string
  date: string
  legs: RouteLeg[]
  /** Chặng cuối về nhà: nằm trong lộ trình nhưng biểu giá theo bậc của workbook không trả tiền chặng này. */
  returnKm: number
  totalKm: number
  cost: number
  hasEstimate: boolean
}

export const tierAmount = (tiers: Tier[], km: number) =>
  tiers.find((t) => t.below === null || km < t.below)?.amount ?? 0

export const legCost = (start: StartType, km: number, s: Settings) =>
  tierAmount(start === 'N' ? s.tiersFromHome : s.tiersFromOther, km)

/** Ca thực sự làm GV phải có mặt tại trường. */
export const isOnSite = (l: Lesson) => l.status === 'assigned' && l.teacherId !== null

export const byTime = (a: Lesson, b: Lesson) =>
  (a.session === b.session ? 0 : a.session === 'AM' ? -1 : 1) ||
  (toMin(a.start) ?? a.period * 45) - (toMin(b.start) ?? b.period * 45) ||
  a.period - b.period

export const kmKey = (weekId: string, teacherId: string, date: string, toSchoolId: string) =>
  `${weekId}|${teacherId}|${date}|${toSchoolId}`

export interface RouteContext {
  book: DistanceBook
  settings: Settings
  officeName: (id: string) => string
  kmOverrides: Record<string, number>
}

const finish = (teacherId: string, date: string, legs: RouteLeg[], returnKm: number, s: Settings, fixedCost?: number): DayRoute => {
  const totalKm = legs.reduce((sum, l) => sum + l.km, 0) + returnKm
  const hasEstimate = legs.some((l) => l.source === 'estimated')
  const tierTotal = legs.reduce((sum, l) => sum + l.cost, 0)
  const perKm = legs.length ? totalKm * s.ratePerKm + (totalKm >= s.longRouteKm ? s.longRouteAllowance : 0) : 0
  const cost = s.costPolicy === 'tier' ? (fixedCost ?? tierTotal) : perKm
  return { teacherId, date, legs, returnKm, totalKm, cost, hasEstimate }
}

/**
 * Lộ trình một ngày theo quy tắc rút ra từ workbook:
 *  - có ca sáng: xuất phát từ Nhà (N)
 *  - chỉ có ca chiều: xuất phát từ Văn phòng (V) của GV
 *  - đổi trường trong ngày: mỗi lần đổi là một chặng K
 *  - cùng một trường cả ngày: không phát sinh chặng mới
 */
export function deriveRoute(
  teacher: Teacher,
  date: string,
  dayLessons: Lesson[],
  weekId: string,
  recorded: RecordedLeg[],
  ctx: RouteContext,
): DayRoute {
  const lessons = dayLessons.filter(isOnSite).sort(byTime)
  const legs: RouteLeg[] = []
  let current: string | null = null
  for (const l of lessons) {
    if (l.schoolId === current) continue
    const first: boolean = current === null
    const start: StartType = !first ? 'K' : l.session === 'AM' ? 'N' : 'V'
    const base = first
      ? start === 'N'
        ? ctx.book.fromHome(teacher.id, l.schoolId)
        : ctx.book.fromOffice(teacher.officeId, l.schoolId)
      : ctx.book.between(current!, l.schoolId)
    const rec = recorded.find((r) => r.session === l.session && r.period === l.period && r.start === start)
    const manual = ctx.kmOverrides[kmKey(weekId, teacher.id, date, l.schoolId)]
    const km = manual ?? rec?.km ?? base.km
    const source: KmSource = manual !== undefined ? 'manual' : rec ? 'recorded' : base.source
    legs.push({
      start,
      fromLabel: first ? (start === 'N' ? 'Nhà' : ctx.officeName(teacher.officeId)) : '',
      fromSchoolId: current,
      toSchoolId: l.schoolId,
      session: l.session,
      period: l.period,
      km,
      source,
      cost: legCost(start, km, ctx.settings),
    })
    current = l.schoolId
  }
  const returnKm = current ? ctx.book.fromHome(teacher.id, current).km : 0
  return finish(teacher.id, date, legs, returnKm, ctx.settings)
}

/** Tuần đã lưu trữ: giữ nguyên các chặng đã ghi nhận để phục vụ đối soát. */
export function recordedRoute(
  teacher: Teacher,
  date: string,
  allDayLessons: Lesson[],
  recorded: RecordedLeg[],
  ctx: RouteContext,
): DayRoute {
  let previous: string | null = null
  const legs: RouteLeg[] = [...recorded]
    .sort((a, b) => (a.session === b.session ? a.period - b.period : a.session === 'AM' ? -1 : 1))
    .map((r) => {
      const to = allDayLessons.find((l) => l.session === r.session && l.period === r.period)
      const leg: RouteLeg = {
        start: r.start,
        fromLabel: r.start === 'N' ? 'Nhà' : r.start === 'V' ? ctx.officeName(teacher.officeId) : '',
        fromSchoolId: r.start === 'K' ? previous : null,
        toSchoolId: to?.schoolId ?? previous ?? '',
        session: r.session,
        period: r.period,
        km: r.km,
        source: 'recorded',
        cost: r.cost,
      }
      previous = leg.toSchoolId
      return leg
    })
  const returnKm = previous ? ctx.book.fromHome(teacher.id, previous).km : 0
  return finish(teacher.id, date, legs, returnKm, ctx.settings, recorded.reduce((s, r) => s + r.cost, 0))
}

export function routeForWeek(week: Week, teacher: Teacher, date: string, ctx: RouteContext): DayRoute {
  const lessons = week.lessons.filter((l) => l.date === date && (l.teacherId === teacher.id || l.originalTeacherId === teacher.id))
  const own = lessons.filter((l) => l.teacherId === teacher.id)
  const recorded = week.legs.filter((r) => r.teacherId === teacher.id && r.date === date)
  return week.status === 'archived'
    ? recordedRoute(teacher, date, lessons, recorded, ctx)
    : deriveRoute(teacher, date, own, week.id, recorded, ctx)
}

const CREDITS: Record<string, [keyof Tally, number]> = {
  K: ['kns', 1], 'K/2': ['kns', 0.5], S: ['stem', 1], 'S/2': ['stem', 0.5], C: ['cds', 1], 'C/2': ['cds', 0.5],
  // Workbook gom tiết chuyên đề quy đổi vào cột KNS.
  BCCĐ: ['kns', 3], BCTH: ['kns', 3], 'BCTH/2': ['kns', 2], ĐP: ['kns', 3], HN: ['kns', 2], KI: ['kns', 2], BN: ['kns', 2], HT: ['kns', 1], TQ: ['kns', 1], CA: ['kns', 1],
}

export interface Tally {
  kns: number
  stem: number
  cds: number
}

/** Tiết quy đổi theo bảng cuối sheet tuần (CM, NB = 0 tiết). */
export function tally(lessons: Lesson[]): Tally {
  const t: Tally = { kns: 0, stem: 0, cds: 0 }
  for (const l of lessons) {
    const credit = l.code && l.status === 'assigned' ? CREDITS[l.code] : undefined
    if (credit) t[credit[0]] += credit[1]
  }
  return t
}
