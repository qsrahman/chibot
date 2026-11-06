import { useRef, useState, type ReactNode } from 'react'
import { Camera, Paperclip, Plus } from 'lucide-react'
import { ATTACHMENT_ACCEPT } from '../../shared/documents.ts'
import { useAnchoredPopover } from '../ui/popover.ts'
import { CameraDialog } from './CameraDialog.tsx'

/** A tool the user can pick for the next message ("+" menu). */
export interface ToolOption {
  name: string
  /** In the menu, e.g. "Create an image". */
  label: string
  /** On the chip once picked, e.g. "Search". */
  chip: string
  /** Under the label: what it does and what leaves the machine. */
  summary: string
  icon: ReactNode
  /** Why it can't be used (not set up, or switched off), or `null`. */
  unavailable: string | null
}

/** The "+" button and its menu: add files, or pick a tool for the message. */
export function AddMenu({
  tools,
  onFiles,
  onPick,
}: {
  tools: ToolOption[]
  onFiles: (files: File[]) => void
  onPick: (tool: ToolOption) => void
}) {
  const menu = useAnchoredPopover()
  const pickerRef = useRef<HTMLInputElement>(null)
  const [camera, setCamera] = useState(false)
  // Browsers expose the camera only on localhost and HTTPS.
  const canUseCamera = !!navigator.mediaDevices?.getUserMedia
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Add files and more"
        title="Add files and more"
        popoverTarget={menu.id}
        style={menu.triggerStyle}
      >
        <Plus size={24} strokeWidth={1.5} />
      </button>
      <input
        ref={pickerRef}
        type="file"
        multiple
        hidden
        accept={ATTACHMENT_ACCEPT}
        aria-label="Add photos & files"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          onFiles(files)
        }}
      />
      <div
        id={menu.id}
        ref={menu.ref}
        popover="auto"
        className="menu above"
        role="menu"
        style={menu.style}
        {...menu.menuProps}
      >
        <button
          type="button"
          role="menuitem"
          className="menu-item has-hint"
          onClick={() => {
            menu.hide()
            pickerRef.current?.click()
          }}
        >
          <Paperclip size={18} strokeWidth={1.5} aria-hidden />
          <span className="menu-item-text">
            Add photos & files
            <span className="menu-hint">Images, PDF, Word, text and code</span>
          </span>
        </button>
        {canUseCamera && (
          <button
            type="button"
            role="menuitem"
            className="menu-item has-hint"
            onClick={() => {
              menu.hide()
              setCamera(true)
            }}
          >
            <Camera size={18} strokeWidth={1.5} aria-hidden />
            <span className="menu-item-text">
              Take a photo
              <span className="menu-hint">
                With this device’s camera; it is attached to your message
              </span>
            </span>
          </button>
        )}
        {tools.map((option) => (
          <button
            key={option.name}
            type="button"
            role="menuitem"
            className="menu-item has-hint"
            disabled={option.unavailable !== null}
            onClick={() => {
              onPick(option)
              menu.hide()
            }}
          >
            {option.icon}
            <span className="menu-item-text">
              {option.label}
              <span className="menu-hint">
                {option.unavailable ?? option.summary}
              </span>
            </span>
          </button>
        ))}
      </div>
      <CameraDialog
        open={camera}
        onClose={() => setCamera(false)}
        onCapture={(photo) => onFiles([photo])}
      />
    </>
  )
}
