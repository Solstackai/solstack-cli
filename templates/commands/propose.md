# Propose a change

Turn a request into a reviewed plan: an OpenSpec change with a proposal, spec deltas, a design when needed, and a task list. **This workflow plans only.** Do not edit project code, even if the request asks you to build or fix something. Stop when the plan is ready and wait for the developer to run the apply command.

## How this repository is set up

- Specs and changes live in `.solstack/openspec/`. The code lives in the rest of the repository.
- Run OpenSpec through `solstack spec <arguments>`, never `openspec` directly. `solstack spec` runs the version this repository pins, from the right folder. When OpenSpec's output suggests `openspec <something>`, run `solstack spec <something>` instead.
- The `solstack` MCP server gives you GitHub and Trello tools that act as the developer. If a tool answers that an integration is not connected, show the developer the link it returns and wait. Do not work around it.

## Input

The text after the command is one of:

- a description of what to build or fix
- a GitHub issue (`#123`, `owner/repo#123` or an issue URL): read it with the `github_get_issue` tool, including its comments
- a Trello card (a card URL or ID): read it with the `trello_get_card` tool
- a change name in kebab-case, to continue a change that already exists

If there is no input, ask what the developer wants to build or fix, and wait for the answer.

## Steps

1. **Understand the request.** Read the issue or card if one was given. If something ambiguous would change the scope, the visible behavior, compatibility or what counts as done, ask before going further. For small details, make a reasonable assumption and write it down in the proposal.

2. **Pick a name.** Derive a short kebab-case change name, for example `add-dark-mode`. If the request came from an issue or card, keep a link to it so you can mention it in the proposal. If `solstack spec list --json` already shows a change with that name, ask whether to continue it or start a new one.

3. **Load the project context.** Run `solstack spec context --json`. If `.solstack/openspec/config.yaml` has a `context` field, treat it as constraints on the plan. Do not copy it into any file.

4. **Create the change.** Run `solstack spec new change "<name>"`.

5. **Write each artifact, in dependency order.** Repeat until everything the apply step needs exists:
   - Run `solstack spec status --change "<name>" --json`. It lists the artifacts, what each one `requires`, and `applyRequires`. The set to write is `applyRequires` plus everything those artifacts require, transitively.
   - For the next artifact whose dependencies exist, run `solstack spec instructions <artifact> --change "<name>" --json`. Follow its `instruction`, use its `template` as the structure, and write the file to `resolvedOutputPath`. Treat `context` and `rules` as constraints for you; never copy them into the file.
   - Before writing, re-read the artifacts it depends on from disk, and read the relevant code, tests and configuration (read-only). Ground the scope, approach and tasks in what the code actually does, and say which parts are assumptions.
   - Skip an artifact only when `status` reports it `skipped`, or when its instruction says it is optional (for example, `design.md` for a small change). Tell the developer what you skipped and why.
   - Tasks must be concrete steps. Do not write vague tasks such as "explore the codebase"; do that exploration now.

6. **Validate.** Run `solstack spec validate "<name>" --strict` and fix whatever it reports.

## Finish

Summarize:

- the change name and its folder
- each artifact you wrote, in a line each, plus anything you skipped and why
- the assumptions you made and any open questions

End with: "The plan is ready for review. When it looks right, run the apply command."
