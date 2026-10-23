# Set up a repository for Solstack

Do this **once per repository**. Usually the tech lead does it; developers then only run `solstack setup`.

Before you start: the Solstack server is running, you can sign in to it as an admin (or an admin does step 1 for you), and you have [installed the client](../README.md#install-each-developer-once-per-computer).

## 1. Register the repository (in Solstack)

**Administration → Repositories → Add repository**

- **Name**: e.g. `acme/web`.
- **Supported agents**: the agents your team uses (Claude Code, Codex, Cursor, Copilot, Devin Desktop, Gemini CLI).
- **Required integrations**: the trackers developers must connect for this repository (GitHub, Jira, Linear, Trello).

Copy the **API key** it shows. It is shown once; if you lose it, use **Rotate key**.

Optional, any time: under **Standards**, **Intake** and **Product context**, choose whether each document applies to all repositories or to selected ones, such as this one.

## 2. Initialize the repository

In the repository's root folder:

```bash
solstack init --key <repository key>
```

Add `--server https://your-solstack-server` if that server is not your default sign-in. Add `--prefix acme` to name the commands `/acme-propose` and so on instead of `/ss-propose`.

## 3. Review and commit

`init` prints every file it writes:

| What | Where |
|---|---|
| Specs and changes (OpenSpec) | `.solstack/openspec/` |
| The workflow commands' instructions | `.solstack/commands/` |
| A short Solstack section | `AGENTS.md` (and `CLAUDE.md` for Claude Code) |
| Commands for each agent | `.claude/commands/`, `.cursor/commands/`, `.github/prompts/`, `.agents/skills/`, … |
| Standards, intake rules and product context, as skills | each agent's `skills/` folder |
| The MCP server entry | `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.gemini/settings.json` |

Your existing `AGENTS.md`, `CLAUDE.md` and MCP servers are kept; Solstack only adds its own parts. Commit everything:

```bash
git add -A && git commit -m "Set up Solstack"
```

## 4. Tell the developers

Each developer, once:

```bash
npm install -g solstack
solstack login --server https://your-solstack-server
```

Then, in this repository: `solstack setup`. The [developer guide](developer-guide.md) covers the rest.

## Keeping it up to date

When an admin changes the repository's agents, standards, intake rules or product context:

```bash
solstack update
git add -A && git commit -m "Update Solstack"
```

`solstack status` tells you when the repository is behind the server. Files of an agent that was removed are deleted by `update`.

| To… | Run |
|---|---|
| Move the repository to another Solstack server | `solstack init --key <new key> --server <url> --force` |
| Use a different command prefix | `solstack init --key <key> --prefix <prefix>` again |
