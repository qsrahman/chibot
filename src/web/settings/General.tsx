import { useColorScheme, type ColorScheme } from '../theme.ts'
import { Row, Section } from './parts.tsx'

export function General() {
  const { scheme, systemScheme, choose } = useColorScheme()
  const options: { value: ColorScheme; label: string }[] = [
    { value: null, label: `System (currently ${systemScheme})` },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]
  return (
    <Section title="Appearance">
      <Row label="Theme" htmlFor="setting-theme">
        <select
          id="setting-theme"
          value={scheme ?? 'system'}
          onChange={(e) =>
            choose(
              e.target.value === 'system'
                ? null
                : (e.target.value as 'light' | 'dark'),
            )
          }
        >
          {options.map(({ value, label }) => (
            <option key={label} value={value ?? 'system'}>
              {label}
            </option>
          ))}
        </select>
      </Row>
    </Section>
  )
}
