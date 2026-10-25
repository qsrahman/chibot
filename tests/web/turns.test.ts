import { describe, expect, it } from 'vitest'
import type { ResponseInputItem } from 'openai/resources/responses/responses'
import type { StoredItem } from '../../src/shared/types.ts'
import {
  imagesOf,
  sourcesOf,
  summarizeTool,
  mcpToolName,
  toTurns,
  waitingCalls,
} from '../../src/web/turns.ts'
import { usage } from '../server/fakes.ts'

const item = (
  id: number,
  data: unknown,
  extra: Partial<StoredItem> = {},
): StoredItem => ({
  id,
  parentId: id - 1 || null,
  data: data as ResponseInputItem,
  usage: null,
  model: null,
  siblingIds: [id],
  createdAt: 0,
  ...extra,
})

describe('toTurns', () => {
  it('groups each question with the output items that answer it', () => {
    const turns = toTurns([
      item(1, { role: 'user', content: 'Hi' }),
      item(2, {
        type: 'reasoning',
        id: 'rs_1',
        summary: [
          { type: 'summary_text', text: '**Plan**' },
          { type: 'summary_text', text: 'Say hello.' },
        ],
      }),
      item(3, {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Hello ', annotations: [] }],
      }),
      item(4, { role: 'assistant', content: 'there' }, { usage, model: 'm-1' }),
      item(5, { role: 'user', content: 'Bye' }),
    ])
    expect(turns).toEqual([
      {
        key: '1',
        question: {
          itemId: 1,
          parentId: null,
          text: 'Hi',
          attachments: [],
          versions: null,
        },
        // The answer is identified by its first item (where regenerations
        // branch off), and its text joins the message items.
        answer: {
          itemId: 2,
          text: 'Hello \n\nthere',
          thinking: '**Plan**\n\nSay hello.',
          tools: [],
          usage,
          model: 'm-1',
          versions: null,
        },
        compacted: false,
      },
      {
        key: '5',
        question: {
          itemId: 5,
          parentId: 4,
          text: 'Bye',
          attachments: [],
          versions: null,
        },
        answer: null,
        compacted: false,
      },
    ])
  })

  it('reports versions with a 1-based index', () => {
    const [turn] = toTurns([
      item(7, { role: 'user', content: 'edited' }, { siblingIds: [1, 7] }),
      item(9, { role: 'assistant', content: 'b' }, { siblingIds: [8, 9, 10] }),
    ])
    expect(turn!.question.versions).toEqual({ index: 2, ids: [1, 7] })
    expect(turn!.answer!.versions).toEqual({ index: 2, ids: [8, 9, 10] })
  })

  it('marks answers that compacted the context', () => {
    const [turn] = toTurns([
      item(1, { role: 'user', content: 'q' }),
      item(2, { type: 'compaction', id: 'c', encrypted_content: 'x' }),
      item(3, { role: 'assistant', content: 'a' }),
    ])
    expect(turn!.compacted).toBe(true)
    expect(turn!.answer!.text).toBe('a')
  })

  it('shows refusals as text', () => {
    const [turn] = toTurns([
      item(1, { role: 'user', content: 'q' }),
      item(2, {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'refusal', refusal: 'I can’t help with that.' }],
      }),
    ])
    expect(turn!.answer!.text).toBe('I can’t help with that.')
  })

  it('collects tool calls with their outputs', () => {
    const call = (id: string) => ({
      type: 'function_call',
      call_id: id,
      name: 'calculator',
      arguments: '{"expression":"1+1"}',
    })
    const turns = toTurns([
      item(1, { role: 'user', content: 'q' }),
      item(2, call('c1')),
      item(3, { type: 'function_call_output', call_id: 'c1', output: '2' }),
      item(4, { role: 'assistant', content: 'It is 2.' }),
      item(5, { role: 'user', content: 'again' }),
      item(6, call('c2')),
    ])
    expect(turns[0]!.answer!.tools).toEqual([
      {
        callId: 'c1',
        name: 'calculator',
        arguments: '{"expression":"1+1"}',
        output: '2',
      },
    ])
    expect(turns[0]!.answer!.text).toBe('It is 2.')
    expect(waitingCalls(turns)).toEqual([
      expect.objectContaining({ callId: 'c2', output: null }),
    ])
    expect(waitingCalls(turns.slice(0, 1))).toEqual([])
  })
})

