import { describe, expect, it } from 'vitest'
import { otsuThreshold, parseClass, parseDayToken, parseSchedule, parseSubject, parseTimeRange, removeTableLines, type OcrWord } from './ocr-parse'
import { detectMonday, gvizCsvUrl, parseCsv, parsePreferencesGrid, parseReferGrid, parseWeekGrid, sheetIdFromUrl } from './sheet-grid'

const word = (text: string, x: number, y: number, confidence = 90): OcrWord => ({ text, x0: x, x1: x + text.length * 8, y0: y, y1: y + 14, confidence })

describe('OCR', () => {
  it('nhận thứ, giờ, lớp, môn', () => {
    expect(['Thứ 2', 'thu 7', 'T3', 'Thứ Tư', 'Thứ Bảy'].map(parseDayToken)).toEqual([0, 5, 1, 2, 5])
    expect(parseDayToken('Tiết')).toBeNull()
    expect(parseTimeRange('07h30 - 08h05')).toMatchObject({ start: '07:30', end: '08:05' })
    expect(parseTimeRange('14:00–14:35')).toMatchObject({ start: '14:00', end: '14:35' })
    expect(['5A3 STEM', 'lớp 3/5', '9A4', '3.4'].map(parseClass)).toEqual(['5A3', '3/5', '9A4', '3.4'])
    expect(['STEM', 'Công dân số', 'Kỹ năng sống', 'stem - AI', 'Toán', 'Al', 'STEM-Al'].map(parseSubject)).toEqual(['STEM', 'CDS', 'KNS', 'STEM-AI', null, 'AI', 'STEM-AI'])
  })

  it('đọc bảng theo cột, kể cả khi "Thứ" và "2" bị tách từ', () => {
    const words = [
      word('Giờ', 10, 10), word('Thứ', 150, 10), word('2', 182, 10), word('Thứ', 350, 10), word('4', 382, 10),
      word('07h30-08h05', 10, 40), word('5A3', 160, 40), word('STEM', 160, 58), word('4A1', 360, 40), word('CDS', 360, 58),
      word('14h00-14h35', 10, 100), word('3/2', 360, 100), word('KNS', 360, 118),
    ]
    const rows = parseSchedule(words)
    expect(rows.map((r) => [r.day, r.start, r.className, r.subject])).toEqual([
      [0, '07:30', '5A3', 'STEM'],
      [2, '07:30', '4A1', 'CDS'],
      [2, '14:00', '3/2', 'KNS'],
    ])
  })

  it('ô căn giữa: tên lớp nằm cao hơn dòng giờ vẫn vào đúng hàng', () => {
    const words = [
      word('Giờ', 10, 10), word('Thứ', 150, 10), word('2', 182, 10), word('Thứ', 350, 10), word('3', 382, 10),
      word('5A3', 160, 50), word('07h30-08h05', 10, 62), word('STEM', 160, 74),
      word('2A1', 360, 120), word('14h00-14h35', 10, 132), word('KNS', 360, 144),
    ]
    expect(parseSchedule(words).map((r) => [r.day, r.start, r.className, r.subject])).toEqual([
      [0, '07:30', '5A3', 'STEM'],
      [1, '14:00', '2A1', 'KNS'],
    ])
  })

  it.each([1, 3, -2])('ảnh nghiêng %d độ: ca vẫn vào đúng cột và đúng hàng', (deg) => {
    const k = Math.tan((deg * Math.PI) / 180)
    const at = (text: string, x: number, y: number) => word(text, x - k * y, y + k * x)
    const words = [
      at('Giờ', 10, 40), at('Thứ', 200, 40), at('2', 232, 40), at('Thứ', 500, 40), at('3', 532, 40), at('Thứ', 800, 40), at('4', 832, 40), at('Thứ', 1100, 40), at('5', 1132, 40),
      at('07h30-08h05', 10, 100), at('5A3', 210, 90), at('STEM', 210, 110), at('4A1', 810, 90), at('CDS', 810, 110),
      at('14h00-14h35', 10, 180), at('2A1', 510, 170), at('KNS', 510, 190), at('1A4', 1110, 170), at('AI', 1110, 190),
    ]
    expect(parseSchedule(words).map((r) => [r.day, r.start, r.className, r.subject])).toEqual([
      [0, '07:30', '5A3', 'STEM'],
      [2, '07:30', '4A1', 'CDS'],
      [1, '14:00', '2A1', 'KNS'],
      [3, '14:00', '1A4', 'AI'],
    ])
  })

  it('xoá đường kẻ bảng nhưng giữ nét chữ', () => {
    const w = 60
    const h = 60
    const ink = new Uint8Array(w * h)
    for (let x = 0; x < w; x++) ink[10 * w + x] = 1 // đường ngang
    for (let y = 0; y < h; y++) ink[y * w + 30] = 1 // đường dọc
    for (let y = 20; y < 28; y++) ink[y * w + 5] = 1 // nét chữ ngắn
    const out = removeTableLines(ink, w, h, 40)
    expect(out[10 * w + 3]).toBe(0)
    expect(out[40 * w + 30]).toBe(0)
    expect(out[22 * w + 5]).toBe(1)
  })

  it('ngưỡng Otsu tách nền sáng và mực tối', () => {
    const t = otsuThreshold(new Uint8Array([...Array(90).fill(240), ...Array(10).fill(20)]))
    expect(t).toBeGreaterThanOrEqual(20)
    expect(t).toBeLessThan(240)
  })

  it('đọc dạng danh sách và giữ thứ cho dòng tiếp theo', () => {
    const rows = parseSchedule([
      word('Thứ', 10, 10), word('3', 42, 10), word('07h30-08h05', 60, 10), word('5A3', 180, 10), word('STEM', 220, 10),
      word('08h10-08h45', 60, 40), word('5A4', 180, 40), word('STEM', 220, 40),
    ])
    expect(rows.map((r) => [r.day, r.start, r.className])).toEqual([[1, '07:30', '5A3'], [1, '08:10', '5A4']])
  })

  it('không đoán khi chữ không đọc được', () => {
    expect(parseSchedule([word('xxxx', 10, 10)])).toEqual([])
  })
})

