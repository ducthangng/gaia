import { TEACHING_CODES, type Lesson, type Session } from './types'

export interface LeaveRange {
  teacherId: string
  from: string
  to: string
  sessions: Session[]
}

const inRange = (l: Lesson, r: LeaveRange) => l.date >= r.from && l.date <= r.to && r.sessions.includes(l.session)

/** Các ca bị ảnh hưởng nếu GV nghỉ: dùng để xem trước khi xác nhận. */
export const affectedByLeave = (lessons: Lesson[], r: LeaveRange) =>
  lessons.filter((l) => l.teacherId === r.teacherId && l.status === 'assigned' && inRange(l, r))

const isTeaching = (l: Lesson) => l.code === null ? l.className !== null : TEACHING_CODES.has(l.code)

/** Ca dạy chuyển sang cần người thay; ca hỗ trợ/chuyên đề của GV đó thì huỷ, không cần tìm người thay. */
export const applyLeave = (lessons: Lesson[], r: LeaveRange): Lesson[] =>
  lessons.map((l) =>
    l.teacherId === r.teacherId && l.status === 'assigned' && inRange(l, r)
      ? { ...l, teacherId: null, originalTeacherId: r.teacherId, status: isTeaching(l) ? 'needs_cover' : 'cancelled' }
      : l,
  )

/** Huỷ nghỉ: trả ca về GV nếu chưa có ai nhận thay. Ca đã có người thay thì giữ nguyên. */
export const revertLeave = (lessons: Lesson[], r: LeaveRange): Lesson[] =>
  lessons.map((l) =>
    l.originalTeacherId === r.teacherId && !l.teacherId && (l.status === 'needs_cover' || l.status === 'cancelled') && inRange(l, r)
      ? { ...l, teacherId: r.teacherId, originalTeacherId: null, status: 'assigned' }
      : l,
  )
