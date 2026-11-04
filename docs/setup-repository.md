# Set up a repository for Solstack

Do this **once per repository**. Usually the tech lead does it; developers then only run `solstack setup`.

Before you start: the Solstack server is running, you can sign in to it as an admin (or an admin does step 1 for you), and you have [installed the client](../README.md#install-each-developer-once-per-computer).

## 1. Register the repository (in Solstack)

**Administration → Repositories → Add repository**

- **Name**: e.g. `acme/web`.
- **Supported agents**: the agents your team uses (Claude Code, Codex, Cursor, Copilot, Antigravity, Devin Desktop, Gemini CLI). Gemini CLI only works with enterprise or API-key accounts now; for personal Google accounts choose Antigravity.
- **Required integrations**: the trackers developers must connect for this repository (GitHub, Jira, Linear, Trello). Agents working in it see only these trackers' tools. Leave it empty to show them all.

Copy the **API key** it shows. It is shown once; if you lose it, use **Rotate key**.

Optional, any time: under **Standards**, **Intake** and **Product context**, choose whether each document applies to all repositories or to selected ones, such as this one. A repository can have its own intake rule for a section, and its own standard that replaces a general one. To see the result, select **What agents receive** next to the repository.

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
| Commands for each agent | `.claude/commands/`, `.cursor/commands/`, `.github/prompts/`, `.agents/skills/` (Codex), `.agents/workflows/` (Antigravity), … |
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

## Optional: checks

Nothing here is required. Without it, Solstack gives agents your rules and checks nothing.

An admin turns checks on under **Intake**, in a rule's **Checks** panel, as **Warn** or **Block**. Checks on tasks, comments and pull requests apply straight away to anything written through Solstack's tools. To cover commits, and pull requests made any other way, run `solstack update`, commit `.solstack/checks.json`, and choose either or both of these:

| Option | Covers | Can be skipped? |
|---|---|---|
| `solstack hooks install`, by each developer who wants it | Commit messages and branch names, in that clone | Yes, with `--no-verify` |
| `solstack ci init`, once for the repository | Every commit, the pull request's title and description, and its branch | Only by changing the workflow or `.solstack/checks.json` in the pull request, so have someone review changes to them |

`solstack ci init` writes a GitHub Actions workflow. Commit it, and it runs on the pull requests that follow. To also require an OpenSpec change on pull requests, add `--openspec warn` or `--openspec block`. Pull requests that only change Solstack's own files don't need one, and `[no-spec]` in a title skips that check for changes such as a typo fix.

**Stopping a merge is a separate step.** A failed check shows on the pull request, but it can still be merged until you make `solstack-check` a required status check in your branch protection settings. GitHub [offers those](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) on public repositories on Free, and on private ones from Pro or Team upward. Everything else here works on any plan.

The workflow is pinned to the Solstack version that wrote it. Run `solstack ci init` again to update it, or `solstack ci remove` to delete it.

| To… | Run |
|---|---|
| Move the repository to another Solstack server | `solstack init --key <new key> --server <url> --force` |
| Use a different command prefix | `solstack init --key <key> --prefix <prefix>` again |