describe('Google Sheets', () => {
  it('CSV có dấu phẩy, ngoặc kép, xuống dòng trong ô', () => {
    expect(parseCsv('a,"b,c","d""e"\n"x\ny",2\n')).toEqual([['a', 'b,c', 'd"e'], ['x\ny', '2']])
  })
  it('nhận URL', () => {
    expect(sheetIdFromUrl('https://docs.google.com/spreadsheets/d/1AbC_d-EFghijklmnopqrstu/edit#gid=0')).toBe('1AbC_d-EFghijklmnopqrstu')
    expect(sheetIdFromUrl('không phải link')).toBeNull()
    expect(gvizCsvUrl('X', 'Thang 11 - Tuan 1')).toContain('sheet=Thang%2011%20-%20Tuan%201')
  })
  it('tìm thứ Hai từ ô ngày hoặc tiêu đề', () => {
    expect(detectMonday([['', '', '', '', '', '2026-11-02']], 2026)).toBe('2026-11-02')
    expect(detectMonday([['', '', '', '', '', '02/11/2026']], 2026)).toBe('2026-11-02')
    expect(detectMonday([['CẬP NHẬT TUẦN 02/11 - 08/11']], 2026)).toBe('2026-11-02')
    expect(detectMonday([['ư']], 2026)).toBeNull()
  })
  it('đọc khối 22 dòng của tab tuần, cả dòng dạy bù/thay', () => {
    const empty = () => Array.from({ length: 90 }, () => '')
    const grid = Array.from({ length: 30 }, empty)
    const labels = ['TRƯỜNG', 'CÔNG TY', 'LỚP', 'MÔN', 'BẮT ĐẦU', 'KẾT THÚC', 'GHI CHÚ', 'QĐ. TRƯỜNG']
    labels.forEach((l, k) => { grid[3 + k][4] = l; grid[11 + k][4] = l })
    grid[3][0] = 'VT001'; grid[3][1] = 'A'; grid[4][1] = '0332999864'; grid[4][3] = 'VP. Bà Rịa'
    const c = 5 + 12 + 6 // Thứ 3, chiều, tiết 1
    grid[3][c] = 'TH X - Y'; grid[5][c] = '3/5'; grid[6][c] = 'STEM'; grid[7][c] = '14h05'; grid[8][c] = '14h40'; grid[10][c] = 'S'
    grid[11][5] = 'TH Z'; grid[18][5] = 'CM'
    const { teachers, lessons } = parseWeekGrid(grid, '2026-11-02')
    expect(teachers[0]).toMatchObject({ id: 'VT001', phone: '0332999864' })
    expect(lessons).toHaveLength(2)
    expect(lessons[0]).toMatchObject({ schoolName: 'TH X - Y', date: '2026-11-03', session: 'PM', period: 1, className: '3/5', start: '14:05', code: 'S', track: 0 })
    expect(lessons[1]).toMatchObject({ schoolName: 'TH Z', date: '2026-11-02', session: 'AM', track: 1, type: 'support' })
  })
  it('đọc tab nguyện vọng và Refer', () => {
    const rows = parsePreferencesGrid([['MÃ GV', 'GIỚI TÍNH', 'KM TỐI ĐA', 'KẾT THÚC TRƯỚC', 'KHÔNG NHẬN BUỔI'], ['VT001', 'Nữ', '20', '16h00', 'sáng'], ['VT002', '', '', '', ''], ['', 'Nam']])
    expect(rows).toEqual([
      { teacherId: 'VT001', gender: 'F', maxKm: 20, finishBy: '16:00', noSession: 'AM' },
      { teacherId: 'VT002', gender: null, maxKm: null, finishBy: null, noSession: null },
    ])
    expect(parseReferGrid([['TRƯỜNG', 'MÃ GV'], ['TH A', 'VT001'], ['', 'VT002']])).toEqual([{ school: 'TH A', teacherId: 'VT001' }])
  })
})
