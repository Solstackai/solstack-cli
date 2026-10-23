# Working with Solstack

Solstack gives your coding agent one way of working in every repository: **plan the change, review the plan, then build it**. Your team's standards, rules and product knowledge come along automatically.

## Once per computer

```bash
npm install -g solstack
solstack login --server https://your-solstack-server
```

Then, in each repository you work on (it has a `.solstack/` folder):

```bash
solstack setup
```

It connects the trackers the repository needs (your browser opens for each), then registers the agents. Restart your agent afterwards. Claude Code asks once to approve the `solstack` MCP server: approve it.

## The workflow

```
/ss-propose  →  you review the plan  →  /ss-apply  →  /ss-verify  →  /ss-archive
```

| Step | What the agent does | What you do |
|---|---|---|
| `/ss-propose <what>` | Reads the code and writes a plan: proposal, spec changes, design, task list. **No code yet.** | Read the plan in `.solstack/openspec/changes/<name>/` and edit anything you disagree with. |
| `/ss-apply` | Implements the tasks one by one, with tests, ticking them off in `tasks.md`. | Answer its questions; it stops if the plan turns out to be wrong. |
| `/ss-verify` | Checks the result: all tasks done, every spec scenario implemented and tested, nothing outside the plan, tests pass, standards followed. Reports only. | Decide what to fix. Ask it to fix things, then verify again. |
| `/ss-archive` | Merges the spec changes into the main specs and closes the change. Offers to update the issue or card. | Commit `.solstack/openspec/` together with the code. |

`<what>` can be plain text or a link to the work item:

```
/ss-propose add CSV export to the reports page
/ss-propose https://github.com/acme/web/issues/88
/ss-propose ENG-142
```

In Codex the commands are skills: `$ss-propose`, `$ss-apply`, and so on.

## Also useful

- **`/ss-sync`**: merges a change's specs into the main specs early, when other work needs them before this change is done.
- **`/ss-feedback <what went wrong>`**: when the *workflow itself* misbehaves (a command did something odd, a standard was wrong or ignored), this sends a report to the Solstack admins. Not for bugs in your product.
- **Trackers**: your agent can read and create issues, cards and comments in GitHub, Jira, Linear and Trello, as you. It asks before posting, and follows the team's intake rules for tasks, comments and pull requests.
- **What the team expects**: `solstack standards`, `solstack intake` and `solstack context` list the engineering standards, writing rules and product documents your agent follows.

## When something is off

| Symptom | Fix |
|---|---|
| The agent says GitHub (or Jira, …) is not connected | `solstack connect` |
| The `/ss-…` commands or Solstack tools are missing | `git pull`, then restart the agent. `solstack status` shows what is missing |
| "The server rejected your access token" | `solstack login`, then restart the agent |
| Anything else | `solstack status` |
