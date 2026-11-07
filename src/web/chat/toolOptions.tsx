import type { ReactNode } from 'react'
import { ImagePlus } from 'lucide-react'
import type { Settings } from '../../shared/settings.ts'
import type { ToolIcon, ToolInfo } from '../../shared/tools.ts'
import type { ToolOption } from './AddMenu.tsx'

/** The composer's icons for a tool, by the name the server gives. */
const TOOL_ICONS: Record<ToolIcon, ReactNode> = {
  image: <ImagePlus size={18} strokeWidth={1.5} aria-hidden />,
}

/**
 * The tools the "+" menu offers for the next message. Shown even when
 * unavailable, saying why, so they can be found.
 */
export function toolOptions(
  tools: ToolInfo[],
  settings: Settings | null | undefined,
): ToolOption[] {
  return tools.flatMap((tool) =>
    tool.chip
      ? [
          {
            name: tool.name,
            label: tool.chip.action,
            chip: tool.chip.text,
            summary: tool.summary,
            icon: TOOL_ICONS[tool.chip.icon],
            unavailable:
              tool.unavailable ??
              (settings?.disabledTools.includes(tool.name)
                ? 'Off in Settings → Tools'
                : null),
          },
        ]
      : [],
  )
}