describe('sourcesOf and imagesOf', () => {
  const tool = (name: string, args: unknown, output: string | null) => ({
    callId: name,
    name,
    arguments: JSON.stringify(args),
    output,
  })

  it('lists searched and read pages once each', () => {
    const sources = sourcesOf({
      itemId: 2,
      text: '',
      thinking: '',
      usage: null,
      model: null,
      versions: null,
      tools: [
        tool(
          'web_search',
          { query: 'q' },
          JSON.stringify({
            query: 'q',
            results: [
              { title: 'A', url: 'https://a.test/', description: '' },
              { title: 'B', url: 'https://b.test/', description: '' },
            ],
          }),
        ),
        tool('fetch_url', { url: 'https://a.test/' }, 'Content of …'),
        tool('fetch_url', { url: 'https://c.test/x' }, 'Content of …'),
        tool('fetch_url', { url: 'https://d.test/' }, 'Error: 404'),
        tool('web_search', { query: 'r' }, null),
      ],
    })
    expect(sources).toEqual([
      { url: 'https://a.test/', title: 'A' },
      { url: 'https://b.test/', title: 'B' },
      { url: 'https://c.test/x', title: 'https://c.test/x' },
    ])
  })

  it('ignores malformed and unsafe tool output', () => {
    const sources = sourcesOf({
      itemId: 2,
      text: '',
      thinking: '',
      usage: null,
      model: null,
      versions: null,
      tools: [
        tool('web_search', {}, JSON.stringify({ results: 'not an array' })),
        tool(
          'web_search',
          {},
          JSON.stringify({
            results: [
              { title: 'Unsafe', url: 'javascript:alert(1)' },
              { title: 'Broken', url: 'not a url' },
              { title: 42, url: 'https://ok.test/' },
              'not an object',
            ],
          }),
        ),
        tool('fetch_url', { url: 'javascript:alert(1)' }, 'Content'),
        tool('fetch_url', { url: 'https://fetch.test/x' }, 'Content'),
        tool(
          'search_chats',
          {},
          JSON.stringify({
            results: [
              { chat_id: 42, title: 'Bad id' },
              { chat_id: 'a/b', title: 5 },
            ],
          }),
        ),
        tool(
          'search_project_files',
          {},
          JSON.stringify({ results: { file: 'not an array' } }),
        ),
      ],
    })
    expect(sources).toEqual([
      { url: 'https://ok.test/', title: 'https://ok.test/' },
      { url: 'https://fetch.test/x', title: 'https://fetch.test/x' },
      { url: '/c/a%2Fb', title: 'Chat', kind: 'chat' },
    ])
  })

  it('finds images made by image tools and returned by MCP tools', () => {
    expect(imagesOf(tool('generate_image', {}, null))).toEqual(['pending'])
    expect(imagesOf(tool('edit_image', {}, '{"image_id":"img-1"}'))).toEqual([
      'img-1',
    ])
    expect(imagesOf(tool('generate_image', {}, 'Error: quota'))).toEqual([])
    expect(imagesOf(tool('calculator', {}, '{"image_ids":["x"]}'))).toEqual([])
    expect(
      imagesOf(tool('files__shot', {}, '{"result":"…","image_ids":["a","b"]}')),
    ).toEqual(['a', 'b'])
    expect(imagesOf(tool('files__shot', {}, null))).toEqual([])
    expect(imagesOf(tool('files__read', {}, 'plain text'))).toEqual([])
  })
})

describe('sourcesOf with past chats', () => {
  it('links chats found by search_chats inside chibot', () => {
    const output = JSON.stringify({
      query: 'q',
      results: [{ chat_id: 'abc', title: 'Storage design', messages: [] }],
    })
    expect(
      sourcesOf({
        itemId: 1,
        text: '',
        thinking: '',
        usage: null,
        model: null,
        versions: null,
        tools: [{ callId: 'c', name: 'search_chats', arguments: '{}', output }],
      }),
    ).toEqual([{ url: '/c/abc', title: 'Storage design', kind: 'chat' }])
  })
})

