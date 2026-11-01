import { addDays, diffDays } from './time'
import { TEACHING_CODES, type Leave, type Lesson, type Week } from './types'

/**
 * Sao chép lịch cố định sang tuần mới. Bỏ ca phát sinh một lần (dạy bù, hỗ trợ, chuyên đề, dự giờ);
 * ca dạy thay trả về GV gốc; ca trùng ngày nghỉ đã đăng ký thì chuyển sang cần cover.
 */
export function cloneWeek(source: Week, newStart: string, leaves: Leave[], makeId: () => string): Week {
  const shift = diffDays(newStart, source.startDate)
  const lessons: Lesson[] = []
  const seen = new Set<string>()
  for (const l of source.lessons) {
    if (!l.code || !TEACHING_CODES.has(l.code)) {
      // Ca trường báo nghỉ / GV nghỉ không có mã quy đổi nhưng vẫn là lớp cố định.
      if (!(l.status !== 'assigned' && l.className)) continue
    }
    if (l.type === 'makeup' || l.type === 'observe' || l.type === 'support' || l.type === 'event') continue
    const date = addDays(l.date, shift)
    const teacherId = l.originalTeacherId ?? l.teacherId
    const key = `${date}|${l.schoolId}|${l.className}|${l.start}|${l.subject}`
    if (seen.has(key)) continue
    seen.add(key)
    const onLeave = teacherId !== null && leaves.some((x) => x.teacherId === teacherId && x.date === date && x.session === l.session)
    lessons.push({
      ...l,
      id: makeId(),
      weekId: newStart,
      date,
      teacherId: onLeave ? null : teacherId,
      originalTeacherId: onLeave ? teacherId : null,
      status: onLeave || !teacherId ? 'needs_cover' : 'assigned',
      type: 'regular',
      note: null,
      track: 0,
    })
  }
  return {
    id: newStart,
    label: `Tuần ${newStart.slice(8, 10)}/${newStart.slice(5, 7)}`,
    startDate: newStart,
    endDate: addDays(newStart, 6),
    status: 'planning',
    lessons,
    legs: [],
  }
}
