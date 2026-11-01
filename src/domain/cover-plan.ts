import { blockers, preferenceViolations } from './constraints'
import type { WeekContext } from './context'
import { canTeach } from './recommend'
import { byTime, deriveRoute, isOnSite } from './route'
import { needsTeacher, type Lesson, type Teacher } from './types'

export type CoverGoal = 'fewest' | 'cheapest' | 'best-fit'

export interface TeacherShare {
  teacherId: string
  lessons: Lesson[]
  extraCost: number
  notReferred: number
  violations: number
}

export interface CoverPlan {
  id: string
  /** Mục tiêu mà phương án này đạt tốt nhất; một phương án có thể đạt nhiều mục tiêu. */
  goals: CoverGoal[]
  shares: TeacherShare[]
  uncovered: Lesson[]
  extraCost: number
  notReferred: number
  violations: number
  changes: { lessonId: string; teacherId: string }[]
}

export interface CoverOptions {
  open: Lesson[]
  /** Giáo viên một mình nhận được toàn bộ ca, rẻ nhất trước. */
  soloPlans: CoverPlan[]
  plans: CoverPlan[]
}

export const openLessons = (ctx: WeekContext, schoolId: string) =>
  ctx.week.lessons
    .filter((l) => l.schoolId === schoolId && (l.status === 'needs_cover' || (!l.teacherId && needsTeacher(l))))
    .sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b))

interface Partial_ {
  /** teacherId -> ca được giao trong phương án */
  plan: Map<string, Lesson[]>
  uncovered: number
  cost: number
  misfit: number
}

const BEAM_WIDTH = 60
const SOLO_LIMIT = 8
const IMPROVE_PASSES = 3

/**
 * Tìm phương án theo từng mục tiêu bằng beam search: lần lượt xếp từng ca theo thời gian, ở mỗi bước
 * chỉ giữ các phương án dở dang tốt nhất. Bài toán gốc là NP-khó nên đây là "tốt nhất tìm được",
 * nhưng số lần thử có giới hạn nên trường nhiều ca trống vẫn chạy nhanh.
 */
