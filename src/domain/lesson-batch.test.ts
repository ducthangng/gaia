import { describe, expect, it } from 'vitest'
import { draftsErrors, isBlankDraft, nextDraft, type LessonDraft } from './lesson-edit'

const d = (over: Partial<LessonDraft> = {}): LessonDraft => ({ date: '2026-11-09', start: '07:15', end: '07:50', className: '1.1', subject: 'STEM', teacherId: 'VT011', note: '', ...over })

describe('thêm nhiều ca', () => {
  it('dòng tiếp theo nối ngay sau ca trước, cùng thời lượng, giữ ngày, môn, GV và bỏ lớp', () => {
    expect(nextDraft(d())).toEqual({ date: '2026-11-09', start: '07:50', end: '08:25', className: '', subject: 'STEM', teacherId: 'VT011', note: '' })
  })
  it('ca trước chưa đủ giờ hoặc sẽ vượt qua nửa đêm thì để trống giờ', () => {
    expect(nextDraft(d({ end: '' }))).toMatchObject({ start: '', end: '' })
    expect(nextDraft(d({ start: '23:00', end: '23:40' }))).toMatchObject({ start: '', end: '' })
  })
  it('báo lỗi đúng dòng, bỏ qua dòng trống', () => {
    const errs = draftsErrors([d(), d({ start: '', end: '', className: '' }), d({ end: '07:00' }), d({ className: '' })])
    expect([...errs.keys()]).toEqual([2, 3])
    expect(isBlankDraft(d({ start: '', end: '', className: '' }))).toBe(true)
  })
})
