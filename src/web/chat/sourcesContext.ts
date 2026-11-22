import { createContext } from 'react'
import type { Source } from './sources.ts'

/** The sources of the answer being shown, so its links to them can say which is which. */
export const SourcesContext = createContext<Source[]>([])

/** An address without its fragment, to compare a link with a source. */
export const sourceKey = (url: string) =>
  URL.parse(url, location.origin)?.href.replace(/#.*$/, '') ?? url

/** Whether the answer being shown is still streaming (its code blocks don't collapse until it is done). */
export const LiveContext = createContext(false)
