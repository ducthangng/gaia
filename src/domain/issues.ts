import { blockers, preferenceViolations } from './constraints'
import type { WeekContext } from './context'
import { byTime } from './route'
import { needsTeacher, teacherLabel, TEACHING_CODES, type Lesson, type Teacher } from './types'

export type IssueKind = 'uncovered' | 'overlap' | 'leave' | 'travel' | 'preference' | 'refer'
export type Severity = 'critical' | 'warning' | 'info'

export interface Issue {
  kind: IssueKind
  lesson: Lesson
  detail: string
  /** Ca còn lại trong cặp trùng lịch / không kịp di chuyển (luôn là ca diễn ra trước). */
  related?: Lesson
  needMin?: number
  gapMin?: number
  km?: number
}

export const ISSUE_META: Record<IssueKind, { label: string; severity: Severity }> = {
  uncovered: { label: 'Chưa có giáo viên', severity: 'critical' },
  overlap: { label: 'Trùng lịch', severity: 'critical' },
  leave: { label: 'Giáo viên đang nghỉ', severity: 'critical' },
  travel: { label: 'Không kịp di chuyển', severity: 'warning' },
  preference: { label: 'Vi phạm nguyện vọng', severity: 'info' },
  refer: { label: 'Ngoài danh sách Refer', severity: 'info' },
}

export const ISSUE_KINDS: IssueKind[] = ['uncovered', 'overlap', 'leave', 'travel', 'preference', 'refer']

const labelOf = (t: Teacher | undefined, id: string) => (t ? teacherLabel(t) : id)

export function weekIssues(ctx: WeekContext): Issue[] {
  const out: Issue[] = []
  for (const l of ctx.week.lessons) {
    if (l.status === 'needs_cover' || (!l.teacherId && needsTeacher(l))) {
      out.push({ kind: 'uncovered', lesson: l, detail: l.originalTeacherId ? `${labelOf(ctx.teacherById.get(l.originalTeacherId), l.originalTeacherId)} không dạy được` : 'Ca mới, chưa phân công' })
      continue
    }
    if (l.status !== 'assigned' || !l.teacherId) continue
    const t = ctx.teacherById.get(l.teacherId)
    if (!t) continue
    const day = ctx.dayLessons.get(`${t.id}|${l.date}`) ?? []
    const school = ctx.schoolById.get(l.schoolId)
    for (const b of blockers(t, l, day, ctx.world.leaves, ctx.book, ctx.settings)) {
      if (b.kind === 'leave') {
        out.push({ kind: 'leave', lesson: l, detail: `${teacherLabel(t)}: ${b.note}` })
        continue
      }
      // Mỗi cặp chỉ báo một lần, gắn vào ca diễn ra sau.
      if (byTime(b.with, l) > 0 || (byTime(b.with, l) === 0 && b.with.id > l.id)) continue
      const fromSchool = ctx.schoolById.get(b.with.schoolId)?.fullName ?? 'trường khác'
      if (b.kind === 'overlap') {
        out.push({ kind: 'overlap', lesson: l, related: b.with, detail: `${teacherLabel(t)} cùng lúc dạy ${b.with.className ?? 'ca khác'} (${b.with.start ?? `tiết ${b.with.period}`}) tại ${fromSchool}` })
      } else {
        const km = ctx.book.between(b.with.schoolId, l.schoolId).km
        out.push({ kind: 'travel', lesson: l, related: b.with, needMin: b.needMin, gapMin: b.gapMin, km, detail: `${teacherLabel(t)} từ ${fromSchool} sang: cần ${b.needMin}′ cho ${km} km, chỉ có ${b.gapMin}′` })
      }
    }
    for (const v of preferenceViolations(t, l, school)) out.push({ kind: 'preference', lesson: l, detail: `${teacherLabel(t)}: ${v.label}` })
    if (l.code && TEACHING_CODES.has(l.code) && school && !school.referredTeacherIds.includes(t.id)) {
      out.push({ kind: 'refer', lesson: l, detail: `${teacherLabel(t)} không thuộc danh sách Refer của trường` })
    }
  }
  return out
}

/** Một cảnh báo liên quan tới cả hai trường trong cặp trùng lịch / không kịp. */
export const touchesSchool = (i: Issue, schoolId: string) => i.lesson.schoolId === schoolId || i.related?.schoolId === schoolId

export type Health = 'critical' | 'warning' | 'ok'

/** Đỏ: trùng lịch, ca trống, GV đang nghỉ. Vàng: không kịp di chuyển. Refer và nguyện vọng vẫn là ok, chỉ hiện trong tóm tắt. */
export function healthOf(issues: Issue[]): Health {
  if (issues.some((i) => ISSUE_META[i.kind].severity === 'critical')) return 'critical'
  return issues.some((i) => ISSUE_META[i.kind].severity === 'warning') ? 'warning' : 'ok'
}

export function coverage(lessons: Lesson[]) {
  const required = lessons.filter(needsTeacher)
  const covered = required.filter((l) => l.status === 'assigned' && l.teacherId).length
  return { required: required.length, covered, ratio: required.length ? covered / required.length : 1 }
}

/** Số ca cần giáo viên của từng trường: tiêu chí sắp xếp danh sách trường. */
export function schoolLoad(lessons: Lesson[]) {
  const load = new Map<string, number>()
  for (const l of lessons) if (needsTeacher(l)) load.set(l.schoolId, (load.get(l.schoolId) ?? 0) + 1)
  return load
}

/** Điểm sắp xếp "nhiều lỗi nhất": lỗi nghiêm trọng trước, rồi không kịp, rồi ghi chú. */
export function issueScore(issues: Issue[]) {
  const n = (s: Severity) => issues.filter((i) => ISSUE_META[i.kind].severity === s).length
  return { urgent: n('critical') + n('warning'), rank: n('critical') * 1e6 + n('warning') * 1e3 + n('info') }
}

const issueKey = (i: Issue) => `${i.kind}|${i.lesson.id}|${i.related?.id ?? ''}`

/** Cảnh báo sẽ phát sinh thêm sau một thay đổi: dùng để báo trước khi người dùng bấm lưu. */
export function newIssues(before: Issue[], after: Issue[]): Issue[] {
  const known = new Set(before.map(issueKey))
  return after.filter((i) => !known.has(issueKey(i)))
}
