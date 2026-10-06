# Archive a change

Finish an implemented OpenSpec change: merge its spec deltas into the main specs and move it to the archive.

## How this repository is set up

- Specs and changes live in `.solstack/openspec/`. Run OpenSpec through `solstack spec <arguments>`, never `openspec` directly.
- The `solstack` MCP server gives you GitHub and Trello tools that act as the developer. Ask before posting anything.
- The team's engineering standards are installed as skills. `solstack standards` lists them, with what each one covers and the file to read.

## Input

The text after the command is the change name. If it is missing, run `solstack spec list --json`. If exactly one change has all its tasks complete, propose that one and confirm with the developer. Otherwise ask which one.

## Steps

1. **Check it is finished.** Run `solstack spec instructions apply --change "<name>" --json`. If any task is still open, list the open tasks and ask whether to archive anyway. Do not archive unfinished work without a clear yes.

2. **Check the standards.** Run `solstack standards`. Read the standards the design lists, and any other that covers the changed code (`git diff` against the base branch shows what changed). Check the change against them. If anything deviates, list it and ask whether to fix it first or archive with the deviation recorded in the proposal. Do not archive a known deviation without a clear answer.

3. **Validate.** Run `solstack spec validate "<name>" --strict`. Fix any problems in the change's artifacts first.

4. **Archive.** Run `solstack spec archive "<name>" --yes`. This updates `.solstack/openspec/specs/` and moves the change to `.solstack/openspec/changes/archive/`. If the change touches no specs (pure tooling or documentation), add `--skip-specs`, and tell the developer that you did.

5. **Report back to the tracker, if there is one.** If the proposal links a GitHub issue or a Trello card, offer to post a short summary of what shipped, or to move the card. Do it only if the developer agrees.

## Finish

Report where the change was archived, which specs changed, and any deviation from the standards that was accepted. Remind the developer to commit the updated `.solstack/openspec` folder together with the code.
