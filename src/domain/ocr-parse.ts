export interface OcrWord {
  text: string
  x0: number
  y0: number
  x1: number
  y1: number
  confidence: number
}

export interface OcrRow {
  id: string
  day: number | null
  start: string | null
  end: string | null
  className: string | null
  subject: string | null
  confidence: number
  raw: string
}

const DAY_RE = /^(?:th[uứ]|t)\s*\.?\s*([2-7]|hai|ba|t[uư]|n[aă]m|s[aá]u|b[aả]y)$/i
const DAY_NAMES: Record<string, number> = { hai: 0, ba: 1, 'tư': 2, tu: 2, 'năm': 3, nam: 3, 'sáu': 4, sau: 4, 'bảy': 5, bay: 5 }

export function parseDayToken(s: string): number | null {
  const m = s.trim().match(DAY_RE)
  if (!m) return null
  const v = m[1].toLowerCase()
  return /^\d$/.test(v) ? Number(v) - 2 : (DAY_NAMES[v] ?? null)
}

const TIME_RANGE = /(\d{1,2})\s*[h:.]\s*(\d{2})?\s*[-–—~]+\s*(\d{1,2})\s*[h:.]\s*(\d{2})?/
const CLASS_RE = /\b(\d{1,2}\s?[A-Za-z]\d{0,2}|\d{1,2}[/.]\d{1,2})\b/

const pad = (h: string, m?: string) => `${h.padStart(2, '0')}:${(m ?? '00').padStart(2, '0')}`

export const parseTimeRange = (s: string) => {
  const m = s.match(TIME_RANGE)
  return m ? { start: pad(m[1], m[2]), end: pad(m[3], m[4]), text: m[0] } : null
}

export function parseSubject(s: string): string | null {
  const t = s.toLowerCase()
  if (/robotic/.test(t)) return 'STEM AI - ROBOTICS'
  if (/stem[\s-]*a[il1|]\b/.test(t)) return 'STEM-AI'
  if (/stem|steam/.test(t)) return 'STEM'
  if (/\bkns\b|k[yỹ] n[aă]ng s[oố]ng/.test(t)) return 'KNS'
  if (/\bcds\b|c[oô]ng d[aâ]n s[oố]/.test(t)) return 'CDS'
  if (/\ba[il1|]\b/.test(t)) return 'AI' // OCR hay đọc AI thành Al
  return null
}

export const parseClass = (s: string) => s.match(CLASS_RE)?.[1].replace(/\s/g, '').toUpperCase() ?? null

interface Line {
  words: OcrWord[]
  y: number
  text: string
}

function toLines(words: OcrWord[]): Line[] {
  const sorted = words.filter((w) => w.text.trim()).sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2)
  const lines: OcrWord[][] = []
  for (const w of sorted) {
    const cy = (w.y0 + w.y1) / 2
    const h = Math.max(w.y1 - w.y0, 1)
    const last = lines.at(-1)
    if (last && Math.abs((last[0].y0 + last[0].y1) / 2 - cy) < h * 0.6) last.push(w)
    else lines.push([w])
  }
  return lines.map((l) => {
    const s = l.sort((a, b) => a.x0 - b.x0)
    return { words: s, y: (s[0].y0 + s[0].y1) / 2, text: s.map((w) => w.text).join(' ') }
  })
}

/** Tìm các cột Thứ trên dòng tiêu đề; "Thứ" và "2" có thể bị OCR tách thành hai từ. */
function findDayColumns(line: Line) {
  const cols: { day: number; x: number }[] = []
  const w = line.words
  for (let i = 0; i < w.length; i++) {
    const one = parseDayToken(w[i].text)
    if (one !== null) {
      cols.push({ day: one, x: (w[i].x0 + w[i].x1) / 2 })
      continue
    }
    if (i + 1 < w.length) {
      const two = parseDayToken(`${w[i].text} ${w[i + 1].text}`)
      if (two !== null) {
        cols.push({ day: two, x: (w[i].x0 + w[i + 1].x1) / 2 })
        i++
      }
    }
  }
  return cols
}

