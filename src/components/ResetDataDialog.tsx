import { RotateCcw, X } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { seed } from '../data/load'
import { dataDiff } from '../domain/data-diff'
import { DEFAULT_SETTINGS } from '../domain/types'
import { useStore } from '../store'
import { Button, toast } from './ui'

const useOpen = create<{ open: boolean; set: (open: boolean) => void }>((set) => ({ open: false, set: (open) => set({ open }) }))
export const openResetDialog = () => useOpen.getState().set(true)

export function ResetDataDialog() {
  const { open, set } = useOpen()
  return open ? <Dialog close={() => set(false)} /> : null
}

function Dialog({ close }: { close: () => void }) {
  const state = useStore()
  const changes = useMemo(() => dataDiff(state, seed, DEFAULT_SETTINGS), [state])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])
  const dirty = changes.length > 0
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-modal="true" aria-label="Về dữ liệu mới nhất" data-testid="reset-dialog" className="flex max-h-[85vh] w-[520px] max-w-full flex-col rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold"><RotateCcw size={15} />Về dữ liệu mới nhất</h2>
          <button aria-label="Đóng" className="text-slate-400 hover:text-slate-700" onClick={close}><X size={16} /></button>
        </header>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
          {dirty ? <>
            <p>Lịch và thông tin sẽ trở về dữ liệu gốc của bản đang chạy. <b>Các thay đổi sau trên trình duyệt này sẽ mất:</b></p>
            <ul className="list-disc space-y-0.5 pl-5 text-slate-700" data-testid="reset-changes">{changes.map((c) => <li key={c}>{c}</li>)}</ul>
            <p className="text-xs text-slate-500">Bạn có thể hoàn tác ngay sau khi bấm. Sau khi tải lại trang thì không hoàn tác được nữa.</p>
          </> : <p data-testid="reset-clean">Dữ liệu đang giống bản mới nhất, không có gì cần đưa về.</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <Button onClick={close}>{dirty ? 'Huỷ' : 'Đóng'}</Button>
          {dirty && <Button variant="danger" onClick={() => {
            useStore.getState().resetAll()
            toast('Đã đưa dữ liệu về bản mới nhất', { label: 'Hoàn tác', run: () => useStore.getState().undoReset() })
            close()
          }}>Xoá thay đổi, về bản mới nhất</Button>}
        </footer>
      </div>
    </div>
  )
}
