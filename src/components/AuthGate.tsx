import { CalendarHeart, LoaderCircle, LogIn } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { api, ApiError, type ApiUser } from '../sync/api'
import { hydrate, schedule, useSync } from '../sync/engine'
import { Button } from './ui'

type Gate = { kind: 'checking' } | { kind: 'login' } | { kind: 'loading' } | { kind: 'empty' } | { kind: 'ready' } | { kind: 'error'; message: string }

/** Kiểm tra đăng nhập và nạp dữ liệu từ server trước khi hiện app. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [gate, setGate] = useState<Gate>({ kind: 'checking' })
  const user = useSync((s) => s.user)

  const load = async (u: ApiUser) => {
    setGate({ kind: 'loading' })
    try {
      setGate((await hydrate(u)) ? { kind: 'ready' } : { kind: 'empty' })
    } catch (e) {
      setGate(e instanceof ApiError && e.status === 401 ? { kind: 'login' } : { kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  useEffect(() => {
    api<{ user: ApiUser }>('/auth/me')
      .then((r) => load(r.user))
      .catch((e) => setGate(e instanceof ApiError && e.status === 401 ? { kind: 'login' } : { kind: 'error', message: e.message }))
  }, [])

  // Đang dùng mà phiên hết hạn: đăng nhập lại rồi tiếp tục gửi phần chưa lưu, không nạp lại để khỏi mất thay đổi.
  if (gate.kind === 'ready' && !user) return <Login onDone={(u) => { useSync.setState({ user: u }); schedule(0) }} relogin />
  if (gate.kind === 'ready') return <>{children}</>
  if (gate.kind === 'login') return <Login onDone={load} />
  return (
    <Center>
      {gate.kind === 'error' ? (
        <div className="space-y-3 text-center">
          <p className="font-medium text-red-700">{gate.message}</p>
          <Button onClick={() => location.reload()}>Thử lại</Button>
        </div>
      ) : gate.kind === 'empty' ? (
        <p className="max-w-sm text-center text-slate-600">Database chưa có dữ liệu. Người quản trị cần chạy <code>npm run seed</code> trong thư mục <code>server</code>.</p>
      ) : (
        <p className="flex items-center gap-2 text-slate-500"><LoaderCircle size={16} className="animate-spin" />Đang tải dữ liệu…</p>
      )}
    </Center>
  )
}

function Login({ onDone, relogin = false }: { onDone: (u: ApiUser) => void; relogin?: boolean }) {
  const [email, setEmail] = useState(useSync.getState().user?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      onDone((await api<{ user: ApiUser }>('/auth/login', { body: { email, password } })).user)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Center>
      <form onSubmit={submit} className="relative w-[360px] max-w-full space-y-4 rounded-2xl border border-white/70 bg-white/85 p-7 shadow-xl shadow-emerald-900/10 backdrop-blur" data-testid="login-form">
        <div className="flex items-center gap-3">
          <Logo />
          <div>
            <div className="text-lg font-bold tracking-tight text-emerald-900">Gaia</div>
            <div className="text-xs text-slate-500">Điều phối lịch dạy · Vũng Tàu</div>
          </div>
        </div>
        <p className="rounded-xl bg-gradient-to-r from-amber-50 via-teal-50 to-violet-50 px-3 py-2 text-[13px] text-slate-700">
          {relogin ? 'Phiên đăng nhập đã hết hạn. Đăng nhập lại nhé, thay đổi chưa lưu vẫn còn nguyên.' : `${greeting()}! Đăng nhập để xếp lịch tuần này nhé.`}
        </p>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600">Email</span>
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full !rounded-lg !py-2" autoFocus placeholder="ten@gaia.vn" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-slate-600">Mật khẩu</span>
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full !rounded-lg !py-2" />
        </label>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
        <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2.5 font-semibold text-white shadow-md shadow-emerald-700/20 transition hover:from-emerald-700 hover:to-teal-700 hover:shadow-lg disabled:opacity-60">
          {busy ? <LoaderCircle size={15} className="animate-spin" /> : <LogIn size={15} />}Đăng nhập
        </button>
        <p className="text-center text-[11px] text-slate-400">Chưa có tài khoản? Nhờ quản trị viên tạo giúp.</p>
      </form>
    </Center>
  )
}

const greeting = () => {
  const h = new Date().getHours()
  return h < 11 ? 'Chào buổi sáng' : h < 14 ? 'Chào buổi trưa' : h < 18 ? 'Chào buổi chiều' : 'Chào buổi tối'
}

/** Logo: một ô lịch nhỏ trong vòng tròn gradient, cùng tông với màu các môn học. */
const Logo = () => (
  <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500 via-teal-500 to-sky-500 shadow-md shadow-teal-700/20">
    <CalendarHeart size={22} className="text-white" />
  </div>
)

/** Thẻ ca học trang trí, màu theo môn như trong lịch. Chỉ để trang trí, trình đọc màn hình bỏ qua. */
const CHIPS = [
  { cls: 'left-[8%] top-[14%] rotate-[-8deg] bg-amber-50 border-amber-200', time: '07:15', name: 'STEM · 3.4', delay: '0s' },
  { cls: 'right-[9%] top-[18%] rotate-[6deg] bg-teal-50 border-teal-200', time: '08:00', name: 'Công dân số · 5.2', delay: '1.2s' },
  { cls: 'left-[12%] bottom-[16%] rotate-[5deg] bg-violet-50 border-violet-200', time: '14:05', name: 'Kỹ năng sống · 1.6', delay: '2.1s' },
  { cls: 'right-[13%] bottom-[12%] rotate-[-5deg] bg-sky-50 border-sky-200', time: '15:45', name: 'AI · 4.1', delay: '0.6s' },
]

const Center = ({ children }: { children: ReactNode }) => (
  <div className="relative flex h-full items-center justify-center overflow-hidden bg-gradient-to-br from-emerald-100 via-sky-100 to-violet-200 p-6">
    <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-96 rounded-full bg-amber-300/50 blur-3xl" />
    <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-20 size-[28rem] rounded-full bg-teal-300/50 blur-3xl" />
    <div aria-hidden className="pointer-events-none absolute right-1/3 top-10 size-56 rounded-full bg-fuchsia-200/50 blur-3xl" />
    {CHIPS.map((c) => (
      <div key={c.name} aria-hidden className={`gaia-float pointer-events-none absolute hidden w-40 rounded-lg border px-3 py-2 text-[11px] shadow-sm md:block ${c.cls}`} style={{ animationDelay: c.delay }}>
        <div className="text-slate-500">{c.time}</div>
        <div className="font-semibold text-slate-700">{c.name}</div>
      </div>
    ))}
    <div className="relative">{children}</div>
  </div>
)