describe('sourcesOf with project files', () => {
  it('links the files search_project_files found', () => {
    const output = JSON.stringify({
      query: 'q',
      results: [
        { file: 'plan.md', file_id: 'f1', text: 'a' },
        { file: 'plan.md', file_id: 'f1', text: 'b' },
      ],
    })
    expect(
      sourcesOf({
        itemId: 1,
        text: '',
        thinking: '',
        usage: null,
        model: null,
        versions: null,
        tools: [
          {
            callId: 'c',
            name: 'search_project_files',
            arguments: '{}',
            output,
          },
        ],
      }),
    ).toEqual([{ url: '/api/files/f1', title: 'plan.md', kind: 'file' }])
  })
})

describe('attachments', () => {
  it('lists the files a message attaches', () => {
    const [turn] = toTurns([
      item(1, {
        role: 'user',
        content: [
          { type: 'input_image', file_id: 'img', detail: 'auto' },
          { type: 'input_file', file_id: 'doc', filename: 'notes.pdf' },
          { type: 'input_text', text: 'What is this?' },
        ],
      }),
    ])
    expect(turn!.question).toMatchObject({
      text: 'What is this?',
      attachments: [
        { fileId: 'img', image: true, name: null },
        { fileId: 'doc', image: false, name: 'notes.pdf' },
      ],
    })
  })
})

describe('summarizeTool', () => {
  const call = (name: string, args: object, output: string | null) => ({
    callId: 'c1',
    name,
    arguments: JSON.stringify(args),
    output,
  })

  it('shows a search as its query and the results found', () => {
    const output = JSON.stringify({
      query: 'sqlite wal',
      results: [
        { title: 'WAL', url: 'https://sqlite.org/wal.html' },
        { title: 'Bad', url: 'javascript:alert(1)' },
      ],
    })
    expect(
      summarizeTool(call('web_search', { query: 'sqlite wal' }, output)),
    ).toEqual({
      input: 'sqlite wal',
      result: null,
      links: [{ url: 'https://sqlite.org/wal.html', title: 'WAL' }],
    })
    expect(
      summarizeTool(
        call(
          'search_chats',
          { query: 'trip' },
          '{"query":"trip","results":[]}',
        ),
      ),
    ).toEqual({ input: 'trip', result: 'Nothing found', links: [] })
  })

  it('shows a calculation, a memory change and a page read', () => {
    expect(
      summarizeTool(call('calculator', { expression: '12 * 7' }, '84')),
    ).toEqual({ input: '12 * 7', result: '84', links: [] })
    expect(
      summarizeTool(
        call('memory', { action: 'save' }, 'Saved memory 3: "Vegetarian"'),
      ),
    ).toEqual({
      input: null,
      result: 'Saved memory 3: "Vegetarian"',
      links: [],
    })
    expect(
      summarizeTool(
        call('fetch_url', { url: 'https://example.com/a' }, 'Page text…'),
      ),
    ).toMatchObject({ input: 'https://example.com/a', result: null })
  })

  it('shows errors, running calls and unknown tools sensibly', () => {
    expect(
      summarizeTool(call('web_search', { query: 'x' }, 'Error: quota')),
    ).toEqual({ input: 'x', result: 'Error: quota', links: [] })
    expect(
      summarizeTool(call('calculator', { expression: '1+1' }, null)),
    ).toEqual({ input: '1+1', result: null, links: [] })
    // Unknown tools (e.g. the e2e test tool) show their raw call only.
    expect(summarizeTool(call('e2e_note', { text: 'x' }, 'ok'))).toBeNull()
  })
  it('shows an MCP tool’s arguments and the text the model got', () => {
    expect(
      summarizeTool(call('files__read', { path: '/a.txt' }, 'hello')),
    ).toEqual({ input: '{"path":"/a.txt"}', result: 'hello', links: [] })
    expect(
      summarizeTool(
        call('files__shot', {}, '{"result":"[An image]","image_ids":["i"]}'),
      ),
    ).toEqual({ input: null, result: '[An image]', links: [] })
  })

  it('splits MCP tool names', () => {
    expect(mcpToolName('files__read__all')).toEqual({
      server: 'files',
      tool: 'read__all',
    })
    expect(mcpToolName('web_search')).toBeNull()
  })
})
