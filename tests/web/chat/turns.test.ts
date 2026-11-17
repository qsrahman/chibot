import { describe, expect, it } from 'vitest'
import type { ResponseInputItem } from 'openai/resources/responses/responses'
import type { Compaction, StoredItem } from '../../../src/shared/types.ts'
import {
  fileIds,
  imageInfo,
  imagesOf,
  holdBackCard,
  nextStepInText,
  nextStepOf,
  newQuestion,
  shownText,
  toolPreview,
  sourcesOf,
  summarizeTool,
  toTurns,
  waitingCalls,
} from '../../../src/web/chat/turns.ts'
import { usage } from '../../server/fakes.ts'

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
  it('keeps the usage of the last response apart from the sum, as the context size', () => {
    const first = { ...usage, input_tokens: 40_000, total_tokens: 40_003 }
    const last = { ...usage, input_tokens: 57_000, total_tokens: 57_003 }
    const [turn] = toTurns([
      item(1, { role: 'user', content: 'Hi' }),
      item(
        2,
        {
          type: 'function_call',
          call_id: 'c',
          name: 'search',
          arguments: '{}',
        },
        { usage: first },
      ),
      item(3, { type: 'function_call_output', call_id: 'c', output: 'x' }),
      item(
        4,
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          id: 'm',
          content: [{ type: 'output_text', text: 'Done', annotations: [] }],
        },
        { usage: last },
      ),
    ])
    expect(turn!.answer!.usage!.input_tokens).toBe(97_000)
    expect(turn!.answer!.lastUsage).toEqual(last)
  })

  it('knows an answer that stopped early, from the model’s limit or the user’s Stop', () => {
    const answerOf = (data: unknown) =>
      toTurns([item(1, { role: 'user', content: 'Hi' }), item(2, data)])[0]!
        .answer
    // Typed and completed: whole.
    expect(
      answerOf({
        type: 'message',
        role: 'assistant',
        status: 'completed',
        id: 'm',
        content: [{ type: 'output_text', text: 'Done.', annotations: [] }],
      })?.incomplete,
    ).toBe(false)
    // The model ran out of output.
    expect(
      answerOf({
        type: 'message',
        role: 'assistant',
        status: 'incomplete',
        id: 'm',
        content: [{ type: 'output_text', text: 'Half', annotations: [] }],
      })?.incomplete,
    ).toBe(true)
    // What chibot keeps of an answer the user stopped: plain text.
    expect(
      answerOf({ role: 'assistant', content: 'Half of it' })?.incomplete,
    ).toBe(true)
  })

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
      item(
        4,
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          id: 'msg_2',
          content: [{ type: 'output_text', text: 'there', annotations: [] }],
        } as ResponseInputItem,
        { usage, model: 'm-1' },
      ),
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
          lastUsage: usage,
          model: 'm-1',
          memories: [],
          versions: null,
          incomplete: false,
        },
        compaction: null,
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
        compaction: null,
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

  it('shows a summary before the turn that starts after its cut', () => {
    const summary = {
      id: 1,
      upToItemId: 2,
      summary: 'notes',
    } as Compaction
    const turns = toTurns(
      [
        item(1, { role: 'user', content: 'q' }),
        item(2, { role: 'assistant', content: 'a' }),
        item(3, { role: 'user', content: 'q2' }),
        item(4, { role: 'assistant', content: 'a2' }),
      ],
      [summary],
    )
    expect(turns.map((t) => t.compaction)).toEqual([null, summary])
  })

  it('shows a summary cut inside a turn at the top of that turn', () => {
    const summary = { id: 1, upToItemId: 1, summary: 'notes' } as Compaction
    const turns = toTurns(
      [
        item(1, { role: 'user', content: 'q' }),
        item(2, {
          type: 'function_call',
          call_id: 'c',
          name: 'n',
          arguments: '{}',
        }),
        item(3, { type: 'function_call_output', call_id: 'c', output: 'o' }),
      ],
      [summary],
    )
    expect(turns.map((t) => t.compaction)).toEqual([summary])
  })

  it('ignores the items of OpenAI’s own compaction', () => {
    const [turn] = toTurns([
      item(1, { role: 'user', content: 'q' }),
      item(2, { type: 'compaction', id: 'c', encrypted_content: 'x' }),
      item(3, { role: 'assistant', content: 'a' }),
    ])
    expect(turn!.compaction).toBeNull()
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
      name: 'web_search',
      arguments: '{"query":"1+1"}',
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
        name: 'web_search',
        arguments: '{"query":"1+1"}',
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
      lastUsage: null,
      memories: [],
      model: null,
      versions: null,
      incomplete: false,
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
      lastUsage: null,
      memories: [],
      model: null,
      versions: null,
      incomplete: false,
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

  it('describes an image by its prompt, and reserves space from the size asked for', () => {
    expect(
      imageInfo(
        tool(
          'generate_image',
          { prompt: 'a red robot', size: 'landscape' },
          null,
        ),
      ),
    ).toEqual({ alt: 'Generated image: a red robot', ratio: '3 / 2' })
    expect(
      imageInfo(tool('generate_image', { prompt: 'x', size: 'portrait' }, null))
        .ratio,
    ).toBe('2 / 3')
    // "auto" and edits take their shape from the model or the source image.
    expect(
      imageInfo(tool('generate_image', { prompt: 'x', size: 'auto' }, null))
        .ratio,
    ).toBeUndefined()
    expect(imageInfo(tool('edit_image', { prompt: 'bluer' }, null))).toEqual({
      alt: 'Edited image: bluer',
      ratio: undefined,
    })
    expect(imageInfo(tool('generate_image', {}, null)).alt).toBe(
      'Generated image',
    )
    expect(
      imageInfo(
        tool(
          'generate_image',
          { prompt: 'p'.repeat(500), size: 'square' },
          null,
        ),
      ).alt,
    ).toHaveLength('Generated image: '.length + 120)
  })

  it('previews what a finished call came to, in a few words', () => {
    const results = JSON.stringify({
      results: [
        { title: 'A', url: 'https://a.test/' },
        { title: 'B', url: 'https://b.test/' },
      ],
    })
    expect(toolPreview(tool('web_search', { query: 'q' }, null))).toBeNull()
    expect(toolPreview(tool('web_search', { query: 'q' }, results))).toEqual({
      text: '2 results',
      failed: false,
    })
    expect(
      toolPreview(
        tool('web_search', { query: 'q' }, JSON.stringify({ results: [] })),
      )?.text,
    ).toBe('Nothing found')
    expect(
      toolPreview(
        tool('fetch_url', { url: 'https://example.com/page?x=1' }, 'text'),
      )?.text,
    ).toBe('example.com')
    expect(
      toolPreview(tool('generate_image', { prompt: 'a red robot' }, '{}'))
        ?.text,
    ).toBe('a red robot')
    // Errors say so, in the first line, cut to fit.
    expect(
      toolPreview(
        tool('fetch_url', {}, `Error: ${'x'.repeat(100)}\nmore detail`),
      ),
    ).toEqual({ text: `${'x'.repeat(59)}…`, failed: true })
    // An MCP tool shows the first line of its text; unknown tools show nothing.
    expect(
      toolPreview(tool('files__ls', {}, '{"result":"3 files\\nmore"}'))?.text,
    ).toBe('3 files')
    expect(toolPreview(tool('mystery', {}, 'x'))).toBeNull()
  })

  it('finds images made by image tools and returned by MCP tools', () => {
    expect(imagesOf(tool('generate_image', {}, null))).toEqual(['pending'])
    expect(imagesOf(tool('edit_image', {}, '{"image_id":"img-1"}'))).toEqual([
      'img-1',
    ])
    expect(imagesOf(tool('generate_image', {}, 'Error: quota'))).toEqual([])
    expect(imagesOf(tool('memory', {}, '{"image_ids":["x"]}'))).toEqual([])
    expect(
      imagesOf(tool('files__shot', {}, '{"result":"…","image_ids":["a","b"]}')),
    ).toEqual(['a', 'b'])
    expect(imagesOf(tool('files__shot', {}, null))).toEqual([])
    expect(imagesOf(tool('files__read', {}, 'plain text'))).toEqual([])
  })
})

