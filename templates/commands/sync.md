# Sync a change's specs

Merge an OpenSpec change's spec deltas into the main specs, **without archiving the change**. Use it when other work needs the updated specs before this change is finished. Archiving later does the same merge again, which is safe.

## How this repository is set up

- Specs and changes live in `.solstack/openspec/`. Run OpenSpec through `solstack spec <arguments>`, never `openspec` directly.
- Main specs are in `.solstack/openspec/specs/<capability>/spec.md`. Edit only those, and only as the deltas say.

## Input

The text after the command is the change name. If it is missing, run `solstack spec list --json`. If exactly one active change has spec deltas, use it and say so. Otherwise ask which one.

## Steps

1. **Find the deltas.** Run `solstack spec status --change "<name>" --json`. The delta files are listed in `artifactPaths.specs.existingOutputPaths`. If that list is empty, say there is nothing to sync and stop.

2. **Get the spec rules.** Run `solstack spec instructions specs --change "<name>" --json` once. Treat its `rules` (if any) as constraints on how the main specs are written. If the command fails, stop before editing anything.

3. **Merge each delta** into the main spec of the same capability path. Read both from disk first.
   - **ADDED**: add the requirement. If it already exists, update it to match.
   - **MODIFIED**: find the requirement and apply the change (new or edited scenarios, new wording). Keep everything the delta does not mention.
   - **REMOVED**: remove the whole requirement. Never leave a spec with no requirements: if that would happen, stop for that capability and tell the developer.
   - **RENAMED**: rename the requirement from `FROM` to `TO`.
   - A `## Purpose` in the delta does not replace an existing one.
   - If the main spec does not exist yet, create it only from ADDED requirements, with the delta's Purpose (or a short placeholder to fill in). If the delta has MODIFIED or RENAMED requirements for a spec that does not exist, stop for that capability and report it.

4. **Validate.** Run `solstack spec validate --specs`. If it fails, report the problems; do not say the sync succeeded.

## Finish

List each capability you updated and what changed in it (added, modified, removed, renamed), any new spec whose Purpose still needs writing, and anything you stopped on. Remind the developer that the change stays open: keep working on it, then verify and archive it.
