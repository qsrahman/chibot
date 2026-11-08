// Questions for the project search evaluation over real documents
// (tests/server/projects/retrieval-docs.test.ts), written against the frozen
// copies in tests/fixtures/retrieval-docs. `has` appears once, in `file`.

export interface DocQuestion {
  ask: string
  file: string
  has: string
}

/** The answer's own words appear in the question. */
export const SAME_WORDS: DocQuestion[] = [
  {
    ask: 'What does --throttle 6 do to the CPU?',
    file: 'TESTING.md',
    has: 'makes the CPU six times',
  },
  {
    ask: 'How many ms does opening the 500-turn chat take on the laptop baseline?',
    file: 'TESTING.md',
    has: '326 ms',
  },
  {
    ask: 'Which data folder does the seed command refuse?',
    file: 'TESTING.md',
    has: 'it refuses your real data folder',
  },
  {
    ask: 'What kind of SQLite databases should tests use?',
    file: 'TESTING.md',
    has: "use `':memory:'` databases",
  },
  {
    ask: 'When is a difference of one or two noise?',
    file: 'TESTING.md',
    has: 'a difference of one or two is noise',
  },
  {
    ask: 'How do the Playwright specs point the real SDK at the fake OpenAI server?',
    file: 'TESTING.md',
    has: '`tests/e2e/fake-openai.ts` via `OPENAI_BASE_URL`',
  },
  {
    ask: 'What does a question containing "slow" make the fake server do?',
    file: 'TESTING.md',
    has: 'streams a long',
  },
  {
    ask: 'Which command installs Chromium before the first e2e run?',
    file: 'TESTING.md',
    has: 'colour belongs in it. First run:',
  },
  {
    ask: 'What should a tool do when it hits an error?',
    file: 'TOOLS.md',
    has: 'Throw for errors',
  },
  {
    ask: 'Which value asks only in chats that hold untrusted content?',
    file: 'TOOLS.md',
    has: "Use `'after-untrusted'` to ask only in chats that hold untrusted content",
  },
  {
    ask: 'Where is a new tool added so that it is offered?',
    file: 'TOOLS.md',
    has: 'Add it to `defaultTools()` (`main.ts`)',
  },
  {
    ask: 'What does MediaProxy do for linked images and media?',
    file: 'TOOLS.md',
    has: '`MediaProxy` does, for linked images and media',
  },
  {
    ask: 'How long does runTurn wait for the previous turn of the chat to unwind?',
    file: 'TURN.md',
    has: 'waits (up to 5 s)',
  },
  {
    ask: 'How many requests does the turn loop make at most?',
    file: 'TURN.md',
    has: 'at most `MAX_STEPS` (10) requests',
  },
  {
    ask: 'What does the host check protect against?',
    file: 'TURN.md',
    has: 'against DNS rebinding',
  },
  {
    ask: 'What does explainApiError say?',
    file: 'TURN.md',
    has: 'says what a 429 means',
  },
  {
    ask: 'Does a pending approval survive a reload?',
    file: 'TURN.md',
    has: 'The pending approval is just the history ending in unanswered calls',
  },
  {
    ask: 'What is the request body for regenerating an answer?',
    file: 'TURN.md',
    has: '`{ parentId }` (answers that user message again)',
  },
  {
    ask: 'How many memories can be used at most?',
    file: 'README.md',
    has: 'how many of the 100 are used',
  },
  {
    ask: 'What is the largest video chibot will show in an answer?',
    file: 'README.md',
    has: '500 MB (video)',
  },
  {
    ask: 'When do MCP tool calls time out?',
    file: 'README.md',
    has: 'calls time out after a minute',
  },
  {
    ask: 'Is there an offline mode for the installed app?',
    file: 'README.md',
    has: 'there is no offline mode',
  },
  {
    ask: 'How do I run chibot on port 8080?',
    file: 'README.md',
    has: '`chibot --port 8080` picks another',
  },
  {
    ask: 'What does Shift+Enter do in the message box?',
    file: 'README.md',
    has: '**Shift+Enter** adds a new line',
  },
  {
    ask: 'How much of a long tool output is kept, head and tail?',
    file: 'CONTEXT.md',
    has: 'keeps its **head 4,000 and tail 1,000**',
  },
  {
    ask: 'How long may the focus of a manual compaction be?',
    file: 'CONTEXT.md',
    has: 'optional focus (up to 800 characters)',
  },
  {
    ask: 'What share of an average turn was tool output in SWE-agent?',
    file: 'CONTEXT.md',
    has: 'tool output was about 84% of an average turn',
  },
  {
    ask: 'What are the tokens kept free for the answer and the summary?',
    file: 'CONTEXT.md',
    has: 'tokens kept free for the answer and the summary',
  },
  {
    ask: 'Which context window is used when the server does not say?',
    file: 'CONTEXT.md',
    has: 'from the server if it says, else 32,000',
  },
  {
    ask: 'Which Node version does the server need?',
    file: 'AGENTS.md',
    has: '**Node ≥ 26**',
  },
  {
    ask: 'What replaces enum in the server code?',
    file: 'AGENTS.md',
    has: 'Use string-literal unions or `as const` objects',
  },
  {
    ask: 'How often should I commit?',
    file: 'AGENTS.md',
    has: '**Commit after every change**',
  },
  {
    ask: 'Which checks run before each commit?',
    file: 'AGENTS.md',
    has: '`pnpm typecheck && pnpm test && pnpm format:check`',
  },
  {
    ask: 'What checks the import rules between features?',
    file: 'AGENTS.md',
    has: '`pnpm deps` checks all of this',
  },
  { ask: 'How tall is a toast?', file: 'DESIGN.md', has: 'radius, 44 px tall' },
  {
    ask: 'After how long hovering does a tooltip show?',
    file: 'DESIGN.md',
    has: 'It shows after 350 ms of hovering',
  },
  {
    ask: 'How wide is the MCP server form dialog?',
    file: 'DESIGN.md',
    has: '**MCP server form.** A dialog (560 px)',
  },
  {
    ask: 'Which colour is --fg-muted in the light theme?',
    file: 'DESIGN.md',
    has: '`#5d5d5d`',
  },
  {
    ask: 'How big are the chunks of a project file and how much do they overlap?',
    file: 'PLAN.md',
    has: '~3,200 characters, 15% overlap',
  },
  {
    ask: 'How many dimensions does text-embedding-3-small have?',
    file: 'PLAN.md',
    has: '(1536 dimensions)',
  },
  {
    ask: 'Which sqlite-vec version was checked to load into node:sqlite?',
    file: 'PLAN.md',
    has: '`sqlite-vec` 0.1.9',
  },
  {
    ask: 'How many chunks does search_project_files return by default?',
    file: 'PLAN.md',
    has: 'merged by reciprocal rank fusion, the top 6',
  },
  {
    ask: 'What engine runs the planned Python tool?',
    file: 'PLAN.md',
    has: '(CPython on WebAssembly)',
  },
]

