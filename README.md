# Solstack client

The `solstack` command connects your coding agents (Claude Code, Codex, Cursor, Copilot, Devin Desktop, Gemini CLI) to your team's Solstack server. It gives every repository the same spec-driven workflow (`/ss-propose`, `/ss-apply`, `/ss-verify`, `/ss-archive`), the team's standards as skills, and the GitHub, Trello, Jira and Linear tools.

**Guides:** [Set up a repository](docs/setup-repository.md) (once per repository) · [Developer guide](docs/developer-guide.md) (day to day)

## Install (each developer, once per computer)

You need Node.js 20.19 or newer.

```bash
npm install -g solstack
```

Then sign in. Create a token in Solstack under **Agent access**, and paste it when asked:

```bash
solstack login --server https://solstack.your-company.com
```

## Use it in a repository

In a repository that is already set up (it has a `.solstack/` folder):

```bash
solstack setup
```

This connects the integrations the repository needs (your browser opens for each one) and registers the MCP server where an agent needs it. Restart your agent afterwards. In Claude Code, approve the `solstack` MCP server when asked.

Then, in your agent:

| Command | What it does |
|---|---|
| `/ss-propose <idea, issue or card>` | Plans the change. Writes specs and tasks, no code |
| `/ss-apply` | Implements the plan, task by task |
| `/ss-verify` | Checks the change is really done: tasks, specs covered by tests, scope, standards |
| `/ss-archive` | Merges the specs and closes the change |
| `/ss-sync` | Merges a change's specs early, without closing it |
| `/ss-feedback <what went wrong>` | Reports a problem with the workflow itself to your Solstack admins |

In Codex they are skills: `$ss-propose`, `$ss-apply`, and so on.

## Set up a new repository (once, by whoever owns it)

An admin adds the repository in Solstack (**Administration → Repositories**) and copies its key. Then, in the repository:

```bash
solstack init --key <repository key>
```

Commit the files it creates. When the admin changes the repository's agents or standards, run `solstack update` and commit again. The [repository setup guide](docs/setup-repository.md) has the details.

## Other commands

| Command | What it does |
|---|---|
| `solstack status` | What is set up and what is missing |
| `solstack connect [github\|trello\|jira\|linear]` | Connects or reconnects an integration |
| `solstack standards`, `solstack intake`, `solstack context` | Lists the team's guidance installed in the repository |
| `solstack spec <args>` | Runs the bundled OpenSpec on `.solstack/openspec` |

To update the client: `npm install -g solstack@latest`.
