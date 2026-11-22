import type { ReactElement, ReactNode } from 'react'

/** A row in a "…" menu: an icon and a label, or a download link. */
export function MenuItem({
  icon,
  danger,
  onClick,
  download,
  children,
}: {
  icon: ReactElement
  danger?: boolean
  onClick: () => void
  download?: string
  children: ReactNode
}) {
  const content = (
    <>
      <span className="row-icon" aria-hidden>
        {icon}
      </span>
      {children}
    </>
  )
  const className = danger ? 'menu-item danger' : 'menu-item'
  // The server names the file (Content-Disposition), so `download` is bare.
  return download ? (
    <a
      className={className}
      role="menuitem"
      href={download}
      download
      onClick={onClick}
    >
      {content}
    </a>
  ) : (
    <button
      type="button"
      className={className}
      role="menuitem"
      onClick={onClick}
    >
      {content}
    </button>
  )
}
