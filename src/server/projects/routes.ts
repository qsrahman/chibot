import { statSync } from 'node:fs'
import { Hono } from 'hono'
import OpenAI from 'openai'
import { documentKind } from '../../shared/documents.ts'
import {
  addProjectFileSchema,
  createProjectSchema,
  projectFolderSchema,
  projectPatchSchema,
} from '../../shared/requests.ts'
import type { ProjectWithContents } from '../../shared/types.ts'
import type { Attachments } from '../attachments.ts'
import type { ConversationStore } from '../conversations/index.ts'
import type { FileStore } from '../file-store.ts'
import type { InstructionWriter } from './instruction-writer.ts'
import type { ProjectIndex } from './project-index.ts'
import { absolutePath, listFolder } from './folder-list.ts'
import type { FolderWatcher } from './folder-watcher.ts'
import type { ProjectSync } from './project-sync.ts'
import type { ProjectStore } from './project-store.ts'
import { explainApiError } from '../api-errors.ts'
import { NothingToSuggestFrom } from './instruction-writer.ts'
import { json, notFound } from '../routes/helpers.ts'

export function projectRoutes({
  store,
  files,
  projects,
  index,
  sync,
  watcher,
  instructionWriter,
  attachments,
}: {
  store: ConversationStore
  files: FileStore
  projects: ProjectStore
  index: ProjectIndex
  sync: ProjectSync
  watcher: FolderWatcher
  instructionWriter: InstructionWriter
  attachments: Attachments
}) {
  const app = new Hono()

  app.get('/api/projects', (c) => c.json(projects.list()))

  app.post('/api/projects', json(createProjectSchema), (c) =>
    c.json(projects.create(c.req.valid('json').name), 201),
  )

  app.get('/api/projects/:id', (c) => {
    const project = projects.get(c.req.param('id'))
    if (!project) return notFound(c, 'Project')
    const contents: ProjectWithContents = {
      project,
      files: projects.files(project.id),
      conversations: store.listConversations({ projectId: project.id }),
    }
    return c.json(contents)
  })

  // Adds an uploaded file to a project and indexes it in the background.
  app.post('/api/projects/:id/files', json(addProjectFileSchema), (c) => {
    const project = projects.get(c.req.param('id'))
    const file = files.get(c.req.valid('json').fileId)
    if (!project) return notFound(c, 'Project')
    if (!file) return notFound(c, 'File')
    // Projects search text; images have none.
    if (!documentKind(file.name)) {
      return c.json({ error: `${file.name}: projects take documents` }, 415)
    }
    if (file.conversationId !== null || projects.hasFile(file.id)) {
      return c.json({ error: 'The file is already in use' }, 409)
    }
    // The same bytes twice would only make every search hit twice.
    const same = projects
      .files(project.id)
      .find(
        (f) =>
          f.size === file.size &&
          files.read(f.fileId).equals(files.read(file.id)),
      )
    if (same) {
      files.delete(file.id)
      return c.json(
        { error: `${file.name} is already in this project as ${same.name}` },
        409,
      )
    }
    // The model and the file list name files, so names must differ.
    const name = projects.uniqueName(project.id, file.name)
    if (name !== file.name) files.rename(file.id, name)
    projects.addFile(project.id, file.id)
    void index.index(file.id)
    return c.json(projects.files(project.id), 201)
  })

  app.delete('/api/projects/:id/files/:fileId', (c) => {
    const removed = projects.removeFile(
      c.req.param('id'),
      c.req.param('fileId'),
    )
    return removed ? c.body(null, 204) : notFound(c, 'File')
  })

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
      return c.json(
        { error: `Can't read ${path}: ${(err as Error).message}` },
        400,
      )
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
        { error: `Can't read ${folder}: ${(err as Error).message}` },
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
      return c.json({ error: (err as Error).message }, 409)
    }
  })

  // Indexes a file again, e.g. after a failure or once embeddings work.
  app.post('/api/projects/:id/files/:fileId/index', (c) => {
    const fileId = c.req.param('fileId')
    if (projects.projectOf(fileId) !== c.req.param('id')) {
      return notFound(c, 'File')
    }
    projects.setStatus(fileId, 'indexing')
    void index.index(fileId)
    return c.body(null, 204)
  })

  // A draft for the user to review: nothing is saved here.
  app.post('/api/projects/:id/suggest-instructions', async (c) => {
    const id = c.req.param('id')
    if (!projects.get(id)) return notFound(c, 'Project')
    try {
      const instructions = await instructionWriter.suggest(id, c.req.raw.signal)
      return c.json({ instructions })
    } catch (err) {
      if (err instanceof NothingToSuggestFrom) {
        return c.json({ error: err.message }, 409)
      }
      const message =
        err instanceof OpenAI.APIError
          ? explainApiError(err)
          : (err as Error).message
      return c.json({ error: message }, 502)
    }
  })

  app.patch('/api/projects/:id', json(projectPatchSchema), (c) => {
    const project = projects.update(c.req.param('id'), c.req.valid('json'))
    return project ? c.json(project) : notFound(c, 'Project')
  })

  // Deletes the project's chats and files with it.
  app.delete('/api/projects/:id', (c) => {
    const id = c.req.param('id')
    if (!projects.get(id)) return notFound(c, 'Project')
    store
      .projectConversationIds(id)
      .forEach((chat) => store.deleteConversation(chat))
    projects.delete(id)
    watcher.update(id)
    attachments.deleteOrphans()
    return c.body(null, 204)
  })

  return app
}
