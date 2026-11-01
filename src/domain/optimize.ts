import { blockers, preferenceViolations } from './constraints'
import { buildContext, type WeekContext } from './context'
import { ISSUE_META, newIssues, weekIssues, type Issue } from './issues'
import { reassign } from './lesson-edit'
import { canTeach, rankCandidates } from './recommend'
import { deriveRoute, isOnSite, routeForWeek } from './route'
import { weekDates } from './time'
import { teacherLabel, TEACHING_CODES, type Lesson, type Teacher } from './types'

export type SuggestionKind = 'fix' | 'cost' | 'area'

export interface Change {
  lessonId: string
  teacherId: string
}

export interface Suggestion {
  id: string
  kind: SuggestionKind
  title: string
  reason: string
  /** week = cả tuần, day = một ngày, lesson = một ca */
  scope: 'week' | 'day' | 'lesson'
  changes: Change[]
  lessons: Lesson[]
  teacherIds: string[]
  saving: number
  kmSaved: number
  /** Số ca bớt vi phạm nguyện vọng (khu vực mong muốn, giờ giấc). */
  prefGain: number
  /** Số ca ra ngoài danh sách Refer so với trước. */
  referLoss: number
  estimatedKm: boolean
  load: { teacherId: string; before: number; after: number }[]
  value: number
}

/** Một ca bớt vi phạm nguyện vọng được quy đổi thành từng này đồng khi xếp hạng. */
const PREF_VALUE = 15000
const REFER_PENALTY = 2000
/** Đổi GV chỉ một ngày làm lớp học khác người so với các ngày còn lại, nên ưu tiên đổi cả tuần. */
const DAY_SCOPE_FACTOR = 0.6
const MIN_SAVING = 20000
const MIN_PREF_GAIN = 3
const MAX_SUGGESTIONS = 24
/** Số ca ảnh hưởng tới thu nhập của giáo viên: một đề xuất không được làm ai tăng hay giảm quá từng này ca một tuần. */
export const MAX_LOAD_SHIFT = 6

interface Unit {
  teacher: Teacher
  schoolId: string
  date: string | null
  lessons: Lesson[]
}

const movable = (l: Lesson) => l.status === 'assigned' && !!l.teacherId && !!l.code && TEACHING_CODES.has(l.code)

function buildUnits(ctx: WeekContext) {
  const week = new Map<string, Unit>()
  const day = new Map<string, Unit>()
  for (const l of ctx.week.lessons) {
    if (!movable(l)) continue
    const teacher = ctx.teacherById.get(l.teacherId!)
    if (!teacher) continue
    const add = (m: Map<string, Unit>, key: string, date: string | null) => {
      const u = m.get(key)
      if (u) u.lessons.push(l)
      else m.set(key, { teacher, schoolId: l.schoolId, date, lessons: [l] })
    }
    add(week, `${teacher.id}|${l.schoolId}`, null)
    add(day, `${teacher.id}|${l.schoolId}|${l.date}`, l.date)
  }
  const weekUnits = [...week.values()]
  // Trường chỉ dạy một ngày thì đơn vị ngày trùng đơn vị tuần: giữ đơn vị tuần.
  const dayUnits = [...day.values()].filter((u) => (week.get(`${u.teacher.id}|${u.schoolId}`)?.lessons.length ?? 0) > u.lessons.length)
  return { weekUnits, dayUnits }
}

const canTake = (t: Teacher, u: Unit) => t.active && !t.isManager && !t.onlineOnly && t.id !== u.teacher.id && u.lessons.every((l) => canTeach(t, l.subject))

interface Plan {
  a: Unit
  to: Teacher
  /** Có b là đổi chéo: b chuyển về người của a. */
  b: Unit | null
}

