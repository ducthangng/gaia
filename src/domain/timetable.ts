import { toMin } from './time'
import type { Lesson } from './types'

export const DEFAULT_LESSON_MIN = 35

export interface PlacedLesson {
  lesson: Lesson
  lane: number
  startMin: number
  endMin: number
}

export interface DayLayout {
  placed: PlacedLesson[]
  /** Số làn song song lớn nhất trong ngày: quyết định độ rộng cột. */
  lanes: number
  /** Ca không có giờ cụ thể, hiện ở dải trên cùng thay vì đoán vị trí. */
  untimed: Lesson[]
}

/** Xếp ca vào các làn: ca trùng giờ nằm cạnh nhau, ca nối tiếp dùng chung làn. */
export function layoutDay(lessons: Lesson[]): DayLayout {
  const timed = lessons
    .filter((l) => toMin(l.start) !== null)
    .map((lesson) => {
      const startMin = toMin(lesson.start)!
      const end = toMin(lesson.end)
      return { lesson, startMin, endMin: end !== null && end > startMin ? end : startMin + DEFAULT_LESSON_MIN }
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin)
  const laneEnds: number[] = []
  const placed = timed.map((t) => {
    let lane = laneEnds.findIndex((end) => end <= t.startMin)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = t.endMin
    return { ...t, lane }
  })
  return { placed, lanes: laneEnds.length, untimed: lessons.filter((l) => toMin(l.start) === null) }
}

/** Khung giờ hiển thị, làm tròn theo giờ. Mặc định 07:00-17:00 để các tuần dễ so sánh. */
export function hourRange(lessons: Lesson[]): { from: number; to: number } {
  let from = 7
  let to = 17
  for (const l of lessons) {
    const s = toMin(l.start)
    const e = toMin(l.end) ?? (s === null ? null : s + DEFAULT_LESSON_MIN)
    if (s !== null) from = Math.min(from, Math.floor(s / 60))
    if (e !== null) to = Math.max(to, Math.ceil(e / 60))
  }
  return { from, to }
}
