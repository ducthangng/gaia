import type { WeekContext } from './context'
import { deriveRoute, tierAmount, type DayRoute, type RouteLeg } from './route'
import { money } from './time'
import type { Lesson, Settings, Tier } from './types'

export interface CostChange {
  teacherId: string
  date: string
  before: DayRoute
  after: DayRoute
  delta: number
  reasons: string[]
}

export interface CostExplanation {
  changes: CostChange[]
  total: number
  verdict: 'up' | 'down' | 'same'
  summary: string
  estimated: boolean
}

/** Mô tả bậc tiền của một chặng, ví dụ "bậc 18–24 km: 40.000đ" hoặc "dưới 12 km nên không tính tiền". */
export function tierText(start: RouteLeg['start'], km: number, s: Settings): string {
  const tiers: Tier[] = start === 'N' ? s.tiersFromHome : s.tiersFromOther
  const i = tiers.findIndex((t) => t.below === null || km < t.below)
  const tier = tiers[i]
  const low = i > 0 ? tiers[i - 1].below : 0
  const range = tier.below === null ? `từ ${low} km trở lên` : i === 0 ? `dưới ${tier.below} km` : `${low}–${tier.below} km`
  const amount = tierAmount(tiers, km)
  return amount ? `bậc ${range}: ${money(amount)}` : `${range} nên không tính tiền`
}

const legKey = (l: RouteLeg) => `${l.start}|${l.fromSchoolId ?? ''}|${l.toSchoolId}`

const legName = (l: RouteLeg, ctx: WeekContext) => {
  const to = ctx.schoolById.get(l.toSchoolId)?.name ?? 'trường'
  const from = l.fromLabel || ctx.schoolById.get(l.fromSchoolId ?? '')?.name || 'trường trước'
  return `${from} → ${to}`
}

function reasonsFor(before: DayRoute, after: DayRoute, teaches: { gained: Lesson | null; lost: Lesson | null; dayAfter: Lesson[] }, ctx: WeekContext): string[] {
  const s = ctx.settings
  const out: string[] = []
  if (s.costPolicy === 'perKm') {
    if (before.totalKm !== after.totalKm) out.push(`Tổng lộ trình trong ngày từ ${before.totalKm} km thành ${after.totalKm} km, tính ${money(s.ratePerKm)}/km.`)
  } else {
    const had = new Map(before.legs.map((l) => [legKey(l), l]))
    const has = new Map(after.legs.map((l) => [legKey(l), l]))
    // Xuất phát đổi giữa Nhà và Văn phòng là nguyên nhân dễ bị bỏ sót nhất, nên nói rõ trước.
    const startBefore = before.legs[0]?.start
    const startAfter = after.legs[0]?.start
    if (startBefore === 'V' && startAfter === 'N') out.push('Có thêm ca sáng nên ngày đó xuất phát từ nhà, không còn từ văn phòng.')
    if (startBefore === 'N' && startAfter === 'V') out.push('Không còn ca sáng nên ngày đó xuất phát từ văn phòng, không còn từ nhà.')
    for (const [k, l] of had) {
      if (!has.has(k)) out.push(`Bớt chặng ${legName(l, ctx)} (${l.km} km): ${l.cost ? `giảm ${money(l.cost)}` : 'chặng này vốn không tính tiền'}.`)
    }
    for (const [k, l] of has) {
      const old = had.get(k)
      if (!old) out.push(`Thêm chặng ${legName(l, ctx)} (${l.km} km), ${tierText(l.start, l.km, s)}.`)
      else if (old.km !== l.km) out.push(`Chặng ${legName(l, ctx)} đổi từ ${old.km} km thành ${l.km} km, ${tierText(l.start, l.km, s)}.`)
    }
  }
  if (!out.length) {
    const school = (teaches.gained ?? teaches.lost)?.schoolId
    const name = school ? ctx.schoolById.get(school)?.name : null
    const stillThere = teaches.dayAfter.some((x) => x.schoolId === school)
    if (teaches.gained) out.push(stillThere && teaches.dayAfter.length > 1 ? `Ngày đó đã có ca khác tại ${name} nên không phát sinh chặng mới.` : 'Không phát sinh chặng mới.')
    else if (teaches.lost) out.push(stillThere ? `Ngày đó vẫn còn ca khác tại ${name} nên vẫn phải đi chặng này.` : 'Lộ trình trong ngày không đổi.')
    else out.push('Lộ trình trong ngày không đổi.')
  }
  return out
}

/**
 * So chi phí trước và sau khi đổi một ca: tính riêng từng cặp giáo viên + ngày bị ảnh hưởng.
 * Dùng cùng các chặng đã ghi như bảng chi phí để số ở đây khớp với số người dùng thấy sau khi đổi.
 * before = null nghĩa là ca mới; after = null nghĩa là ca bị bỏ.
 */
export function explainLessonChange(before: Lesson | null, after: Lesson | null, ctx: WeekContext): CostExplanation {
  const pairs = new Map<string, { teacherId: string; date: string }>()
  for (const l of [before, after]) {
    if (l?.teacherId && l.status === 'assigned') pairs.set(`${l.teacherId}|${l.date}`, { teacherId: l.teacherId, date: l.date })
  }
  const changes: CostChange[] = []
  for (const { teacherId, date } of pairs.values()) {
    const teacher = ctx.teacherById.get(teacherId)
    if (!teacher) continue
    const current = ctx.dayLessons.get(`${teacherId}|${date}`) ?? []
    const recorded = ctx.week.legs.filter((r) => r.teacherId === teacherId && r.date === date)
    const keep = before ? current.filter((l) => l.id !== before.id) : current
    const gained = after && after.teacherId === teacherId && after.date === date && after.status === 'assigned' ? after : null
    const lost = before && before.teacherId === teacherId && before.date === date && before.status === 'assigned' && !gained ? before : null
    const next = gained ? [...keep, gained] : keep
    const b = deriveRoute(teacher, date, current, ctx.week.id, recorded, ctx)
    const a = deriveRoute(teacher, date, next, ctx.week.id, recorded, ctx)
    changes.push({ teacherId, date, before: b, after: a, delta: a.cost - b.cost, reasons: reasonsFor(b, a, { gained, lost, dayAfter: next }, ctx) })
  }
  const total = changes.reduce((s, c) => s + c.delta, 0)
  const verdict = total > 0 ? 'up' : total < 0 ? 'down' : 'same'
  const moved = changes.filter((c) => c.delta !== 0).length
  const summary = verdict === 'same'
    ? moved ? 'Phần tăng và phần giảm bù trừ cho nhau nên tổng không đổi.' : 'Không ai phát sinh hay bớt chặng tính tiền.'
    : `${verdict === 'up' ? 'Tăng' : 'Giảm'} ${money(Math.abs(total))} chi phí di chuyển.`
  return { changes, total, verdict, summary, estimated: changes.some((c) => c.after.hasEstimate) }
}
