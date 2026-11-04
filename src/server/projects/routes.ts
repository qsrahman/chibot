import { Hono } from 'hono'
import OpenAI from 'openai'
import { documentKind } from '../../shared/documents.ts'
import {
  addProjectFileSchema,
  createProjectSchema,
  projectPatchSchema,
} from '../../shared/requests.ts'
import type { ProjectWithContents } from '../../shared/types.ts'
import type { Attachments } from '../attachments.ts'
import type { ConversationStore } from '../conversation-store.ts'
import type { FileStore } from '../file-store.ts'
import type { InstructionWriter } from './instruction-writer.ts'
import type { ProjectIndex } from './project-index.ts'
import type { ProjectStore } from './project-store.ts'
import { explainApiError } from '../api-errors.ts'
import { NothingToSuggestFrom } from './instruction-writer.ts'
import { json, notFound } from '../routes/helpers.ts'

export function projectRoutes({
  store,
  files,
  projects,
  index,
  instructionWriter,
  attachments,
}: {
  store: ConversationStore
  files: FileStore
  projects: ProjectStore
  index: ProjectIndex
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
    attachments.deleteOrphans()
    return c.body(null, 204)
  })

  return app
}
