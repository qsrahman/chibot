import { useState, type DragEvent, type RefObject } from 'react'

/**
 * Files dropped on the chat attach to the message. Spread `handlers` on the
 * element that takes the drop; `dragging` is true while files are over it.
 */
export function useFileDrop(
  add: (files: File[]) => void,
  focus: RefObject<HTMLElement | null>,
) {
  const [dragging, setDragging] = useState(false)
  const dropping = (e: DragEvent) => e.dataTransfer.types.includes('Files')
  return {
    dragging,
    handlers: {
      onDragOver: (e: DragEvent) => {
        if (!dropping(e) || e.defaultPrevented) return
        e.preventDefault()
        setDragging(true)
      },
      onDragLeave: (e: DragEvent) => {
        // Leaving for a child element isn't leaving the page.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragging(false)
        }
      },
      onDrop: (e: DragEvent) => {
        setDragging(false)
        // A project's file list handles its own drops.
        if (e.defaultPrevented) return
        e.preventDefault()
        add([...e.dataTransfer.files])
        focus.current?.focus()
      },
    },
  }
}
