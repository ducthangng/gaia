import clsx from 'clsx'
import { Rows3, Table2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Chuyển giữa xem chi tiết và xem dạng bảng. */
export function ViewSwitch() {
  const [params, setParams] = useSearchParams()
  const table = params.get('view') === 'table'
  const item = (active: boolean, onClick: () => void, icon: ReactNode, label: string) => (
    <button aria-pressed={active} onClick={onClick} className={clsx('inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium', active ? 'bg-white text-emerald-800 shadow-sm' : 'text-slate-600 hover:text-slate-900')}>{icon}{label}</button>
  )
  return (
    <div className="inline-flex w-fit shrink-0 gap-0.5 rounded-md bg-slate-200 p-0.5" role="group" aria-label="Kiểu xem">
      {item(!table, () => setParams({}), <Rows3 size={13} />, 'Chi tiết')}
      {item(table, () => setParams({ view: 'table' }), <Table2 size={13} />, 'Bảng thông tin')}
    </div>
  )
}

// field-sizing: ô cao theo nội dung để chữ dài xuống dòng thay vì bị cắt.
const cellInput = 'block w-full resize-none [field-sizing:content] !border-transparent !bg-transparent !px-1.5 !py-1 leading-snug hover:!border-slate-300 focus:!border-emerald-600 focus:!bg-white'

/**
 * Ô sửa trực tiếp: lưu khi rời ô hoặc nhấn Enter, Esc để bỏ.
 * Ô còn trống được tô vàng để nhìn bảng là biết thiếu gì.
 */
export function TextCell({ value, label, onSave, placeholder, required, validate, align, inputMode, className }: {
  value: string
  label: string
  onSave: (v: string) => void
  placeholder?: string
  required?: boolean
  validate?: (v: string) => string | null
  align?: 'right'
  inputMode?: 'numeric' | 'decimal' | 'tel'
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shown = editing ? draft : value
  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next === value.trim()) { setError(null); return }
    const problem = validate?.(next) ?? null
    setError(problem)
    if (problem) { setEditing(true); return }
    onSave(next)
  }
  return (
    <div className={clsx('rounded', error ? 'bg-red-50 ring-1 ring-red-400' : required && !shown.trim() && 'bg-amber-100', className)} title={error ?? (shown || undefined)}>
      <textarea
        rows={1}
        aria-label={label}
        aria-invalid={!!error}
        inputMode={inputMode}
        className={clsx(cellInput, align === 'right' && 'tnum text-right')}
        placeholder={placeholder}
        value={shown}
        onFocus={() => { setDraft(value); setEditing(true); setError(null) }}
        onChange={(e) => { setDraft(e.target.value); setError(null) }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
          if (e.key === 'Escape') { setDraft(value); setError(null); setEditing(false); requestAnimationFrame(() => (e.target as HTMLTextAreaElement).blur()) }
        }}
      />
      {error && <div className="px-1.5 pb-0.5 text-[11px] text-red-700">{error}</div>}
    </div>
  )
}
