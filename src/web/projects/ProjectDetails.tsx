import { useCallback, useEffect, useState } from 'react'
import {
  addProjectFile,
  getProject,
  linkProjectFolder,
  reindexProjectFile,
  removeProjectFile,
  suggestProjectInstructions,
  syncProjectFolder,
  unlinkProjectFolder,
  updateProject,
} from './api.ts'
import {
  deleteConversation,
  regenerateTitle,
  updateConversation,
} from '../conversations/api.ts'
import { keepFolderFiles, syncNotice } from './folderFiles.ts'
import { useLoad } from '../ui/useLoad.ts'
import { ProjectChats } from './ProjectChats.tsx'
import { ProjectFiles } from './ProjectFiles.tsx'
import { ProjectInstructions } from './ProjectInstructions.tsx'

// How often the page of a project with a mirrored folder looks for changes.
const FOLDER_POLL_MS = 5000

/**
 * Below the composer on the project page: files, instructions and chats.
 * `onChatsChanged`: a chat left the project (so the sidebar should reload).
 */
export function ProjectDetails({
  projectId,
  onChatsChanged,
}: {
  projectId: string
  onChatsChanged: () => void
}) {
  const {
    data: contents,
    error,
    reload,
    act,
  } = useLoad(useCallback(() => getProject(projectId), [projectId]))
  // What an add did or is doing (not an error): progress, files skipped.
  const [notice, setNotice] = useState<string | null>(null)

  // Files are indexed in the background: check back until they're done.
  const indexing = contents?.files.some((f) => f.status === 'indexing')
  useEffect(() => {
    if (!indexing) return
    const timer = setTimeout(() => void reload(), 1500)
    return () => clearTimeout(timer)
  }, [indexing, contents, reload])

  // The folder a project mirrors may have changed since it was last opened.
  const folder = contents?.project.folder
  useEffect(() => {
    if (!folder) return
    syncProjectFolder(projectId).then(
      (result) => {
        // Only what changed: what is left out is told when asked (Sync now).
        const note = syncNotice(result, { details: false })
        if (note) {
          setNotice(note)
          void reload()
        }
      },
      (err: Error) => setNotice(err.message),
    )
  }, [projectId, folder, reload])

  // The server follows a mirrored folder as it changes; the page asks now and
  // then, only while it is on screen.
  useEffect(() => {
    if (!folder) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void reload()
    }, FOLDER_POLL_MS)
    return () => clearInterval(timer)
  }, [folder, reload])

  if (!contents) {
    return error ? (
      <p className="error project-details" role="alert">
        {error}
      </p>
    ) : null
  }

  return (
    <div className="project-details">
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ProjectInstructions
        key={contents.project.instructions}
        instructions={contents.project.instructions}
        canSuggest={contents.files.some((f) => f.status === 'ready')}
        onSuggest={() =>
          suggestProjectInstructions(projectId).then((r) => r.instructions)
        }
        onSave={(instructions) =>
          void act(() => updateProject(projectId, { instructions }))
        }
      />
      <ProjectFiles
        files={contents.files}
        folder={contents.project.folder}
        notice={notice}
        onAdd={(files) =>
          void act(async () => {
            const { kept, skipped } = keepFolderFiles(files)
            // One refused file (a duplicate) doesn't stop the rest.
            const refused: string[] = []
            for (const [i, file] of kept.entries()) {
              if (kept.length > 3) {
                setNotice(`Adding ${i + 1} of ${kept.length}…`)
              }
              await addProjectFile(projectId, file).catch((err: Error) =>
                refused.push(err.message),
              )
            }
            setNotice(
              skipped
                ? `Skipped ${skipped} of ${files.length} files: types projects can't read, hidden files and folders, or folders such as node_modules.`
                : null,
            )
            if (refused.length) {
              const shown = refused.slice(0, 3)
              if (refused.length > 3) {
                shown.push(`and ${refused.length - 3} more refused`)
              }
              throw new Error(shown.join('. '))
            }
          })
        }
        onLink={(path) =>
          void act(async () => {
            setNotice(syncNotice(await linkProjectFolder(projectId, path)))
          })
        }
        onSync={() =>
          void act(async () => {
            try {
              setNotice(
                syncNotice(await syncProjectFolder(projectId)) ??
                  'The folder has not changed.',
              )
            } catch (err) {
              // Beside the button that was pressed, not in the banner above.
              setNotice(`Couldn't sync: ${(err as Error).message}`)
            }
          })
        }
        onUnlink={() => void act(() => unlinkProjectFolder(projectId))}
        onRetry={(fileId) =>
          void act(() => reindexProjectFile(projectId, fileId))
        }
        onRemove={(fileId) =>
          void act(() => removeProjectFile(projectId, fileId))
        }
      />
      <ProjectChats
        chats={contents.conversations}
        onUpdate={(id, patch) =>
          void act(() => updateConversation(id, patch)).then(onChatsChanged)
        }
        onRetitle={(id) =>
          void act(() => regenerateTitle(id)).then(onChatsChanged)
        }
        onDelete={(id) => void act(() => deleteConversation(id))}
      />
    </div>
  )
}
