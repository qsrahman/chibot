import { ChevronRight, Copy, RefreshCw } from 'lucide-react'
import { MAX_LISTED_SKILLS, skillSwitch } from '../../shared/skills.ts'
import { IconButton } from '../ui/IconButton.tsx'
import { useToast } from '../ui/toast.tsx'
import { useLoad } from '../ui/useLoad.ts'
import { listSkills } from './api.ts'
import { withMember } from './mcp.ts'
import { Row, Section } from './parts.tsx'
import type { SettingsApi } from './useSettings.ts'

/**
 * The skills the model can read: folders with a SKILL.md in chibot's skills
 * folder. They are added there by hand, so this lists them (each with a
 * switch, and its whole description when opened), and says why a folder was
 * left out.
 */
export function Skills({
  disabled,
  onChange,
}: {
  disabled: string[]
  onChange: SettingsApi['update']
}) {
  const { data, error, reload } = useLoad(listSkills)
  const { toast } = useToast()
  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null
  }
  const { dir, skills, problems, skipped } = data
  const on = skills.filter(({ name }) => !disabled.includes(skillSwitch(name)))
  return (
    <Section title={skills.length > 0 ? `Skills · ${skills.length}` : 'Skills'}>
      <Row
        label="Skills folder"
        description={`Add a folder with a SKILL.md to ${dir}, then refresh. Skills are instructions: the model can't run their scripts.`}
      >
        <IconButton
          label="Copy the folder's path"
          onClick={() =>
            navigator.clipboard.writeText(dir).then(
              () => toast('Copied the skills folder’s path'),
              () => toast('Could not copy', { kind: 'error' }),
            )
          }
        >
          <Copy size={18} strokeWidth={1.5} />
        </IconButton>
        <IconButton label="Refresh the skills" onClick={() => void reload()}>
          <RefreshCw size={18} strokeWidth={1.5} />
        </IconButton>
      </Row>
      {skills.map(({ name, description }) => {
        const off = disabled.includes(skillSwitch(name))
        return (
          <div
            key={name}
            className={
              off
                ? 'settings-row skill-row unavailable'
                : 'settings-row skill-row'
            }
          >
            <details>
              <summary>
                <ChevronRight
                  className="disclosure-chevron"
                  size={16}
                  aria-hidden
                />
                <span className="skill-name">{name}</span>
                <span className="skill-peek">{description}</span>
              </summary>
              <p>{description}</p>
            </details>
            <input
              type="checkbox"
              role="switch"
              className="switch"
              aria-label={`Use the skill ${name}`}
              checked={!off}
              onChange={(e) =>
                void onChange({
                  disabledTools: withMember(
                    disabled,
                    skillSwitch(name),
                    !e.target.checked,
                  ),
                })
              }
            />
          </div>
        )
      })}
      {on.length > MAX_LISTED_SKILLS && (
        <Row
          label="Too many skills"
          description={`The model is told about the first ${MAX_LISTED_SKILLS} that are on; switch some off to reach the others.`}
          unavailable
        >
          <></>
        </Row>
      )}
      {skipped > 0 && (
        <Row
          label="Folders not read"
          description={`${skipped} ${skipped === 1 ? 'folder' : 'folders'} past the first 100 in the skills folder ${skipped === 1 ? 'is' : 'are'} not read at all.`}
          unavailable
        >
          <></>
        </Row>
      )}
      {problems.map(({ folder, reason }) => (
        <Row
          key={folder}
          label={folder}
          description={`Left out: ${reason}`}
          unavailable
        >
          <></>
        </Row>
      ))}
    </Section>
  )
}