export function coverOptions(schoolId: string, ctx: WeekContext): CoverOptions {
  const open = openLessons(ctx, schoolId)
  if (!open.length) return { open, soloPlans: [], plans: [] }

  const pool = ctx.world.teachers.filter((t) => t.active && !t.isManager && !t.onlineOnly)
  const routeCache = new Map<string, number>()
  const baseDay = (t: Teacher, date: string) => (ctx.dayLessons.get(`${t.id}|${date}`) ?? []).filter(isOnSite)
  const recordedOf = (t: Teacher, date: string) => ctx.week.legs.filter((r) => r.teacherId === t.id && r.date === date)
  const costOfDay = (t: Teacher, date: string, added: Lesson[]) => {
    const key = `${t.id}|${date}|${added.map((l) => l.id).join()}`
    let v = routeCache.get(key)
    if (v === undefined) {
      const day = [...(ctx.dayLessons.get(`${t.id}|${date}`) ?? []), ...added.map((l) => ({ ...l, teacherId: t.id, status: 'assigned' as const }))]
      v = deriveRoute(t, date, day, ctx.week.id, recordedOf(t, date), ctx).cost
      routeCache.set(key, v)
    }
    return v
  }
  const extraFor = (t: Teacher, lessons: Lesson[]) => {
    const dates = [...new Set(lessons.map((l) => l.date))]
    return dates.reduce((sum, d) => sum + costOfDay(t, d, lessons.filter((l) => l.date === d)) - costOfDay(t, d, []), 0)
  }
  const fits = (t: Teacher, l: Lesson, already: Lesson[]) => {
    const day = [...baseDay(t, l.date), ...already.filter((x) => x.date === l.date).map((x) => ({ ...x, teacherId: t.id, status: 'assigned' as const }))]
    return blockers(t, { ...l, teacherId: t.id }, day, ctx.world.leaves, ctx.book, ctx.settings).length === 0
  }
  // Lọc trước những người không bao giờ nhận được ca này, để mỗi bước thử ít hơn.
  const eligible = new Map(open.map((l) => [l.id, pool.filter((t) => t.id !== l.originalTeacherId && canTeach(t, l.subject) && fits(t, l, []))]))
  const school = ctx.schoolById.get(schoolId)
  const misfitOf = (t: Teacher, l: Lesson) => preferenceViolations(t, l, school).length + (school?.referredTeacherIds.includes(t.id) ? 0 : 1)

  const rank: Record<CoverGoal, (a: Partial_, b: Partial_) => number> = {
    fewest: (a, b) => a.uncovered - b.uncovered || a.plan.size - b.plan.size || a.cost - b.cost || a.misfit - b.misfit,
    cheapest: (a, b) => a.uncovered - b.uncovered || a.cost - b.cost || a.plan.size - b.plan.size || a.misfit - b.misfit,
    'best-fit': (a, b) => a.uncovered - b.uncovered || a.misfit - b.misfit || a.cost - b.cost || a.plan.size - b.plan.size,
  }

  const solve = (goal: CoverGoal): Partial_ => {
    let beam: Partial_[] = [{ plan: new Map(), uncovered: 0, cost: 0, misfit: 0 }]
    for (const l of open) {
      const next: Partial_[] = []
      for (const s of beam) {
        for (const t of eligible.get(l.id) ?? []) {
          const mine = s.plan.get(t.id) ?? []
          if (!fits(t, l, mine)) continue
          const before = extraFor(t, mine)
          const plan = new Map(s.plan)
          plan.set(t.id, [...mine, l])
          next.push({ plan, uncovered: s.uncovered, cost: s.cost + extraFor(t, [...mine, l]) - before, misfit: s.misfit + misfitOf(t, l) })
        }
        // Không ai nhận được thì vẫn đi tiếp, để phương án cho biết rõ còn thiếu ca nào.
        next.push({ ...s, uncovered: s.uncovered + 1 })
      }
      beam = next.sort(rank[goal]).slice(0, BEAM_WIDTH)
    }
    return measure(beam[0].plan, beam[0].uncovered)
  }

  /** Tính lại từ đầu thay vì cộng dồn, nên số luôn đúng dù phương án đã bị đổi nhiều lần. */
  const measure = (plan: Map<string, Lesson[]>, uncovered: number): Partial_ => {
    let cost = 0
    let misfit = 0
    for (const [id, lessons] of plan) {
      const t = ctx.teacherById.get(id)!
      cost += extraFor(t, lessons)
      misfit += lessons.reduce((n, l) => n + misfitOf(t, l), 0)
    }
    return { plan, uncovered, cost, misfit }
  }

  /** Beam search có thể bỏ sót vì cắt nhánh sớm: thử chuyển từng ca sang người khác, thấy tốt hơn thì giữ. */
  const improve = (start: Partial_, goal: CoverGoal): Partial_ => {
    let best = start
    for (let pass = 0; pass < IMPROVE_PASSES; pass++) {
      let changed = false
      for (const l of open) {
        const owner = [...best.plan].find(([, ls]) => ls.some((x) => x.id === l.id))?.[0]
        if (!owner) continue
        for (const t of eligible.get(l.id) ?? []) {
          if (t.id === owner) continue
          const mine = best.plan.get(t.id) ?? []
          if (!fits(t, l, mine)) continue
          const plan = new Map(best.plan)
          const rest = plan.get(owner)!.filter((x) => x.id !== l.id)
          if (rest.length) plan.set(owner, rest)
          else plan.delete(owner)
          plan.set(t.id, [...mine, l])
          const next = measure(plan, best.uncovered)
          if (rank[goal](next, best) < 0) {
            best = next
            changed = true
            break
          }
        }
      }
      if (!changed) break
    }
    return best
  }

  const toPlan = (s: Partial_, goals: CoverGoal[]): CoverPlan => {
    const shares: TeacherShare[] = [...s.plan].map(([teacherId, lessons]) => {
      const t = ctx.teacherById.get(teacherId)!
      return {
        teacherId,
        lessons,
        extraCost: extraFor(t, lessons),
        notReferred: school?.referredTeacherIds.includes(teacherId) ? 0 : lessons.length,
        violations: lessons.reduce((n, l) => n + preferenceViolations(t, l, school).length, 0),
      }
    }).sort((a, b) => b.lessons.length - a.lessons.length)
    const assigned = new Set(shares.flatMap((x) => x.lessons.map((l) => l.id)))
    const changes = shares.flatMap((x) => x.lessons.map((l) => ({ lessonId: l.id, teacherId: x.teacherId })))
    return {
      id: changes.map((c) => `${c.lessonId}>${c.teacherId}`).sort().join(','),
      goals,
      shares,
      uncovered: open.filter((l) => !assigned.has(l.id)),
      extraCost: shares.reduce((n, x) => n + x.extraCost, 0),
      notReferred: shares.reduce((n, x) => n + x.notReferred, 0),
      violations: shares.reduce((n, x) => n + x.violations, 0),
      changes,
    }
  }

  const soloStates: Partial_[] = []
  for (const t of pool) {
    const taken: Lesson[] = []
    if (open.every((l) => (eligible.get(l.id) ?? []).includes(t) && fits(t, l, taken) && taken.push(l))) {
      soloStates.push(measure(new Map([[t.id, taken]]), 0))
    }
  }

  const GOALS: CoverGoal[] = ['fewest', 'cheapest', 'best-fit']
  const found = GOALS.map((goal) => improve(solve(goal), goal))
  // Nhãn gắn sau cùng, bằng cách so mọi phương án tìm được kể cả người nhận hết một mình:
  // tìm theo từng mục tiêu riêng có thể bỏ sót, không được để nhãn "tiết kiệm nhất" đắt hơn phương án khác.
  const plans: CoverPlan[] = []
  for (const goal of GOALS) {
    const best = [...found, ...soloStates].reduce((x, y) => (rank[goal](y, x) < 0 ? y : x))
    const p = toPlan(best, [goal])
    const same = plans.find((x) => x.id === p.id)
    if (same) same.goals.push(goal)
    else plans.push(p)
  }

  const soloPlans = soloStates.map((x) => toPlan(x, []))
  soloPlans.sort((a, b) => a.extraCost - b.extraCost || a.notReferred - b.notReferred || a.violations - b.violations)
  return { open, soloPlans: soloPlans.slice(0, SOLO_LIMIT), plans }
}
