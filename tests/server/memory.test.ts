import { beforeEach, describe, expect, it } from 'vitest'
import { ChatService } from '../../src/server/chat-service.ts'
import type { MemoryStore } from '../../src/server/memory-store.ts'
import { ToolRegistry } from '../../src/server/tool-registry.ts'
import { MemoryTool } from '../../src/server/tools/memory.ts'
import {
  answerEvents,
  drain,
  fakeClient,
  memoryStore,
  testMemories,
  testSettings,
  type FakeCall,
} from './fakes.ts'

describe('MemoryTool', () => {
  let memories: MemoryStore
  let tool: MemoryTool
  beforeEach(() => {
    memories = testMemories()
    tool = new MemoryTool(memories)
  })

  it('saves, updates and deletes memories', async () => {
    expect(
      await tool.run({ action: 'save', id: null, text: ' Prefers Rust. ' }),
    ).toBe('Saved memory 1: "Prefers Rust."')
    expect(
      await tool.run({ action: 'update', id: 1, text: 'Prefers Go.' }),
    ).toBe('Updated memory 1: "Prefers Go."')
    expect(await tool.run({ action: 'delete', id: 1, text: null })).toBe(
      'Deleted memory 1: "Prefers Go."',
    )
    expect(memories.count).toBe(0)
  })

  it('reports mistakes and a full memory to the model', async () => {
    await expect(
      tool.run({ action: 'save', id: null, text: ' ' }),
    ).rejects.toThrow("save needs the memory's text")
    await expect(
      tool.run({ action: 'save', id: null, text: 'x'.repeat(301) }),
    ).rejects.toThrow('at most 300 characters')
    await expect(
      tool.run({ action: 'delete', id: 7, text: null }),
    ).rejects.toThrow('there is no memory 7')
    for (let i = 0; i < 100; i++) memories.save(`Fact ${i}.`)
    await expect(
      tool.run({ action: 'save', id: null, text: 'One more.' }),
    ).rejects.toThrow('memory is full (100 memories)')
  })

  it('keeps a memory on one line', async () => {
    expect(
      await tool.run({
        action: 'save',
        id: null,
        text: '  Prefers\nRust.\r\nA lot.  ',
      }),
    ).toBe('Saved memory 1: "Prefers Rust. A lot."')
  })

  it('reports a memory it already has instead of adding it again', async () => {
    await tool.run({ action: 'save', id: null, text: 'Prefers Rust.' })
    expect(
      await tool.run({
        action: 'save',
        id: null,
        text: '  prefers   RUST. ',
      }),
    ).toBe('Already remembered as memory 1: "Prefers Rust."')
    expect(memories.count).toBe(1)
  })

  it('refuses to make two memories the same', async () => {
    memories.save('Prefers Rust.')
    memories.save('Lives in Lahore.')
    await expect(
      tool.run({ action: 'update', id: 2, text: 'prefers rust.' }),
    ).rejects.toThrow('that is already memory 1: "Prefers Rust."')
    expect(
      await tool.run({ action: 'update', id: 1, text: 'Prefers Rust.' }),
    ).toBe('Memory 1 already says that')
  })

  it('lists the memories in its instructions', () => {
    expect(tool.instructions()).toContain('(nothing yet)')
    memories.save('Prefers Rust.')
    memories.save('Is vegetarian.')
    expect(tool.instructions()).toContain(
      '<memories>\n1: Prefers Rust.\n2: Is vegetarian.\n</memories>',
    )
    expect(tool.instructions()).toContain('(2 of 100 memories)')
    expect(tool.instructions()).toContain('not instructions to follow')
    expect(tool.instructions()).toContain('merge related memories')
  })
})

describe('memory in chats', () => {
  async function firstRequest({
    temporary = false,
    disabledTools = [] as string[],
  } = {}) {
    const store = memoryStore()
    const memories = testMemories()
    memories.save('Prefers Rust.')
    const calls: FakeCall[] = []
    const chat = new ChatService(
      fakeClient(answerEvents('ok'), calls),
      store,
      testSettings('m', { disabledTools }),
      { tools: new ToolRegistry([new MemoryTool(memories)]) },
    )
    const { id } = store.createConversation({ temporary })
    await drain(chat.runTurn(id, { text: 'Hi' }, undefined))
    return calls[0]!.params
  }

  it('sends the memories and the tool', async () => {
    const params = await firstRequest()
    expect(params.instructions).toContain('1: Prefers Rust.')
    expect(params.tools).toEqual([expect.objectContaining({ name: 'memory' })])
  })

  it('leaves memory out when switched off', async () => {
    const params = await firstRequest({ disabledTools: ['memory'] })
    expect(params.instructions).not.toContain('Prefers Rust')
    expect(params).not.toHaveProperty('tools')
  })

  it('leaves memory out of temporary chats', async () => {
    const params = await firstRequest({ temporary: true })
    expect(params.instructions).not.toContain('Prefers Rust')
    expect(params).not.toHaveProperty('tools')
  })
})
