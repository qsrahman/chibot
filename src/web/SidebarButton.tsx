import type { ReactElement } from 'react'
import { Link } from 'react-router'

/** A full-width row in the expanded sidebar, an icon in the collapsed rail. */
export function SidebarButton({
  icon,
  label,
  to,
  className,
  onClick,
}: {
  icon: ReactElement
  label: string
  to?: string
  className?: string
  onClick?: () => void
}) {
  const classes = className ? `sidebar-row ${className}` : 'sidebar-row'
  const content = (
    <>
      <span className="row-icon" aria-hidden>
        {icon}
      </span>
      <span className="row-label">{label}</span>
    </>
  )
  return to ? (
    <Link to={to} className={classes} aria-label={label} title={label}>
      {content}
    </Link>
  ) : (
    <button
      type="button"
      className={classes}
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {content}
    </button>
  )
}
