import { statSync } from 'node:fs'
import { Hono } from 'hono'
import { projectFolderSchema } from '../../shared/requests.ts'
import { absolutePath, listFolder } from './folder-list.ts'
import type { FolderWatcher } from './folder-watcher.ts'
import type { ProjectSync } from './project-sync.ts'
import type { ProjectStore } from './project-store.ts'
import { json, notFound } from '../routes/helpers.ts'
import { errorMessage } from '../../shared/errors.ts'

/** Mirroring a folder of this machine in a project: choosing one, linking, syncing, unlinking. */
export function folderRoutes({
  projects,
  sync,
  watcher,
}: {
  projects: ProjectStore
  sync: ProjectSync
  watcher: FolderWatcher
}) {
  const app = new Hono()

  // The folders of this machine, for choosing the one to mirror (the browser's
  // own picker can't say where a folder is). Reading a path is no further
  // reach than mirroring one, or than an MCP server that runs commands.
  app.get('/api/folders', (c) => {
    const requested = c.req.query('path')?.trim() || '~'
    const path = absolutePath(requested)
    if (!path) return c.json({ error: 'Give the full path of the folder' }, 400)
    try {
      return c.json(listFolder(path))
    } catch (err) {
      return c.json({ error: `Can't read ${path}: ${errorMessage(err)}` }, 400)
    }
  })

  // Links the project to a folder on this machine and brings its files in.
  // Anyone who can reach chibot can already run commands through an MCP
  // server, so reading a path is no further reach.
  app.put('/api/projects/:id/folder', json(projectFolderSchema), (c) => {
    const id = c.req.param('id')
    if (!projects.get(id)) return notFound(c, 'Project')
    const folder = absolutePath(c.req.valid('json').path)
    if (!folder) {
      return c.json({ error: 'Give the full path of the folder' }, 400)
    }
    if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) {
      return c.json({ error: `${folder} is not a folder` }, 400)
    }
    const before = projects.get(id)!.folder
    projects.setFolder(id, folder)
    try {
      const result = sync.sync(id)
      watcher.update(id)
      return c.json(result)
    } catch (err) {
      projects.setFolder(id, before)
      return c.json(
        { error: `Can't read ${folder}: ${errorMessage(err)}` },
        400,
      )
    }
  })

  // Stops mirroring; the files stay in the project as they are.
  app.delete('/api/projects/:id/folder', (c) => {
    const id = c.req.param('id')
    if (!projects.setFolder(id, null)) return notFound(c, 'Project')
    watcher.update(id)
    return c.body(null, 204)
  })

  // Brings the project's files up to date with its folder.
  app.post('/api/projects/:id/sync', (c) => {
    const project = projects.get(c.req.param('id'))
    if (!project) return notFound(c, 'Project')
    if (!project.folder) return c.json({ error: 'No folder is linked' }, 409)
    try {
      const result = sync.sync(project.id)
      // Starts watching again if it had stopped (a drive that came back).
      watcher.update(project.id)
      return c.json(result)
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 409)
    }
  })

  return app
}