/** The same facts asked in other words (the first set to tune on). */
export const PARAPHRASES: DocQuestion[] = [
  {
    ask: 'How do I simulate a slow phone when timing the chat page?',
    file: 'TESTING.md',
    has: 'makes the CPU six times',
  },
  {
    ask: 'How long until the biggest test chat shows its newest message?',
    file: 'TESTING.md',
    has: '326 ms',
  },
  {
    ask: 'Can the fake-chat generator touch my actual chats?',
    file: 'TESTING.md',
    has: 'it refuses your real data folder',
  },
  {
    ask: 'Which database should unit tests run against so nothing is written to disk?',
    file: 'TESTING.md',
    has: "use `':memory:'` databases",
  },
  {
    ask: 'How much can I trust small score differences on the evaluation questions?',
    file: 'TESTING.md',
    has: 'a difference of one or two is noise',
  },
  {
    ask: 'What do browser tests talk to instead of the real model provider?',
    file: 'TESTING.md',
    has: '`tests/e2e/fake-openai.ts` via `OPENAI_BASE_URL`',
  },
  {
    ask: 'What do I run once before running browser tests on a new machine?',
    file: 'TESTING.md',
    has: 'colour belongs in it. First run:',
  },
  {
    ask: 'How does a failing tool report a problem to the model?',
    file: 'TOOLS.md',
    has: 'Throw for errors',
  },
  {
    ask: 'How can a tool ask for permission only after outside text has appeared?',
    file: 'TOOLS.md',
    has: "Use `'after-untrusted'` to ask only in chats that hold untrusted content",
  },
  {
    ask: 'Which function registers the tools that ship with chibot?',
    file: 'TOOLS.md',
    has: 'Add it to `defaultTools()` (`main.ts`)',
  },
  {
    ask: 'After I press Stop and send again, how long may the server hold my new message back?',
    file: 'TURN.md',
    has: 'waits (up to 5 s)',
  },
  {
    ask: 'What caps the number of model calls in one answer?',
    file: 'TURN.md',
    has: 'at most `MAX_STEPS` (10) requests',
  },
  {
    ask: 'Why does the server only answer to this machine’s own names?',
    file: 'TURN.md',
    has: 'against DNS rebinding',
  },
  {
    ask: 'Which helper turns a rate-limit response into a readable message?',
    file: 'TURN.md',
    has: 'says what a 429 means',
  },
  {
    ask: 'If I refresh the page while a tool waits for my permission, is it lost?',
    file: 'TURN.md',
    has: 'The pending approval is just the history ending in unanswered calls',
  },
  {
    ask: 'How does the browser ask for another answer to the same message?',
    file: 'TURN.md',
    has: '`{ parentId }` (answers that user message again)',
  },
  {
    ask: 'What is the limit on remembered facts?',
    file: 'README.md',
    has: 'how many of the 100 are used',
  },
  {
    ask: 'How big may a video in an answer be before it is refused?',
    file: 'README.md',
    has: '500 MB (video)',
  },
  {
    ask: 'How long does chibot wait for a tool server to answer?',
    file: 'README.md',
    has: 'calls time out after a minute',
  },
  {
    ask: 'Can the installed app run without the local server?',
    file: 'README.md',
    has: 'there is no offline mode',
  },
  {
    ask: 'How can I make it listen somewhere other than 3000?',
    file: 'README.md',
    has: '`chibot --port 8080` picks another',
  },
  {
    ask: 'How do I start a second line in the message box?',
    file: 'README.md',
    has: '**Shift+Enter** adds a new line',
  },
  {
    ask: 'When a tool result is shortened, which parts survive?',
    file: 'CONTEXT.md',
    has: 'keeps its **head 4,000 and tail 1,000**',
  },
  {
    ask: 'What is the maximum length of the note that steers a summary?',
    file: 'CONTEXT.md',
    has: 'optional focus (up to 800 characters)',
  },
  {
    ask: 'How much of an agent’s context goes to what tools return?',
    file: 'CONTEXT.md',
    has: 'tool output was about 84% of an average turn',
  },
  {
    ask: 'How many tokens stay free for the reply and the summary?',
    file: 'CONTEXT.md',
    has: 'tokens kept free for the answer and the summary',
  },
  {
    ask: 'Which context size does chibot fall back on?',
    file: 'CONTEXT.md',
    has: 'from the server if it says, else 32,000',
  },
  {
    ask: 'What runtime must be installed to run the server?',
    file: 'AGENTS.md',
    has: '**Node ≥ 26**',
  },
  {
    ask: 'Should I batch several changes into one commit?',
    file: 'AGENTS.md',
    has: '**Commit after every change**',
  },
  {
    ask: 'What must pass before I commit?',
    file: 'AGENTS.md',
    has: '`pnpm typecheck && pnpm test && pnpm format:check`',
  },
]

