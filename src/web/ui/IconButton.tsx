import type { ReactNode } from 'react'

/**
 * A round, outlined icon button whose name is also its tooltip: for the
 * actions on a row (Settings), where a word would crowd the control.
 */
export function IconButton({
  label,
  variant,
  disabled,
  type = 'button',
  onClick,
  children,
}: {
  /** The accessible name and the tooltip: say what it does. */
  label: string
  variant?: 'primary' | 'danger'
  disabled?: boolean
  type?: 'button' | 'submit'
  onClick?: () => void
  /** The icon, 18 px with a 1.5 stroke. */
  children: ReactNode
}) {
  return (
    <button
      type={type}
      className={`icon-button outlined${variant ? ` ${variant}` : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
