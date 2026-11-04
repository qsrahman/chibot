import { useRef, type ReactNode } from 'react'
import { DOCUMENT_ACCEPT } from '../../shared/documents.ts'
import { pickedFiles } from './folders.ts'

/**
 * A button that opens the browser's file (or folder) picker. The input itself
 * is `hidden`, which no keyboard can reach, so the button is what you tab to
 * and press; it hands the input the click.
 */
export function FilePickerButton({
  icon,
  label,
  folder = false,
  onPick,
}: {
  icon: ReactNode
  label: string
  /** Pick a whole folder (its files, with their paths) instead of files. */
  folder?: boolean
  onPick: (files: File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button
        type="button"
        className="button"
        onClick={() => input.current?.click()}
      >
        {icon}
        {label}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        aria-label={label}
        {...(folder
          ? // Not in React's types; Chrome, Edge, Firefox and Safari read it.
            { webkitdirectory: '' }
          : { multiple: true, accept: DOCUMENT_ACCEPT })}
        onChange={(e) => {
          const picked = pickedFiles(e.target.files)
          e.target.value = ''
          if (picked.length) onPick(picked)
        }}
      />
    </>
  )
}
