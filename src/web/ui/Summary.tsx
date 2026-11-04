import { type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

/**
 * A disclosure's label with a chevron that turns when open. `live` shimmers
 * the label while the model works.
 */
export function Summary({
  live,
  children,
}: {
  live?: boolean
  children: ReactNode
}) {
  return (
    <summary>
      <ChevronRight className="disclosure-chevron" size={16} aria-hidden />
      <span className={live ? 'live' : undefined}>{children}</span>
    </summary>
  )
}
