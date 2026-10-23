# Send feedback about Solstack

Report a problem with the development harness itself to the team that runs Solstack: a workflow command that misbehaved, a standard or rule that was wrong or was ignored, a confusing instruction, a tool that failed. **Not for bugs in the product being built.** Those go to the project's own tracker.

## Input

The text after the command describes the problem. It may be empty: then work out what went wrong from this conversation, or ask.

## Steps

1. **Pin down what happened.** From the conversation and the developer's description, work out:
   - what was expected, and what happened instead;
   - where it came from: which command (`propose`, `apply`, `verify`, `sync`, `archive`), which standard, intake rule or product context document (its ID, from `solstack standards`, `solstack intake` or `solstack context`), or which tool;
   - the exact output or text that shows the problem, quoted verbatim but trimmed to the relevant lines;
   - the OpenSpec change it happened in, if any.

   Ask only for what you cannot find yourself.

2. **Pick the category:** `command`, `standard`, `intake`, `context`, `tool` or `other`.

3. **Draft the report and show it to the developer:** a one-line summary, then the details (expected, actual, the quoted output, and a suggested fix if there is an obvious one). Leave out secrets, tokens, credentials and customer data. Ask the developer to confirm or edit it.

4. **Send it** only after they confirm, with the `solstack_feedback` tool of the `solstack` MCP server: `category`, `summary`, `details`, and `command`, `guidance` (the document ID) and `change` when they apply. If the tool is not available, say so: the developer may need to run `solstack login`, then restart the agent.

## Finish

Say that it was sent and what it will be reported as. Then carry on with what the developer was doing before.