/** Tâm của mọi nhãn Thứ trong ảnh, không phụ thuộc việc chúng có nằm cùng một dòng hay không. */
function dayTokenCenters(words: OcrWord[]) {
  const out: { x: number; y: number }[] = []
  for (const w of words) {
    const h = Math.max(w.y1 - w.y0, 1)
    if (parseDayToken(w.text) !== null) {
      out.push({ x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2 })
      continue
    }
    const next = words
      .filter((o) => o !== w && o.x0 >= w.x1 - h * 0.2 && o.x0 - w.x1 < h * 3 && Math.abs(o.y0 + o.y1 - w.y0 - w.y1) / 2 < h)
      .sort((a, b) => a.x0 - b.x0)[0]
    if (next && parseDayToken(`${w.text} ${next.text}`) !== null) {
      out.push({ x: (w.x0 + next.x1) / 2, y: (w.y0 + w.y1 + next.y0 + next.y1) / 4 })
    }
  }
  return out
}

const MAX_SKEW = 0.15 // khoảng 8.5 độ; nghiêng hơn thì nên chụp lại

/**
 * Ảnh chụp hiếm khi thẳng. Nghiêng chỉ 1 độ đã đủ làm các nhãn Thứ rơi vào nhiều dòng khác nhau và
 * đẩy ca sang sai cột, nên ước lượng độ nghiêng từ dòng tiêu đề rồi xoay lại toạ độ các từ.
 */
function deskew(words: OcrWord[]): OcrWord[] {
  const pts = dayTokenCenters(words)
  if (pts.length < 2) return words
  const mx = avg(pts.map((p) => p.x))
  const my = avg(pts.map((p) => p.y))
  const sxx = pts.reduce((s, p) => s + (p.x - mx) ** 2, 0)
  const syy = pts.reduce((s, p) => s + (p.y - my) ** 2, 0)
  // Nhãn Thứ xếp dọc nghĩa là ảnh dạng danh sách, không có dòng tiêu đề để đo.
  if (sxx <= syy) return words
  const slope = pts.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx
  if (Math.abs(slope) > MAX_SKEW || Math.abs(slope) < 0.002) return words
  return words.map((w) => {
    const cx = (w.x0 + w.x1) / 2
    const cy = (w.y0 + w.y1) / 2
    const dx = slope * (cy - my)
    const dy = -slope * (cx - mx)
    return { ...w, x0: w.x0 + dx, x1: w.x1 + dx, y0: w.y0 + dy, y1: w.y1 + dy }
  })
}

let seq = 0
const rowId = () => `ocr-${++seq}`
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/**
 * Hai dạng ảnh lịch thường gặp:
 *  - Bảng: dòng tiêu đề Thứ 2..7, cột đầu là khung giờ, mỗi ô có lớp + môn.
 *  - Danh sách: mỗi dòng "Thứ 2 7h30-8h05 5A3 STEM".
 * Không đọc được trường nào thì để trống cho người duyệt sửa, không đoán.
 */
export function parseSchedule(rawWords: OcrWord[]): OcrRow[] {
  const lines = toLines(deskew(rawWords))
  const headerIndex = lines.findIndex((l) => findDayColumns(l).length >= 2)
  if (headerIndex === -1) return parseList(lines)

  const cols = findDayColumns(lines[headerIndex]).sort((a, b) => a.x - b.x)
  const spacing = avg(cols.slice(1).map((c, i) => c.x - cols[i].x))
  const leftEdge = cols[0].x - spacing / 2
  const inTimeColumn = (w: OcrWord) => w.x1 <= leftEdge + spacing * 0.15
  const body = lines.slice(headerIndex + 1)

  // Mốc dòng là các khung giờ ở cột đầu. Chữ trong ô được gán theo mốc gần nhất vì ô căn giữa
  // thường có tên lớp nằm cao hơn dòng giờ, nên không thể đọc tuần tự từ trên xuống.
  const anchors = body.flatMap((line) => {
    const left = line.words.filter(inTimeColumn)
    const parsed = parseTimeRange(left.map((w) => w.text).join(' '))
    return parsed ? [{ y: avg(left.map((w) => (w.y0 + w.y1) / 2)), start: parsed.start, end: parsed.end }] : []
  })
  if (!anchors.length) return parseList(lines)

  const cells = new Map<string, OcrWord[]>()
  for (const line of body) {
    for (const w of line.words) {
      if (inTimeColumn(w)) continue
      const cy = (w.y0 + w.y1) / 2
      const row = anchors.reduce((best, a, i) => (Math.abs(a.y - cy) < Math.abs(anchors[best].y - cy) ? i : best), 0)
      const cx = (w.x0 + w.x1) / 2
      const col = cols.reduce((best, c) => (Math.abs(c.x - cx) < Math.abs(best.x - cx) ? c : best))
      const key = `${row}|${col.day}`
      cells.set(key, [...(cells.get(key) ?? []), w])
    }
  }
  const rows: OcrRow[] = []
  for (const [key, ws] of [...cells].sort(([a], [b]) => {
    const [ra, da] = a.split('|').map(Number)
    const [rb, db] = b.split('|').map(Number)
    return ra - rb || da - db
  })) {
    const [row, day] = key.split('|').map(Number)
    const raw = ws.map((w) => w.text).join(' ')
    const className = parseClass(raw)
    const subject = parseSubject(raw)
    if (!className && !subject) continue
    rows.push({ id: rowId(), day, start: anchors[row].start, end: anchors[row].end, className, subject, confidence: Math.round(avg(ws.map((w) => w.confidence))), raw })
  }
  return rows
}

