import { Hono } from 'hono'
import { documentKind } from '../../shared/documents.ts'
import {
  addProjectFileSchema,
  createProjectSchema,
  projectPatchSchema,
} from '../../shared/requests.ts'
import type { ProjectWithContents } from '../../shared/types.ts'
import type { AppDeps } from '../app.ts'
import { json, notFound } from './helpers.ts'

export function projectRoutes({
  store,
  files,
  projects,
  index,
  attachments,
}: AppDeps) {
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