function evaluatePlan({ a, to, b }: Plan, ctx: WeekContext, dates: string[], loads: Map<string, number>, maxLoad: number): Omit<Suggestion, 'id' | 'kind' | 'title' | 'reason' | 'value' | 'scope'> & { raw: number } | null {
  const from = a.teacher
  const moved = new Set([...a.lessons.map((l) => l.id), ...(b?.lessons.map((l) => l.id) ?? [])])
  const incoming = (t: Teacher) => (t.id === to.id ? a.lessons : (b?.lessons ?? []))
  const after = (t: Teacher, date: string) => {
    const keep = (ctx.dayLessons.get(`${t.id}|${date}`) ?? []).filter((l) => !moved.has(l.id))
    return [...keep, ...incoming(t).filter((l) => l.date === date).map((l) => ({ ...l, teacherId: t.id }))]
  }
  // Điều kiện cứng trước, vì rẻ hơn tính lộ trình.
  for (const t of [from, to]) {
    for (const l of incoming(t)) {
      if (blockers(t, l, after(t, l.date).filter(isOnSite), ctx.world.leaves, ctx.book, ctx.settings).length) return null
    }
  }
  const loadOf = (t: Teacher) => loads.get(t.id) ?? 0
  const toAfter = loadOf(to) + a.lessons.length - (b?.lessons.length ?? 0)
  const fromAfter = loadOf(from) - a.lessons.length + (b?.lessons.length ?? 0)
  if (toAfter > Math.max(maxLoad, loadOf(to))) return null
  if (Math.abs(toAfter - loadOf(to)) > MAX_LOAD_SHIFT) return null
  // Không đề xuất làm một giáo viên mất toàn bộ ca trong tuần.
  if (fromAfter === 0 && loadOf(from) > 0) return null

  let saving = 0
  let kmSaved = 0
  let estimatedKm = false
  const affected = dates.filter((d) => a.lessons.some((l) => l.date === d) || b?.lessons.some((l) => l.date === d))
  for (const t of [from, to]) {
    for (const d of affected) {
      // Cùng các chặng đã ghi như bảng chi phí, để số tiết kiệm khớp với số thấy được sau khi áp dụng.
      const recorded = ctx.week.legs.filter((r) => r.teacherId === t.id && r.date === d)
      const before = deriveRoute(t, d, ctx.dayLessons.get(`${t.id}|${d}`) ?? [], ctx.week.id, recorded, ctx)
      const next = deriveRoute(t, d, after(t, d), ctx.week.id, recorded, ctx)
      saving += before.cost - next.cost
      kmSaved += before.totalKm - next.totalKm
      estimatedKm ||= next.hasEstimate
    }
  }
  const prefs = (t: Teacher, l: Lesson) => preferenceViolations(t, l, ctx.schoolById.get(l.schoolId)).length
  const refer = (t: Teacher, l: Lesson) => (ctx.schoolById.get(l.schoolId)?.referredTeacherIds.includes(t.id) ? 1 : 0)
  let prefGain = 0
  let referLoss = 0
  for (const l of a.lessons) {
    prefGain += prefs(from, l) - prefs(to, l)
    referLoss += refer(from, l) - refer(to, l)
  }
  for (const l of b?.lessons ?? []) {
    prefGain += prefs(to, l) - prefs(from, l)
    referLoss += refer(to, l) - refer(from, l)
  }
  // Không đánh đổi: đề xuất không được làm nguyện vọng xấu đi, và không tốn thêm tiền đáng kể.
  if (prefGain < 0 || saving < -10000) return null
  if (saving < MIN_SAVING && prefGain < MIN_PREF_GAIN) return null
  return {
    changes: [...a.lessons.map((l) => ({ lessonId: l.id, teacherId: to.id })), ...(b?.lessons.map((l) => ({ lessonId: l.id, teacherId: from.id })) ?? [])],
    lessons: [...a.lessons, ...(b?.lessons ?? [])],
    teacherIds: [from.id, to.id],
    saving,
    kmSaved,
    prefGain,
    referLoss: Math.max(referLoss, 0),
    estimatedKm,
    load: [{ teacherId: from.id, before: loadOf(from), after: fromAfter }, { teacherId: to.id, before: loadOf(to), after: toAfter }],
    raw: saving + prefGain * PREF_VALUE - Math.max(referLoss, 0) * REFER_PENALTY,
  }
}

const describe = (ctx: WeekContext, u: Unit) => {
  const school = ctx.schoolById.get(u.schoolId)?.fullName ?? u.schoolId
  return `${u.lessons.length} ca tại ${school}`
}

/** Áp thay đổi vào lịch: dùng cho cả kiểm chứng lẫn khi người dùng bấm áp dụng. */
export const applyChanges = (lessons: Lesson[], changes: Change[]) => {
  const to = new Map(changes.map((c) => [c.lessonId, c.teacherId]))
  return lessons.map((l) => (to.has(l.id) ? reassign(l, to.get(l.id)!) : l))
}

const urgent = (issues: Issue[]) => issues.filter((i) => ISSUE_META[i.kind].severity !== 'info')

