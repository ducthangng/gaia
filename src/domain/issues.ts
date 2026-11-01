import { blockers, blockerLabel, preferenceViolations } from './constraints'
import type { WeekContext } from './context'
import { needsTeacher, TEACHING_CODES, type Lesson } from './types'

export type IssueKind = 'uncovered' | 'conflict' | 'preference' | 'refer'

export interface Issue {
  kind: IssueKind
  lesson: Lesson
  detail: string
}

export const ISSUE_META: Record<IssueKind, { label: string; severity: 'critical' | 'warning' | 'info' }> = {
  uncovered: { label: 'Chưa có giáo viên', severity: 'critical' },
  conflict: { label: 'Trùng lịch / không kịp di chuyển', severity: 'critical' },
  preference: { label: 'Vi phạm nguyện vọng', severity: 'warning' },
  refer: { label: 'Ngoài danh sách Refer', severity: 'info' },
}

export function weekIssues(ctx: WeekContext): Issue[] {
  const out: Issue[] = []
  for (const l of ctx.week.lessons) {
    if (l.status === 'needs_cover' || (!l.teacherId && needsTeacher(l))) {
      out.push({ kind: 'uncovered', lesson: l, detail: l.originalTeacherId ? `${ctx.teacherById.get(l.originalTeacherId)?.name ?? l.originalTeacherId} không dạy được` : 'Ca mới, chưa phân công' })
      continue
    }
    if (l.status !== 'assigned' || !l.teacherId) continue
    const t = ctx.teacherById.get(l.teacherId)
    if (!t) continue
    const day = ctx.dayLessons.get(`${t.id}|${l.date}`) ?? []
    const school = ctx.schoolById.get(l.schoolId)
    const blocks = blockers(t, l, day, ctx.world.leaves, ctx.book, ctx.settings)
    // Mỗi cặp trùng lịch chỉ báo ở ca sau; riêng nghỉ phép thì báo ở mọi ca.
    const relevant = blocks.filter((b) => b.kind === 'leave' || (b.with.start ?? '') < (l.start ?? '') || ((b.with.start ?? '') === (l.start ?? '') && b.with.id < l.id))
    if (relevant.length) out.push({ kind: 'conflict', lesson: l, detail: relevant.map(blockerLabel).join('; ') })
    for (const v of preferenceViolations(t, l, school)) out.push({ kind: 'preference', lesson: l, detail: v.label })
    if (l.code && TEACHING_CODES.has(l.code) && school && !school.referredTeacherIds.includes(t.id)) {
      out.push({ kind: 'refer', lesson: l, detail: `${t.name} không thuộc danh sách Refer của trường` })
    }
  }
  return out
}

export function coverage(lessons: Lesson[]) {
  const required = lessons.filter(needsTeacher)
  const covered = required.filter((l) => l.status === 'assigned' && l.teacherId).length
  return { required: required.length, covered, ratio: required.length ? covered / required.length : 1 }
}
