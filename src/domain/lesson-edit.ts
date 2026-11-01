import { subjectCode } from './ocr-parse'
import { toMin } from './time'
import { TEACHING_CODES, type Lesson, type LessonType, type Session } from './types'

export interface LessonDraft {
  date: string
  start: string
  end: string
  className: string
  subject: string
  teacherId: string
  note: string
}

export const sessionOf = (start: string | null): Session => (start && start >= '12:00' ? 'PM' : 'AM')

export const draftFrom = (l: Lesson): LessonDraft => ({
  date: l.date,
  start: l.start ?? '',
  end: l.end ?? '',
  className: l.className ?? '',
  subject: l.subject ?? '',
  teacherId: l.teacherId ?? '',
  note: l.note ?? '',
})

/** Lỗi khiến chưa lưu được. Trùng lịch thì chỉ cảnh báo, vì điều phối có thể đang xếp dở. */
export function draftErrors(d: LessonDraft): string[] {
  const out: string[] = []
  if (!d.start || !d.end) out.push('Cần có giờ bắt đầu và giờ kết thúc')
  else if (toMin(d.end)! <= toMin(d.start)!) out.push('Giờ kết thúc phải sau giờ bắt đầu')
  if (!d.className.trim() && !d.note.trim()) out.push('Cần có tên lớp hoặc ghi chú')
  return out
}

/** Đổi giáo viên giữ đúng logic dạy thay: có GV gốc khác người mới là dạy thay, trả về GV gốc là ca thường. */
function withTeacher(l: Lesson, teacherId: string | null): Pick<Lesson, 'teacherId' | 'originalTeacherId' | 'status' | 'type'> {
  const settled = l.status === 'school_off' || l.status === 'replaced' || l.status === 'cancelled'
  const original = l.originalTeacherId === teacherId ? null : l.originalTeacherId
  const type: LessonType = !teacherId ? l.type : original ? 'substitute' : l.type === 'substitute' ? 'regular' : l.type
  return { teacherId, originalTeacherId: original, type, status: settled ? l.status : teacherId ? 'assigned' : 'needs_cover' }
}

/** Đổi người dạy của một ca, giữ đúng logic dạy thay. */
export const reassign = (l: Lesson, teacherId: string | null): Lesson => ({ ...l, ...withTeacher(l, teacherId) })

export function applyDraft(l: Lesson, d: LessonDraft): Lesson {
  const subject = d.subject.trim() || null
  const teaching = l.code !== null && TEACHING_CODES.has(l.code)
  return {
    ...l,
    ...withTeacher(l, d.teacherId || null),
    date: d.date,
    start: d.start || null,
    end: d.end || null,
    session: d.start ? sessionOf(d.start) : l.session,
    className: d.className.trim() || null,
    subject,
    // Đổi môn thì đổi luôn mã quy đổi tiết, nếu đây là ca dạy chính.
    code: teaching && subject !== l.subject ? subjectCode(subject) : l.code,
    note: d.note.trim() || null,
  }
}

export function newLesson(id: string, weekId: string, schoolId: string, d: LessonDraft): Lesson {
  const base: Lesson = {
    id, weekId, schoolId, teacherId: null, originalTeacherId: null, date: d.date, session: 'AM', period: 1, track: 0,
    className: null, subject: null, start: null, end: null, code: subjectCode(d.subject.trim() || null), company: null, note: null, type: 'regular', status: 'needs_cover',
  }
  return applyDraft(base, d)
}

export interface BulkScope {
  schoolId: string
  /** Rỗng = cả tuần. */
  date: string
  session: Session | 'ALL'
  /** Rỗng = mọi giáo viên. */
  teacherId: string
}

export const inScope = (l: Lesson, s: BulkScope) =>
  l.schoolId === s.schoolId &&
  (!s.date || l.date === s.date) &&
  (s.session === 'ALL' || l.session === s.session) &&
  (!s.teacherId || l.teacherId === s.teacherId) &&
  l.status !== 'replaced'

export type BulkAction =
  | { kind: 'school_off' }
  | { kind: 'restore' }
  | { kind: 'move'; toDate: string }
  | { kind: 'shift'; minutes: number }
  | { kind: 'teacher'; toTeacherId: string }

const shiftTime = (t: string | null, minutes: number) => {
  const m = toMin(t)
  if (m === null) return t
  const next = Math.min(23 * 60 + 59, Math.max(0, m + minutes))
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`
}

/** Ca không đổi được thì giữ nguyên object để biết chính xác bao nhiêu ca thực sự thay đổi. */
export function applyBulk(lessons: Lesson[], scope: BulkScope, action: BulkAction): Lesson[] {
  return lessons.map((l) => {
    if (!inScope(l, scope)) return l
    switch (action.kind) {
      case 'school_off':
        return l.status === 'school_off' ? l : { ...l, status: 'school_off' }
      case 'restore':
        return l.status === 'school_off' ? { ...l, status: l.teacherId ? 'assigned' : 'needs_cover' } : l
      case 'move':
        return l.date === action.toDate ? l : { ...l, date: action.toDate }
      case 'shift': {
        if (!l.start || !action.minutes) return l
        const start = shiftTime(l.start, action.minutes)
        return { ...l, start, end: shiftTime(l.end, action.minutes), session: sessionOf(start) }
      }
      case 'teacher':
        return (l.teacherId ?? '') === action.toTeacherId ? l : { ...l, ...withTeacher(l, action.toTeacherId || null) }
    }
  })
}