function fixSuggestions(ctx: WeekContext, issues: Issue[]): Suggestion[] {
  const out: Suggestion[] = []
  const seen = new Set<string>()
  for (const i of issues) {
    if (i.kind !== 'uncovered' && i.kind !== 'overlap' && i.kind !== 'travel' && i.kind !== 'leave') continue
    if (seen.has(i.lesson.id)) continue
    seen.add(i.lesson.id)
    const best = rankCandidates({ ...i.lesson, teacherId: null, status: 'needs_cover' }, ctx).find((c) => c.available && c.taughtSubject && c.violations.length === 0 && !c.teacher.isManager && c.teacher.id !== i.lesson.teacherId)
    if (!best) continue
    const school = ctx.schoolById.get(i.lesson.schoolId)?.fullName
    out.push({
      id: `fix-${i.kind}-${i.lesson.id}`,
      kind: 'fix',
      scope: 'lesson',
      title: `${teacherLabel(best.teacher)} nhận lớp ${i.lesson.className ?? ''} tại ${school}`,
      reason: `${ISSUE_META[i.kind].label}: ${i.detail}. ${best.teacher.name} đang rảnh, ${best.km} km tới trường.`,
      changes: [{ lessonId: i.lesson.id, teacherId: best.teacher.id }],
      lessons: [i.lesson],
      teacherIds: [best.teacher.id, ...(i.lesson.teacherId ? [i.lesson.teacherId] : [])],
      saving: -best.extraCost,
      kmSaved: 0,
      prefGain: 0,
      referLoss: 0,
      estimatedKm: best.kmSource === 'estimated',
      load: [],
      value: 1e9 - best.extraCost,
    })
  }
  return out
}

/**
 * Đề xuất đổi người để lịch trơn tru hơn. Chi phí tính theo chặng nên đổi một ca lẻ hiếm khi tiết kiệm được:
 * đơn vị đổi là toàn bộ ca của một GV tại một trường, theo cả tuần hoặc một ngày.
 * Mỗi GV xuất hiện tối đa một lần nên các đề xuất độc lập và cộng dồn được.
 * Không đề xuất nào làm phát sinh trùng lịch hay chặng không kịp mới.
 */
export function suggestOptimizations(ctx: WeekContext): Suggestion[] {
  if (ctx.week.status !== 'planning') return []
  const issues = weekIssues(ctx)
  const dates = weekDates(ctx.week.startDate)
  const loads = new Map<string, number>()
  for (const l of ctx.week.lessons) if (movable(l)) loads.set(l.teacherId!, (loads.get(l.teacherId!) ?? 0) + 1)
  const maxLoad = Math.max(0, ...loads.values())
  const teachers = ctx.world.teachers
  const { weekUnits, dayUnits } = buildUnits(ctx)

  const pool: Suggestion[] = fixSuggestions(ctx, issues)
  const consider = (plan: Plan, scope: 'week' | 'day') => {
    const r = evaluatePlan(plan, ctx, dates, loads, maxLoad)
    if (!r) return
    const { a, to, b } = plan
    const { raw, ...rest } = r
    const value = scope === 'day' ? raw * DAY_SCOPE_FACTOR : raw
    const when = scope === 'day' ? ' (một ngày)' : ''
    const title = b
      ? `Đổi chéo${when}: ${teacherLabel(a.teacher)} và ${teacherLabel(to)}`
      : `${teacherLabel(to)} nhận ${describe(ctx, a)}${when}`
    const reason = b
      ? `${a.teacher.name} nhận ${describe(ctx, b)}; ${to.name} nhận ${describe(ctx, a)}.`
      : `Chuyển từ ${a.teacher.name} sang ${to.name}.`
    const kind: SuggestionKind = rest.prefGain * PREF_VALUE > rest.saving ? 'area' : 'cost'
    pool.push({ ...rest, id: rest.changes.map((c) => `${c.lessonId}>${c.teacherId}`).join(','), kind, scope, title, reason, value })
  }
  for (const [units, scope] of [[weekUnits, 'week'], [dayUnits, 'day']] as const) {
    for (const a of units) {
      for (const to of teachers) if (canTake(to, a)) consider({ a, to, b: null }, scope)
      for (const b of units) {
        // Mỗi cặp chỉ xét một lần; đổi chéo một ngày chỉ có nghĩa khi cùng ngày.
        if (a.teacher.id >= b.teacher.id || a.schoolId === b.schoolId || a.date !== b.date) continue
        if (canTake(b.teacher, a) && canTake(a.teacher, b)) consider({ a, to: b.teacher, b }, scope)
      }
    }
  }

  // Chọn tham lam, mỗi GV một lần; kiểm chứng trên toàn bộ lịch trước khi đưa ra.
  pool.sort((x, y) => y.value - x.value)
  const used = new Set<string>()
  const out: Suggestion[] = []
  for (const s of pool) {
    if (out.length >= MAX_SUGGESTIONS) break
    if (s.teacherIds.some((id) => used.has(id))) continue
    const after = weekIssues(buildContext({ ...ctx.week, lessons: applyChanges(ctx.week.lessons, s.changes) }, ctx.world))
    if (urgent(newIssues(issues, after)).length) continue
    s.teacherIds.forEach((id) => used.add(id))
    out.push(s)
  }
  return out
}

