import type {
  ResponseFunctionToolCall,
  ResponseInputItem,
} from 'openai/resources/responses/responses'

/**
 * Function calls on `path` without an output. chibot answers every call
 * before the next request, except calls waiting for the user's approval, so
 * these end the path and mean "waiting for approval".
 */
export function pendingCalls(
  path: ResponseInputItem[],
): ResponseFunctionToolCall[] {
  const answered = new Set(
    path.flatMap((item) =>
      item.type === 'function_call_output' ? [item.call_id] : [],
    ),
  )
  return path.filter(
    (item): item is ResponseFunctionToolCall =>
      item.type === 'function_call' && !answered.has(item.call_id),
  )
}
