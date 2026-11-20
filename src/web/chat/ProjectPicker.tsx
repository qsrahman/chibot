import { Check, ChevronDown, Folder } from 'lucide-react'
import type { Project } from '../../shared/types.ts'
import { useAnchoredPopover } from '../ui/popover.ts'

/**
 * On a new chat, under the message box: which project the chat starts in
 * (its instructions and files apply), or none. The choice is for the next
 * chat only; a project's own page starts chats in it too.
 */
export function ProjectPicker({
  projects,
  chosen,
  onChoose,
}: {
  projects: Project[]
  /** The project's id, or `null` for none. */
  chosen: string | null
  onChoose: (id: string | null) => void
}) {
  const menu = useAnchoredPopover()
  const current = projects.find((p) => p.id === chosen)
  return (
    <div className="project-picker">
      <button
        type="button"
        className="mode-button"
        aria-label={`Project: ${current?.name ?? 'none'}`}
        popoverTarget={menu.id}
        style={menu.triggerStyle}
      >
        <Folder size={16} strokeWidth={1.5} aria-hidden />
        <span dir="auto" className="project-picker-name">
          {current?.name ?? 'Project'}
        </span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden />
      </button>
      <div
        id={menu.id}
        ref={menu.ref}
        popover="auto"
        className="menu"
        role="menu"
        aria-label="Project"
        style={menu.style}
        {...menu.menuProps}
      >
        {[{ id: null, name: 'No project' }, ...projects].map((option) => (
          <button
            key={option.id ?? 'none'}
            type="button"
            role="menuitemradio"
            aria-checked={option.id === chosen}
            className="menu-item"
            onClick={() => {
              menu.hide()
              if (option.id !== chosen) onChoose(option.id)
            }}
          >
            <span className="menu-item-text" dir="auto">
              {option.name}
            </span>
            {option.id === chosen && <Check size={16} strokeWidth={1.5} />}
          </button>
        ))}
      </div>
    </div>
  )
}