function parseList(lines: Line[]): OcrRow[] {
  const rows: OcrRow[] = []
  let day: number | null = null
  for (const line of lines) {
    const dm = line.text.match(/\b(?:th[uứ]|t)\s*\.?\s*([2-7]|hai|ba|t[uư]|n[aă]m|s[aá]u|b[aả]y)\b/i)
    if (dm) day = parseDayToken(dm[0])
    const t = parseTimeRange(line.text)
    const rest = t ? line.text.replace(t.text, ' ') : line.text
    const body = dm ? rest.replace(dm[0], ' ') : rest
    const className = parseClass(body)
    const subject = parseSubject(body)
    if (!t && !className) continue
    rows.push({ id: rowId(), day, start: t?.start ?? null, end: t?.end ?? null, className, subject, confidence: Math.round(avg(line.words.map((w) => w.confidence))), raw: line.text })
  }
  return rows
}

export const subjectCode = (subject: string | null) =>
  !subject ? null : subject === 'KNS' ? 'K' : subject.startsWith('STEM') ? 'S' : 'C'


/**
 * Xoá đường kẻ bảng trên ảnh nhị phân (1 = mực): đường kẻ làm Tesseract đọc sai toàn bộ ô.
 * Vệt mực liên tục dài hơn minRun được coi là đường kẻ; chữ không bao giờ có vệt dài như vậy.
 */
export function removeTableLines(ink: Uint8Array, width: number, height: number, minRun = Math.max(40, Math.floor(Math.min(width, height) * 0.05))) {
  const out = ink.slice()
  for (let y = 0; y < height; y++) {
    let start = -1
    for (let x = 0; x <= width; x++) {
      const on = x < width && ink[y * width + x] === 1
      if (on && start < 0) start = x
      if (!on && start >= 0) {
        if (x - start >= minRun) out.fill(0, y * width + start, y * width + x)
        start = -1
      }
    }
  }
  for (let x = 0; x < width; x++) {
    let start = -1
    for (let y = 0; y <= height; y++) {
      const on = y < height && ink[y * width + x] === 1
      if (on && start < 0) start = y
      if (!on && start >= 0) {
        if (y - start >= minRun) for (let k = start; k < y; k++) out[k * width + x] = 0
        start = -1
      }
    }
  }
  return out
}

/** Ngưỡng Otsu cho ảnh xám. */
export function otsuThreshold(gray: Uint8Array) {
  const hist = new Array(256).fill(0)
  for (const v of gray) hist[v]++
  const total = gray.length
  const sum = hist.reduce((acc, n, i) => acc + n * i, 0)
  let sumB = 0
  let weightB = 0
  let best = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    weightB += hist[t]
    if (!weightB || weightB === total) continue
    sumB += t * hist[t]
    const diff = sumB / weightB - (sum - sumB) / (total - weightB)
    const between = weightB * (total - weightB) * diff * diff
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}
