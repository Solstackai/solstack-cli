# Verify a change

Check that an implemented OpenSpec change is really done, before it is archived. **This workflow reports; it does not fix.** Change code only if the developer asks you to after seeing the report.

## How this repository is set up

- Specs and changes live in `.solstack/openspec/`. Run OpenSpec through `solstack spec <arguments>`, never `openspec` directly.
- The team's engineering standards are installed as skills. `solstack standards` lists them, with what each one covers and the file to read.

## Input

The text after the command is the change name. If it is missing, run `solstack spec list --json`. If there is exactly one active change, use it and say so. Otherwise ask which one.

## Checks

Run `solstack spec instructions apply --change "<name>" --json` and read every file in `contextFiles`: the proposal, the spec deltas, the design and the tasks. Then check, in this order:

1. **Tasks.** Every task in `tasks.md` is checked off. List any that are not.
2. **Requirements.** For each requirement and each scenario in the change's spec deltas, find the code that implements it and a test that exercises it. List every scenario without an implementation or without a test, with the file you would expect it in.
3. **Scope.** Compare what changed (`git diff` against the base branch, plus uncommitted changes) with the tasks and the design. List changes the plan does not explain.
4. **Tests.** Run the project's tests and linters. Report failures with the relevant output.
5. **Standards.** Run `solstack standards`, read the standards the design lists and any other that covers the changed code, and check the changes against them. List each deviation with the file and the rule.
6. **OpenSpec.** Run `solstack spec validate "<name>" --strict`.

## Finish

Report one line per check (passed, or what failed), then the details of every failure. End with one of:

- "Verified. Run the archive command." when nothing failed.
- "Not ready: N issues." followed by what to do about each, when something failed. Ask whether to fix them now.
