import clsx from 'clsx'
import { CheckCircle2, X } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { create } from 'zustand'

export function Button({ variant = 'secondary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...p}
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50',
        variant === 'primary' && 'bg-emerald-700 text-white hover:bg-emerald-800',
        variant === 'secondary' && 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        variant === 'danger' && 'border border-red-200 bg-white text-red-700 hover:bg-red-50',
        className,
      )}
    />
  )
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('rounded-lg border border-slate-200 bg-white', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      {children}
    </section>
  )
}

const TONES = {
  slate: 'bg-slate-100 text-slate-700',
  green: 'bg-emerald-50 text-emerald-800',
  amber: 'bg-amber-50 text-amber-800',
  red: 'bg-red-50 text-red-700',
  blue: 'bg-sky-50 text-sky-800',
  violet: 'bg-violet-50 text-violet-800',
}

export function Badge({ tone = 'slate', children, title, className }: { tone?: keyof typeof TONES; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium', TONES[tone], className)}>
      {children}
    </span>
  )
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'critical' | 'warning' }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={clsx('tnum mt-1 text-xl font-semibold tracking-tight', tone === 'critical' && 'text-red-700', tone === 'warning' && 'text-amber-700')}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 max-w-3xl text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-slate-500">{children}</div>
}

interface ToastState {
  message: string | null
  show: (m: string) => void
  hide: () => void
}

const useToast = create<ToastState>((set) => ({
  message: null,
  show: (message) => {
    set({ message })
    window.setTimeout(() => set((s) => (s.message === message ? { message: null } : s)), 5000)
  },
  hide: () => set({ message: null }),
}))

export const toast = (m: string) => useToast.getState().show(m)

export function Toaster() {
  const { message, hide } = useToast()
  if (!message) return null
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-white shadow-lg">
      <CheckCircle2 size={15} className="text-emerald-400" />
      {message}
      <button aria-label="Đóng" onClick={hide} className="ml-2 text-slate-400 hover:text-white">
        <X size={14} />
      </button>
    </div>
  )
}
