import { Dialog } from './ui/Dialog.tsx'
import { keyCaps, SHORTCUTS } from './ui/shortcuts.ts'

export function ShortcutsDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      className="shortcuts"
    >
      <dl className="shortcut-list">
        {Object.values(SHORTCUTS).map(({ keys, label }) => (
          <div key={keys} className="shortcut">
            <dt>{label}</dt>
            <dd>
              {keyCaps(keys).map((cap) => (
                <kbd key={cap}>{cap}</kbd>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </Dialog>
  )
}
