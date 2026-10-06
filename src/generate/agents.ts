import { removeEntry, setEntry, type Json } from './merge.js';

export interface WorkflowCommand {
  id: 'propose' | 'apply' | 'archive';
  description: string;
  argumentHint: string;
}

export const WORKFLOW_COMMANDS: WorkflowCommand[] = [
  {
    id: 'propose',
    description: 'Plan a change as an OpenSpec proposal, from a description, a GitHub issue or a Trello card',
    argumentHint: '<description | GitHub issue | Trello card>',
  },
  { id: 'apply', description: 'Implement an approved OpenSpec change, task by task', argumentHint: '[change-name]' },
  { id: 'archive', description: 'Archive a finished OpenSpec change and update the specs', argumentHint: '[change-name]' },
];

export interface GeneratedFile {
  path: string;
  content: string;
}

/** An MCP server entry merged into a JSON settings file that may also hold the developer's own entries. */
export interface JsonEdit {
  path: string;
  set(document: Json): Json;
  unset(document: Json): Json;
}

export interface AgentAdapter {
  id: string;
  /** How a developer types the command in this agent, e.g. `/ss-propose`. */
  invocation(name: string): string;
  commandFiles(prefix: string): GeneratedFile[];
  jsonEdits: JsonEdit[];
  /** Markdown files that need a solstack section (e.g. CLAUDE.md importing AGENTS.md). */
  markdownBlocks: { path: string; body: string }[];
  /** Where the agent reads repository skills (Agent Skills format). Agents without skills omit it. */
  skillsDir?: string;
  /** Explains what the developer must still do by hand, when the agent has no repository-level MCP config. */
  manualMcpSetup?: string;
}

export const MCP_SERVER_NAME = 'solstack';
const STDIO_SERVER = { command: 'solstack', args: ['mcp'] };

const quote = (value: string) => JSON.stringify(value);

function body(command: WorkflowCommand, input: string): string {
  return `Read \`.solstack/commands/${command.id}.md\` and follow its instructions exactly.\n\nInput: ${input}\n`;
}

const TYPED_INPUT = 'the text typed after this command (it may be empty).';

function mcpEntry(path: string, group: string, entry: unknown): JsonEdit {
  return {
    path,
    set: (document) => setEntry(document, group, MCP_SERVER_NAME, entry),
    unset: (document) => removeEntry(document, group, MCP_SERVER_NAME),
  };
}

const slash = (name: string) => `/${name}`;

export const AGENT_ADAPTERS: AgentAdapter[] = [
  {
    id: 'claude-code',
    skillsDir: '.claude/skills',
    invocation: slash,
    commandFiles: (prefix) =>
      WORKFLOW_COMMANDS.map((command) => ({
        path: `.claude/commands/${prefix}-${command.id}.md`,
        content: [
          '---',
          `description: ${quote(command.description)}`,
          `argument-hint: ${quote(command.argumentHint)}`,
          'allowed-tools: Bash(solstack spec:*), Bash(solstack standards:*), Bash(solstack intake:*), Bash(solstack context:*)',
          '---',
          '',
          body(command, '$ARGUMENTS'),
        ].join('\n'),
      })),
    jsonEdits: [mcpEntry('.mcp.json', 'mcpServers', { type: 'stdio', ...STDIO_SERVER })],
    markdownBlocks: [{ path: 'CLAUDE.md', body: '@AGENTS.md' }],
  },
  {
    id: 'cursor',
    skillsDir: '.cursor/skills',
    invocation: slash,
    commandFiles: (prefix) =>
      WORKFLOW_COMMANDS.map((command) => ({
        path: `.cursor/commands/${prefix}-${command.id}.md`,
        content: [
          '---',
          `name: ${quote(`/${prefix}-${command.id}`)}`,
          `id: ${quote(`${prefix}-${command.id}`)}`,
          `description: ${quote(command.description)}`,
          '---',
          '',
          body(command, TYPED_INPUT),
        ].join('\n'),
      })),
    jsonEdits: [mcpEntry('.cursor/mcp.json', 'mcpServers', STDIO_SERVER)],
    markdownBlocks: [],
  },
  {
    id: 'copilot-vscode',
    skillsDir: '.github/skills',
    invocation: slash,
    commandFiles: (prefix) =>
      WORKFLOW_COMMANDS.map((command) => ({
        path: `.github/prompts/${prefix}-${command.id}.prompt.md`,
        content: ['---', `description: ${quote(command.description)}`, '---', '', body(command, TYPED_INPUT)].join('\n'),
      })),
    jsonEdits: [mcpEntry('.vscode/mcp.json', 'servers', { type: 'stdio', ...STDIO_SERVER })],
    markdownBlocks: [],
  },
  {
    id: 'codex',
    skillsDir: '.agents/skills',
    // Codex reads repository skills from .agents/skills and invokes them with `$name`.
    invocation: (name) => `$${name}`,
    commandFiles: (prefix) =>
      WORKFLOW_COMMANDS.map((command) => ({
        path: `.agents/skills/${prefix}-${command.id}/SKILL.md`,
        content: [
          '---',
          `name: ${quote(`${prefix}-${command.id}`)}`,
          `description: ${quote(command.description)}`,
          '---',
          '',
          body(command, 'what the developer asked for when invoking this skill (it may be empty).'),
        ].join('\n'),
      })),
    jsonEdits: [],
    markdownBlocks: [],
    manualMcpSetup: 'Codex keeps MCP servers in your user config. `solstack setup` adds it with `codex mcp add`.',
  },
  {
    id: 'devin',
    skillsDir: '.devin/skills',
    invocation: slash,
    commandFiles: (prefix) =>
      WORKFLOW_COMMANDS.map((command) => ({
        path: `.devin/workflows/${prefix}-${command.id}.md`,
        content: [
          '---',
          `name: ${quote(`${prefix}-${command.id}`)}`,
          `description: ${quote(command.description)}`,
          '---',
          '',
          body(command, TYPED_INPUT),
        ].join('\n'),
      })),
    jsonEdits: [],
    markdownBlocks: [],
    manualMcpSetup:
      'Devin Desktop keeps MCP servers in your user settings. Add a server named "solstack" with command `solstack` and argument `mcp`.',
  },
  {
    id: 'gemini-cli',
    skillsDir: '.gemini/skills',
    invocation: slash,
    commandFiles: (prefix) =>
      WORKFLOW_COMMANDS.map((command) => ({
        path: `.gemini/commands/${prefix}-${command.id}.toml`,
        content: `description = ${quote(command.description)}\n\nprompt = """\n${body(command, '{{args}}')}"""\n`,
      })),
    jsonEdits: [
      mcpEntry('.gemini/settings.json', 'mcpServers', STDIO_SERVER),
      {
        // Gemini CLI reads GEMINI.md by default; make it read AGENTS.md as well.
        path: '.gemini/settings.json',
        set: (document) => {
          const context = (document.context as Json | undefined) ?? {};
          const current = context.fileName;
          const names = Array.isArray(current) ? current : typeof current === 'string' ? [current] : ['GEMINI.md'];
          return { ...document, context: { ...context, fileName: [...new Set(['AGENTS.md', ...names])] } };
        },
        unset: (document) => document,
      },
    ],
    markdownBlocks: [],
  },
];

export function adapterFor(id: string): AgentAdapter | undefined {
  return AGENT_ADAPTERS.find((adapter) => adapter.id === id);
}
