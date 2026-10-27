import type { ReactNode } from 'react'

export function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      <div className="settings-card">{children}</div>
    </section>
  )
}

export function Row({
  label,
  description,
  htmlFor,
  unavailable = false,
  children,
}: {
  label: string
  description?: string
  htmlFor?: string
  /** Greyed out: it can't be used (e.g. not set up). */
  unavailable?: boolean
  children: ReactNode
}) {
  return (
    <div className={unavailable ? 'settings-row unavailable' : 'settings-row'}>
      <div className="settings-label">
        <label htmlFor={htmlFor}>{label}</label>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  )
}
