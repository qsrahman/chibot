import { ACCENTS, useAccent } from '../ui/appearance.ts'
import { useNotifyPreference } from '../ui/notifications.ts'
import { useColorScheme, type ColorScheme } from '../ui/theme.ts'
import { Row, Section } from './parts.tsx'

export function General() {
  const { scheme, systemScheme, choose } = useColorScheme()
  const [accent, chooseAccent] = useAccent()
  const notifications = useNotifyPreference()
  const options: { value: ColorScheme; label: string }[] = [
    { value: null, label: `System (currently ${systemScheme})` },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'macchiato', label: 'Catppuccin Macchiato' },
    { value: 'latte', label: 'Catppuccin Latte' },
  ]
  return (
    <>
      <Section title="Appearance">
        <Row label="Theme" htmlFor="setting-theme">
          <select
            id="setting-theme"
            value={scheme ?? 'system'}
            onChange={(e) =>
              choose(
                e.target.value === 'system'
                  ? null
                  : (e.target.value as NonNullable<ColorScheme>),
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
        <Row label="Accent colour" htmlFor="setting-accent">
          <select
            id="setting-accent"
            value={accent ?? 'default'}
            onChange={(e) =>
              chooseAccent(
                e.target.value === 'default'
                  ? null
                  : (e.target.value as NonNullable<typeof accent>),
              )
            }
          >
            <option value="default">Blue (default)</option>
            {ACCENTS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Row>
      </Section>
      {notifications.supported && (
        <Section title="Notifications">
          <Row
            label="Notify me about finished answers"
            description={
              notifications.blocked
                ? 'Your browser blocks notifications from chibot: allow them in its site settings, then try again.'
                : 'While chibot is in the background, a notification says an answer is done or a tool needs your approval. The page title always shows it.'
            }
            htmlFor="setting-notify"
          >
            <input
              id="setting-notify"
              type="checkbox"
              role="switch"
              className="switch"
              checked={notifications.on}
              onChange={(e) => void notifications.choose(e.target.checked)}
            />
          </Row>
        </Section>
      )}
    </>
  )
}
