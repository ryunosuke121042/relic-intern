import { useEffect, useState } from 'react'

export interface ToastItem {
  id: number
  message: string
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<(items: ToastItem[]) => void>()

function emit() {
  listeners.forEach((l) => l(items))
}

export function toast(message: string) {
  const item = { id: nextId++, message }
  items = [...items, item].slice(-3)
  emit()
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

export function useToasts(): ToastItem[] {
  const [state, setState] = useState(items)
  useEffect(() => {
    listeners.add(setState)
    return () => {
      listeners.delete(setState)
    }
  }, [])
  return state
}