/** More paraphrases, written before any change to search was compared on the others. */
export const HELD_OUT: DocQuestion[] = [
  {
    ask: 'How are layering violations between features caught?',
    file: 'AGENTS.md',
    has: '`pnpm deps` checks all of this',
  },
  {
    ask: 'What is the height of the pill that confirms an action?',
    file: 'DESIGN.md',
    has: 'radius, 44 px tall',
  },
  {
    ask: 'How quickly does a bubble appear when the pointer rests on a control?',
    file: 'DESIGN.md',
    has: 'It shows after 350 ms of hovering',
  },
  {
    ask: 'What width does the dialog for adding a tool server have?',
    file: 'DESIGN.md',
    has: '**MCP server form.** A dialog (560 px)',
  },
  {
    ask: 'What grey is used for descriptions and captions in the light theme?',
    file: 'DESIGN.md',
    has: '`#5d5d5d`',
  },
  {
    ask: 'How long is a piece of a project file when it is split for search?',
    file: 'PLAN.md',
    has: '~3,200 characters, 15% overlap',
  },
  {
    ask: 'What is the vector size of OpenAI’s small embedding model?',
    file: 'PLAN.md',
    has: '(1536 dimensions)',
  },
  {
    ask: 'Which release of the vector extension was checked to load in node:sqlite?',
    file: 'PLAN.md',
    has: '`sqlite-vec` 0.1.9',
  },
  {
    ask: 'How many passages come back from a file search unless the model asks for more?',
    file: 'PLAN.md',
    has: 'merged by reciprocal rank fusion, the top 6',
  },
  {
    ask: 'Which WebAssembly interpreter is planned for running code?',
    file: 'PLAN.md',
    has: '(CPython on WebAssembly)',
  },
  {
    ask: 'Which component stops the server fetching private network addresses for pictures?',
    file: 'TOOLS.md',
    has: '`MediaProxy` does, for linked images and media',
  },
  {
    ask: 'Is a tool approval request lost when the page is refreshed?',
    file: 'TURN.md',
    has: 'The pending approval is just the history ending in unanswered calls',
  },
  {
    ask: 'How should a fixed set of named values be declared when types are only stripped?',
    file: 'AGENTS.md',
    has: 'Use string-literal unions or `as const` objects',
  },
  {
    ask: 'How can I make the test answer arrive gradually?',
    file: 'TESTING.md',
    has: 'streams a long',
  },
]

/** Nothing in the documents answers these: for how similar the best passage is anyway. */
export const OFF_TOPIC: string[] = [
  'What is the capital of France?',
  'How do I fix a flat bicycle tire?',
  'Who won the 2018 football World Cup?',
  'Explain quantum entanglement simply.',
  'What is the best way to learn the guitar?',
  'How tall is Mount Everest?',
  'Write a poem about autumn.',
  'What is the boiling point of mercury?',
  'Which planet has the most moons?',
  'How do I convert Celsius to Fahrenheit?',
  'Who painted the Mona Lisa?',
  'What is the population of Japan?',
  'How do I bake sourdough bread?',
  'What does the enterprise plan cost per month?',
  'How do I reset my account password?',
  'Which cloud region hosts the servers?',
  'How do I invite teammates to my workspace?',
  'What is the support phone number?',
  'Does it run on a Raspberry Pi Zero?',
  'How many GitHub stars does the project have?',
]
