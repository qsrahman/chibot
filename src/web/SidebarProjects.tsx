import { Folder, FolderPlus } from 'lucide-react'
import { NavLink } from 'react-router'
import type { Project } from '../shared/types.ts'
import { SidebarButton } from './SidebarButton.tsx'

/** The sidebar's Projects section: New project, then each project. */
export function SidebarProjects({
  projects,
  error,
  onNew,
}: {
  projects: Project[]
  /** Its load error, unless the chats list says the same (one message while the server is down). */
  error: string | null
  onNew: () => void
}) {
  return (
    <section>
      {/* Labels, not headings: the sidebar comes before the page's own
                  heading, and its groups would be the first outline a screen
                  reader lists. */}
      <p className="sidebar-heading">Projects</p>
      <SidebarButton
        icon={<FolderPlus />}
        label="New project"
        onClick={onNew}
      />
      {/* One message when the server is down, under the chats. */}
      {error && <p className="sidebar-note">{error}</p>}
      {projects.map((project) => (
        <NavLink
          key={project.id}
          to={`/projects/${project.id}`}
          className="sidebar-row"
          title={
            project.description
              ? `${project.name}: ${project.description}`
              : project.name
          }
        >
          <span className="row-icon" aria-hidden>
            <Folder />
          </span>
          <span className="row-label" dir="auto">
            {project.name}
          </span>
        </NavLink>
      ))}
    </section>
  )
}
