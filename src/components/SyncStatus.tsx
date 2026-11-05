import { Cloud, CloudOff, LoaderCircle, LogOut, TriangleAlert } from 'lucide-react'
import { api } from '../sync/api'
import { flush, hasPending, useSync } from '../sync/engine'

/** Trạng thái lưu lên server và tài khoản đang dùng, đặt ở cuối thanh bên. */
export function SyncStatus() {
  const { phase, pending, message, user } = useSync()
  const view = {
    saved: { icon: <Cloud size={14} />, text: 'Đã lưu lên máy chủ', tone: 'text-slate-500' },
    saving: { icon: <LoaderCircle size={14} className="animate-spin" />, text: `Đang lưu ${pending} thay đổi…`, tone: 'text-slate-600' },
    offline: { icon: <CloudOff size={14} />, text: `Mất kết nối, ${pending} thay đổi chờ gửi`, tone: 'text-amber-700' },
    error: { icon: <TriangleAlert size={14} />, text: `Chưa lưu được ${pending} thay đổi`, tone: 'text-red-700' },
  }[phase]
  const logout = async () => {
    await flush()
    if (hasPending() && !confirm('Còn thay đổi chưa lưu lên máy chủ. Vẫn đăng xuất và bỏ các thay đổi này?')) return
    await api('/auth/logout', { body: {} }).catch(() => {})
    location.reload()
  }
  return (
    <div className="mx-3 mb-3 space-y-2 border-t border-slate-100 pt-3 text-xs" data-testid="sync-status">
      <div className={`flex items-start gap-2 px-3 ${view.tone}`} title={message ?? undefined}>
        <span className="mt-0.5 shrink-0">{view.icon}</span>
        <span>{view.text}{message && phase !== 'saved' && <span className="block text-[11px] opacity-80">{message}</span>}</span>
      </div>
      {user && (
        <div className="flex items-center gap-2 px-3 text-slate-600">
          <span className="min-w-0 flex-1 truncate" title={user.email}>{user.name}</span>
          <button onClick={logout} className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800" aria-label="Đăng xuất"><LogOut size={13} />Thoát</button>
        </div>
      )}
    </div>
  )
}