describe('sources carry a snippet for the card a citation opens', () => {
  const answerWith = (name: string, output: object) => ({
    itemId: 1,
    text: '',
    thinking: '',
    usage: null,
    lastUsage: null,
    model: null,
    versions: null,
    incomplete: false,
    memories: [],
    tools: [
      { callId: 'c', name, arguments: '{}', output: JSON.stringify(output) },
    ],
  })

  it('takes a search result’s snippet or description, tidied and cut', () => {
    const long = `${'word '.repeat(100)}end`
    const [a, b, c] = sourcesOf(
      answerWith('web_search', {
        results: [
          { title: 'A', url: 'https://a.test/', snippet: ' one\n two ' },
          { title: 'B', url: 'https://b.test/', description: long },
          { title: 'C', url: 'https://c.test/', snippet: '  ' },
        ],
      }),
    )
    expect(a!.snippet).toBe('one two')
    expect(b!.snippet).toHaveLength(200)
    expect(b!.snippet!.endsWith('…')).toBe(true)
    expect(c).not.toHaveProperty('snippet')
  })

  it('takes a past chat’s first excerpt', () => {
    const [source] = sourcesOf(
      answerWith('search_chats', {
        results: [
          {
            chat_id: 'abc',
            title: 'T',
            messages: [{ role: 'user', excerpt: 'we chose SQLite' }],
          },
        ],
      }),
    )
    expect(source!.snippet).toBe('we chose SQLite')
  })
})

