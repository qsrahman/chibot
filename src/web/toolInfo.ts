import { createContext } from 'react'
import type { ToolInfo } from '../shared/tools.ts'

/** The server's tools (`GET /api/tools`), for the words around a tool call. */
export const ToolInfoContext = createContext<ToolInfo[]>([])