export type ChangeState = 'pending' | 'done' | 'overridden'

/** Trạng thái một ca của đề xuất so với lịch hiện tại: danh sách đề xuất đứng yên trong khi lịch thay đổi dần. */
export function changeState(s: Suggestion, c: Change, ctx: WeekContext): ChangeState {
  const now = ctx.week.lessons.find((l) => l.id === c.lessonId)
  const planned = s.lessons.find((l) => l.id === c.lessonId)
  if (!now || !planned) return 'overridden'
  if (now.teacherId === c.teacherId) return 'done'
  return now.teacherId === planned.teacherId && now.status === planned.status ? 'pending' : 'overridden'
}

export const pendingChanges = (s: Suggestion, ctx: WeekContext) => s.changes.filter((c) => changeState(s, c, ctx) === 'pending')

export interface ChangesImpact {
  saving: number
  kmSaved: number
  /** Trùng lịch, không kịp di chuyển... sẽ phát sinh thêm. */
  newUrgent: Issue[]
}

/** Tác động thật của một nhóm thay đổi lên lịch hiện tại. */
export function changesImpact(changes: Change[], ctx: WeekContext): ChangesImpact {
  const week = { ...ctx.week, lessons: applyChanges(ctx.week.lessons, changes) }
  const next = buildContext(week, ctx.world)
  const moved = ctx.week.lessons.filter((l) => changes.some((c) => c.lessonId === l.id))
  const pairs = new Set<string>()
  for (const l of moved) {
    if (l.teacherId) pairs.add(`${l.teacherId}|${l.date}`)
    pairs.add(`${changes.find((c) => c.lessonId === l.id)!.teacherId}|${l.date}`)
  }
  let saving = 0
  let kmSaved = 0
  for (const key of pairs) {
    const [id, date] = key.split('|')
    const t = ctx.teacherById.get(id)
    if (!t) continue
    const a = routeForWeek(ctx.week, t, date, ctx)
    const b = routeForWeek(week, t, date, next)
    saving += a.cost - b.cost
    kmSaved += a.totalKm - b.totalKm
  }
  return { saving, kmSaved, newUrgent: urgent(newIssues(weekIssues(ctx), weekIssues(next))) }
}

export interface LessonMove extends ChangesImpact {
  /** Các ca phải đổi cùng lúc, luôn có ca được chọn. */
  changes: Change[]
  /** Đổi được mà không phát sinh trùng lịch hay không kịp. */
  ok: boolean
}

/**
 * Đổi riêng một ca của đề xuất. Đổi chéo thường vướng vì người nhận đang dạy đúng giờ đó:
 * khi ca vướng cũng nằm trong đề xuất thì gộp vào để đổi theo cặp, thay vì tạo ra trùng lịch.
 */
export function planLessonMove(s: Suggestion, lessonId: string, ctx: WeekContext): LessonMove {
  const pending = pendingChanges(s, ctx)
  const chosen = pending.find((c) => c.lessonId === lessonId)
  if (!chosen) return { changes: [], ok: false, saving: 0, kmSaved: 0, newUrgent: [] }
  let changes = [chosen]
  for (let i = 0; i <= pending.length; i++) {
    const impact = changesImpact(changes, ctx)
    if (!impact.newUrgent.length) return { ...impact, changes, ok: true }
    const ids = new Set(changes.map((c) => c.lessonId))
    const more = pending.filter((c) => !ids.has(c.lessonId) && impact.newUrgent.some((u) => u.lesson.id === c.lessonId || u.related?.id === c.lessonId))
    if (!more.length) return { ...impact, changes, ok: false }
    changes = [...changes, ...more]
  }
  return { ...changesImpact(changes, ctx), changes, ok: false }
}