describe('sourcesOf with MCP web tools', () => {
  const answerWith = (name: string, output: string, args = {}) => ({
    itemId: 1,
    text: '',
    thinking: '',
    usage: null,
    lastUsage: null,
    model: null,
    versions: null,
    incomplete: false,
    memories: [],
    tools: [{ callId: 'c', name, arguments: JSON.stringify(args), output }],
  })

  it('reads results one JSON value to a paragraph, as Brave sends them', () => {
    const one = (n: number) =>
      JSON.stringify({
        url: `https://r${n}.test/`,
        title: `R${n}`,
        description: `about ${n}`,
        extra_snippets: [],
      })
    expect(
      sourcesOf(
        answerWith('search__brave_web_search', `${one(1)}\n\n${one(2)}`),
      ),
    ).toEqual([
      { url: 'https://r1.test/', title: 'R1', snippet: 'about 1' },
      { url: 'https://r2.test/', title: 'R2', snippet: 'about 2' },
    ])
  })

  it('reads nested JSON once, skipping addresses that are not web pages', () => {
    const output = JSON.stringify({
      web: {
        results: [
          { url: 'https://a.test/', title: 'A' },
          { url: 'file:///etc/passwd', title: 'Local' },
        ],
      },
      news: [{ link: 'https://n.test/', name: 'N', content: 'news' }],
    })
    expect(sourcesOf(answerWith('s__web_search', output))).toEqual([
      { url: 'https://a.test/', title: 'A' },
      { url: 'https://n.test/', title: 'N', snippet: 'news' },
    ])
  })

  it('reads Title / URL / Description lines', () => {
    const output =
      'Title: One\nDescription: first\nURL: https://one.test/\n\nTitle: Two\nURL: https://two.test/'
    expect(sourcesOf(answerWith('s__search', output))).toEqual([
      { url: 'https://one.test/', title: 'One', snippet: 'first' },
      { url: 'https://two.test/', title: 'Two' },
    ])
  })

  it('counts the page a fetch tool was asked for', () => {
    expect(
      sourcesOf(
        answerWith('fetch__fetch', 'Contents of the page…', {
          url: 'https://p.test/x',
        }),
      ),
    ).toEqual([{ url: 'https://p.test/x', title: 'https://p.test/x' }])
  })

  it('ignores other tools, errors and unfinished calls', () => {
    const output = JSON.stringify({ url: 'https://a.test/', title: 'A' })
    expect(sourcesOf(answerWith('tracker__list_issues', output))).toEqual([])
    expect(sourcesOf(answerWith('s__search', `Error: ${output}`))).toEqual([])
    expect(
      sourcesOf({ ...answerWith('s__search', output), tools: [] }),
    ).toEqual([])
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
        lastUsage: null,
        memories: [],
        model: null,
        versions: null,
        incomplete: false,
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
        lastUsage: null,
        memories: [],
        model: null,
        versions: null,
        incomplete: false,
        tools: [
          {
            callId: 'c',
            name: 'search_project_files',
            arguments: '{}',
            output,
          },
        ],
      }),
    ).toEqual([
      { url: '/api/files/f1', title: 'plan.md', kind: 'file', snippet: 'b' },
    ])
  })

  it('opens a PDF at the page of each passage', () => {
    const answer = (name: string, output: object) => ({
      itemId: 1,
      text: '',
      thinking: '',
      usage: null,
      lastUsage: null,
      memories: [],
      model: null,
      versions: null,
      incomplete: false,
      tools: [
        { callId: 'c', name, arguments: '{}', output: JSON.stringify(output) },
      ],
    })
    expect(
      sourcesOf(
        answer('search_project_files', {
          results: [
            { file: 'a.pdf', file_id: 'f1', page: 12, text: 'x' },
            { file: 'a.pdf', file_id: 'f1', page: 3, text: 'y' },
            { file: 'a.pdf', file_id: 'f1', page: 12, text: 'z' },
          ],
        }),
      ),
    ).toEqual([
      {
        url: '/api/files/f1#page=12',
        title: 'a.pdf · p. 12',
        kind: 'file',
        snippet: 'z',
      },
      {
        url: '/api/files/f1#page=3',
        title: 'a.pdf · p. 3',
        kind: 'file',
        snippet: 'y',
      },
    ])
  })

  it('links the file read_project_file read', () => {
    const tools = [
      {
        callId: 'c',
        name: 'read_project_file',
        arguments: '{"file":"plan.md","from_part":null}',
        output: JSON.stringify({ file: 'plan.md', file_id: 'f1', text: 'a' }),
      },
    ]
    expect(
      sourcesOf({
        itemId: 1,
        text: '',
        thinking: '',
        usage: null,
        lastUsage: null,
        memories: [],
        model: null,
        versions: null,
        incomplete: false,
        tools,
      }),
    ).toEqual([{ url: '/api/files/f1', title: 'plan.md', kind: 'file' }])
    expect(summarizeTool(tools[0]!)).toMatchObject({
      input: 'plan.md',
      links: [{ url: '/api/files/f1' }],
    })
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

  it('shows a memory change and a page read', () => {
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
      summarizeTool(call('fetch_url', { url: 'https://example.com/a' }, null)),
    ).toEqual({ input: 'https://example.com/a', result: null, links: [] })
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
})

describe('newQuestion and fileIds', () => {
  const photo = { fileId: 'f1', name: 'a.png', image: true }

  it('makes a question that is not saved yet, keeping its attachments', () => {
    expect(newQuestion('Hi', 4, [photo])).toEqual({
      itemId: null,
      parentId: 4,
      text: 'Hi',
      attachments: [photo],
      versions: null,
    })
  })

  it('names the files of a request, and leaves the key out without any', () => {
    expect(fileIds([photo, { ...photo, fileId: 'f2' }])).toEqual({
      fileIds: ['f1', 'f2'],
    })
    expect(fileIds([])).toEqual({})
  })
})

describe('toTurns memories', () => {
  it('shows the memories its response was written with, and none otherwise', () => {
    const memories = [{ id: 1, text: 'Prefers Rust.' }]
    const [kept, plain] = toTurns([
      item(1, { role: 'user', content: 'Hi' }),
      item(2, { role: 'assistant', content: 'Hello' }, { memories }),
      item(3, { role: 'user', content: 'Again' }),
      item(4, { role: 'assistant', content: 'Hello' }),
    ])
    expect(kept!.answer!.memories).toEqual(memories)
    expect(plain!.answer!.memories).toEqual([])
  })
})

describe('nextStepOf', () => {
  const card = {
    title: 'Weekly learning plan',
    description: 'turn these into a 16-week plan',
    button: 'Create plan',
    prompt: 'Make a 16-week plan',
  }
  const answerWith = (args: unknown, output: string | null = 'shown') => {
    const turns = toTurns([
      item(1, { role: 'user', content: 'q' }),
      item(2, {
        type: 'function_call',
        call_id: 'c',
        name: 'suggest_next_step',
        arguments: typeof args === 'string' ? args : JSON.stringify(args),
      }),
      ...(output === null
        ? []
        : [item(3, { type: 'function_call_output', call_id: 'c', output })]),
    ])
    return turns[0]!.answer!
  }

  it('reads the card from the call', () => {
    expect(nextStepOf(answerWith(card))).toEqual(card)
  })

  it('trims and cuts the model’s text to fit', () => {
    const step = nextStepOf(
      answerWith({ ...card, title: `  ${'x'.repeat(200)} `, button: ' Go ' }),
    )
    expect(step?.title).toHaveLength(80)
    expect(step?.button).toBe('Go')
  })

  it('shows no card for a failed, unanswered, malformed or incomplete call', () => {
    expect(nextStepOf(answerWith(card, 'Error: invalid arguments'))).toBeNull()
    expect(nextStepOf(answerWith(card, null))).toBeNull()
    expect(nextStepOf(answerWith('{not json'))).toBeNull()
    expect(nextStepOf(answerWith({ ...card, prompt: '  ' }))).toBeNull()
    expect(nextStepOf(answerWith({ title: 'Only a title' }))).toBeNull()
    expect(nextStepOf(answerWith({ ...card, button: 7 }))).toBeNull()
  })

  it('uses the last call', () => {
    const turns = toTurns([
      item(1, { role: 'user', content: 'q' }),
      ...[1, 2].flatMap((n) => [
        item(n * 2, {
          type: 'function_call',
          call_id: `c${n}`,
          name: 'suggest_next_step',
          arguments: JSON.stringify({ ...card, title: `T${n}` }),
        }),
        item(n * 2 + 1, {
          type: 'function_call_output',
          call_id: `c${n}`,
          output: 'shown',
        }),
      ]),
    ])
    expect(nextStepOf(turns[0]!.answer!)?.title).toBe('T2')
  })
})

describe('a next-step card written out as text', () => {
  const offer = '**Want a concise timeline of the key events?**'
  const card = {
    button: 'Create timeline',
    description: 'I’ll draft a brief chronological overview',
    prompt: 'Please give me a timeline of the key events',
    title: 'Crypto-Jewish timeline',
  }
  const written = (label = '*Suggest a next step:*', body = card) =>
    `Some answer.\n\n---\n\n${offer}\n\n${label}\n\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``
  const answerOf = (text: string) =>
    toTurns([
      item(1, { role: 'user', content: 'q' }),
      item(2, {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        id: 'm',
        content: [{ type: 'output_text', text, annotations: [] }],
      }),
    ])[0]!.answer!

  it('is read as the card, and the answer reads without it', () => {
    const text = written()
    expect(nextStepInText(text)?.step).toEqual({
      title: card.title,
      description: card.description,
      button: card.button,
      prompt: card.prompt,
    })
    // The offer stays; the label and the block go.
    expect(nextStepInText(text)?.text).toBe(`Some answer.\n\n---\n\n${offer}`)
    const answer = answerOf(text)
    expect(nextStepOf(answer)?.title).toBe(card.title)
    expect(shownText(answer)).toBe(`Some answer.\n\n---\n\n${offer}`)
  })

  it('takes the label plain, bold or in the past tense, and a fence without a language', () => {
    for (const label of [
      'Suggest a next step:',
      '**Suggest a next step:**',
      'Suggested next step:',
    ]) {
      expect(nextStepInText(written(label))?.step.title).toBe(card.title)
    }
    const bare = written().replace('```json', '```')
    expect(nextStepInText(bare)?.step.title).toBe(card.title)
  })

  it('is left alone without the label, in the middle, or with a bad block', () => {
    const noLabel = written('Here you go:')
    expect(nextStepInText(noLabel)).toBeNull()
    expect(shownText(answerOf(noLabel))).toBe(noLabel)

    const middle = `${written()}\n\nAnd one more thing.`
    expect(nextStepInText(middle)).toBeNull()

    const missing = written('Suggest a next step:', { ...card, prompt: ' ' })
    expect(nextStepInText(missing)).toBeNull()
    expect(
      nextStepInText(written().replace('"button"', '"button" ')),
    ).not.toBeNull()
    expect(
      nextStepInText('Suggest a next step:\n\n```json\n{not json}\n```'),
    ).toBeNull()
  })

  it('is held back while it streams: no label, no fence, no JSON at any point', () => {
    const text = written()
    const labelDone = text.indexOf('step:*') + 'step:*'.length
    for (let end = 0; end <= text.length; end++) {
      const held = holdBackCard(text.slice(0, end))
      expect(held, `at ${end}`).not.toContain('`')
      expect(held, `at ${end}`).not.toContain('"title"')
      if (end >= labelDone) expect(held, `at ${end}`).not.toContain('Suggest')
    }
    // And what is left is the answer, as it will read when it is done.
    expect(holdBackCard(text)).toBe(nextStepInText(text)!.text)
  })

  it('holds back only that: other text streams as it is', () => {
    for (const plain of [
      '',
      'Plain answer',
      'Suggestions are welcome',
      'Suggest a next step: read the docs',
      'Suggest a next step:\n\nRead the docs first.',
      'Code:\n\n```json\n{"a": 1}\n```',
      'Ends with a line, Su',
    ]) {
      expect(holdBackCard(plain)).toBe(plain)
    }
    expect(holdBackCard('Offer?\n\nSuggest a ne')).toBe('Offer?')
    expect(holdBackCard('Offer?\n\n*Suggest a next step:*')).toBe('Offer?')
    expect(holdBackCard('Offer?\n\nSuggest a next step:\n\n```js')).toBe(
      'Offer?',
    )
  })

  it('does not apply to an answer that made the call, or one that was cut off', () => {
    const text = written()
    const called = toTurns([
      item(1, { role: 'user', content: 'q' }),
      item(2, {
        type: 'message',
        role: 'assistant',
        status: 'completed',
        id: 'm',
        content: [{ type: 'output_text', text, annotations: [] }],
      }),
      item(3, {
        type: 'function_call',
        call_id: 'c',
        name: 'suggest_next_step',
        arguments: JSON.stringify({ ...card, title: 'From the call' }),
      }),
      item(4, { type: 'function_call_output', call_id: 'c', output: 'shown' }),
    ])[0]!.answer!
    expect(nextStepOf(called)?.title).toBe('From the call')
    expect(shownText(called)).toBe(called.text)

    const cut = { ...answerOf(text), incomplete: true }
    expect(shownText(cut)).toBe(cut.text)
  })
})
