# Apply a change

Implement an approved OpenSpec change by working through its task list.

## How this repository is set up

- Specs and changes live in `.solstack/openspec/`. The code lives in the rest of the repository.
- Run OpenSpec through `solstack spec <arguments>`, never `openspec` directly. When OpenSpec's output suggests `openspec <something>`, run `solstack spec <something>` instead.
- OpenSpec reports `allowedEditRoots` as `.solstack` because that is where its files are. That limit applies to planning files only. Implement the code where it belongs in the repository.
- The `solstack` MCP server gives you GitHub and Trello tools that act as the developer. Ask before posting comments or changing issues or cards.
- The team's engineering standards are installed as skills. `solstack standards` lists them, with what each one covers and the file to read.

## Input

The text after the command is the change name. If it is missing, run `solstack spec list --json`. If there is exactly one active change, use it and say so. Otherwise ask which one.

## Steps

1. **Load the change.** Run `solstack spec instructions apply --change "<name>" --json`.
   - If `state` is `blocked`, the plan is incomplete. Report what is missing and suggest running the propose command for this change. Do not fill in the plan yourself here.
   - Otherwise read every file in `contextFiles`: the proposal, the spec deltas, the design and the tasks. Re-read them from disk, because the developer may have edited them.
   - Run `solstack standards`. Read the standards the design lists, and any other whose description covers code this change touches.

2. **Work through the tasks in order.** For each task:
   - Check which standards cover the files the task touches, and follow them: structure, naming, error handling, logging and tests. If you have not read one of them yet, read it now.
   - Make the smallest change that completes it, following the design, the standards and the conventions of the surrounding code. If the plan and a standard disagree, stop and ask rather than choosing silently.
   - Add or update tests for the behavior the spec deltas describe, and run them.
   - Mark the task done in `tasks.md` (`- [ ]` becomes `- [x]`) as soon as it is complete, not at the end.

3. **Stay inside the plan.** If a task turns out to be wrong, or the work needs something the plan does not cover, stop and explain it. Suggest updating the change's artifacts before you continue. Do not quietly widen the scope.

4. **Check the result.** When all tasks are done, review your changes against the standards you used and fix any deviation. Then run the project's tests and linters, and `solstack spec validate "<name>" --strict`.

## Finish

Report which tasks you completed, the test results, the standards you followed, any deviation from them and why, and anything left open. If everything is done, end with: "All tasks are complete. Review the changes, then run the archive command."
