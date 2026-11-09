import { listSkills } from './api.ts'
import { useLoad } from '../ui/useLoad.ts'
import { Row, Section } from './parts.tsx'

/**
 * The skills the model can read: folders with a SKILL.md in chibot's skills
 * folder. They are added there by hand, so this only lists them, and says why
 * a folder was left out.
 */
export function Skills() {
  const { data, error } = useLoad(listSkills)
  if (!data) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : null
  }
  const { dir, skills, problems } = data
  return (
    <Section title="Skills">
      <Row
        label="Skills folder"
        description={`Add a folder with a SKILL.md to ${dir} (a link to a folder works too). The model reads a skill when a request matches its description. It cannot run a skill's scripts.`}
      >
        <></>
      </Row>
      {skills.map(({ name, description }) => (
        <Row key={name} label={name} description={description}>
          <></>
        </Row>
      ))}
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
