import type { DistanceBook } from './distance'
import { dayIndex, toMin } from './time'
import type { Leave, Lesson, School, Settings, Teacher } from './types'

export type Blocker =
  | { kind: 'leave'; note: string }
  | { kind: 'overlap'; with: Lesson }
  | { kind: 'travel'; with: Lesson; needMin: number; gapMin: number }

export interface PrefViolation {
  label: string
}

// Khu vực có trong cột KHU VỰC (nơi GV mong muốn đi dạy); trường ở nơi khác (Hồ Tràm, Long Hải...) không so được.
const KNOWN_AREAS = new Set(['PHÚ MỸ', 'CHÂU ĐỨC', 'BÀ RỊA', 'VŨNG TÀU', 'PHƯỚC HẢI'])

const appliesOn = (days: number[] | undefined, date: string) => !days?.length || days.includes(dayIndex(date))

/** Nguyện vọng cá nhân: vi phạm được cảnh báo chứ không chặn cứng. */
export function preferenceViolations(t: Teacher, l: Lesson, school: School | undefined, km?: number): PrefViolation[] {
  const out: PrefViolation[] = []
  const start = toMin(l.start)
  const end = toMin(l.end)
  for (const p of t.preferences) {
    if (!appliesOn(p.days, l.date)) continue
    if (p.type === 'finishBy' && end !== null && end > toMin(p.time)!) {
      out.push({ label: p.note || `Muốn kết thúc trước ${p.time}` })
    } else if (p.type === 'startAfter' && start !== null && start < toMin(p.time)!) {
      out.push({ label: p.note || `Muốn bắt đầu sau ${p.time}` })
    } else if (p.type === 'noSession' && p.session === l.session) {
      out.push({ label: p.note || `Không nhận ca ${p.session === 'AM' ? 'sáng' : 'chiều'}` })
    }
  }
  const region = school?.region?.trim().toUpperCase()
  if (t.areas.length && region && KNOWN_AREAS.has(region) && !t.areas.includes(region)) {
    out.push({ label: `Ngoài khu vực mong muốn (${t.areas.join(', ')})` })
  }
  if (t.maxKm !== null && km !== undefined && km > t.maxKm) {
    out.push({ label: `Vượt phạm vi di chuyển ${t.maxKm} km` })
  }
  if (school?.genderPreference && t.gender && t.gender !== school.genderPreference) {
    out.push({ label: `Trường ưu tiên GV ${school.genderPreference === 'F' ? 'nữ' : 'nam'}` })
  }
  return out
}

/**
 * Điều kiện cứng: không nghỉ phép, không trùng giờ, đủ thời gian di chuyển giữa hai trường.
 * Ca thiếu giờ thì so theo buổi + tiết.
 */
export function blockers(
  t: Teacher,
  l: Lesson,
  dayLessons: Lesson[],
  leaves: Leave[],
  book: DistanceBook,
  s: Settings,
): Blocker[] {
  const out: Blocker[] = []
  if (t.onlineOnly) out.push({ kind: 'leave', note: 'Chỉ làm việc online' })
  const leave = leaves.find((x) => x.teacherId === t.id && x.date === l.date && x.session === l.session)
  if (leave) out.push({ kind: 'leave', note: leave.note })
  const start = toMin(l.start)
  const end = toMin(l.end)
  for (const other of dayLessons) {
    if (other.id === l.id || other.status !== 'assigned') continue
    const a = toMin(other.start)
    const b = toMin(other.end)
    if (start === null || end === null || a === null || b === null) {
      if (other.session === l.session && other.period === l.period) out.push({ kind: 'overlap', with: other })
      continue
    }
    if (start < b && a < end) {
      out.push({ kind: 'overlap', with: other })
    } else if (other.schoolId !== l.schoolId) {
      const gap = start >= b ? start - b : a - end
      const need = (book.between(other.schoolId, l.schoolId).km / s.travelSpeedKmh) * 60 + s.travelBufferMin
      if (gap < need) out.push({ kind: 'travel', with: other, needMin: Math.ceil(need), gapMin: gap })
    }
  }
  return out
}

export const blockerLabel = (b: Blocker) =>
  b.kind === 'leave'
    ? b.note
    : b.kind === 'overlap'
      ? `Trùng ca ${b.with.start ?? `tiết ${b.with.period}`}${b.with.className ? ` lớp ${b.with.className}` : ''}`
      : `Không kịp di chuyển: cần ${b.needMin}′, chỉ có ${b.gapMin}′`
