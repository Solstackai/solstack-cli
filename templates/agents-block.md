## Spec-driven development (Solstack)

This repository plans its changes with OpenSpec before writing code. The specs and changes are in `.solstack/openspec/`.

- Start new work with `/{{prefix}}-propose`, implement it with `/{{prefix}}-apply`, and finish with `/{{prefix}}-archive`. The full instructions for each command are in `.solstack/commands/`.
- Run OpenSpec as `solstack spec <arguments>`, not `openspec`.
- Read `.solstack/openspec/specs/` to learn how the system is expected to behave before changing it.
- The team's engineering standards are installed as skills. Run `solstack standards` to see them, and follow the ones that cover the code you change, also outside the commands above.
- Before writing anything that is not code (opening a task, commenting, a pull request, a commit message), run `solstack intake` and follow the rule that covers it.
- `solstack context` lists what the business and product are about. Read what covers the area you work on before planning or naming things.
- The `solstack` MCP server provides GitHub and Trello tools that act as the developer. If one reports that an integration is not connected, show the developer the link it returns. Ask before posting comments or changing issues or cards.
