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

/** Tên viết hoa toàn bộ chiếm nhiều chỗ và khó đọc trong ô nhỏ. */
export const prettyName = (name: string) =>
  name.toLocaleLowerCase('vi').replace(/(^|\s)(\p{L})/gu, (_, sp: string, ch: string) => sp + ch.toLocaleUpperCase('vi'))

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
    laneEnds[lane] = Math.max(t.endMin, t.startMin + MIN_VISUAL_MIN)
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

/** Ca ngắn vẫn cần đủ chỗ để đọc: khi xếp làn và vẽ, coi như dài tối thiểu từng này phút. */
export const MIN_VISUAL_MIN = 35

export type AxisSegment =
  | { kind: 'slots'; from: number; to: number }
  | { kind: 'gap'; from: number; to: number }

const GAP_COLLAPSE_MIN = 60

/**
 * Trục giờ: khoảng trống từ 1 tiếng trở lên (ví dụ giờ nghỉ trưa) thu lại thành một dải,
 * để buổi sáng và buổi chiều cùng nằm trong một màn hình.
 */
export function buildAxis(placed: { startMin: number; endMin: number }[]): AxisSegment[] {
  if (!placed.length) return [{ kind: 'slots', from: 7 * 60, to: 17 * 60 }]
  const spans = placed
    .map((p) => ({ from: Math.floor(p.startMin / 15) * 15, to: Math.ceil(Math.max(p.endMin, p.startMin + MIN_VISUAL_MIN) / 15) * 15 }))
    .sort((a, b) => a.from - b.from)
  const merged: { from: number; to: number }[] = []
  for (const s of spans) {
    const last = merged.at(-1)
    if (last && s.from - last.to < GAP_COLLAPSE_MIN) last.to = Math.max(last.to, s.to)
    else merged.push({ ...s })
  }
  const out: AxisSegment[] = []
  merged.forEach((m, i) => {
    if (i > 0) out.push({ kind: 'gap', from: merged[i - 1].to, to: m.from })
    out.push({ kind: 'slots', ...m })
  })
  return out
}

/** Quy đổi phút trong ngày thành toạ độ dọc theo trục đã thu gọn. */
export function axisY(axis: AxisSegment[], minute: number, rowPx: number, gapPx: number): number {
  let y = 0
  for (const seg of axis) {
    if (seg.kind === 'gap') {
      if (minute < seg.to) return y
      y += gapPx
    } else {
      if (minute <= seg.to) return y + (Math.max(minute - seg.from, 0) / 15) * rowPx
      y += ((seg.to - seg.from) / 15) * rowPx
    }
  }
  return y
}

export const axisHeight = (axis: AxisSegment[], rowPx: number, gapPx: number) =>
  axis.reduce((h, seg) => h + (seg.kind === 'gap' ? gapPx : ((seg.to - seg.from) / 15) * rowPx), 0)
