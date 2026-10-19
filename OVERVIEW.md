Lific is a local-first issue tracker. This plugin lets you start agent work from a Lific issue and keeps the issue visible while the agent runs.

## What it does

- **Start work from an issue.** Pick a project and an issue (workable issues are listed first), choose the base branch, the new branch name, and the agent. The plugin creates a worktree workspace, sets the issue to active, leaves one comment saying where the work started, and starts the agent.
- **Issue context for agents.** Every agent created in a linked workspace gets the issue title, description, labels, blockers, and the last three comments in its system prompt, plus instructions to close the issue with a summary when done.
- **Issue panel.** A workspace panel shows the linked issue, its status, description, and recent comments. You can change the status, comment, open it in Lific, link a different issue, or unlink it.

## How linking works

The link between a workspace and an issue is stored in the repository's local git config (`branch.<name>.lificIssue`). It is shared by every worktree of the repository, follows branch renames, and is never pushed. Branch names default to the issue title only, so Lific identifiers stay out of the shared repository. With the private tracker setting on, agents are also told not to mention Lific identifiers or links in commits and pull requests.

## Setup

- Lific 2.11 or newer.
- In Lific, create a bot for a tool named `paseo` and copy its API key. Plugin actions are attributed to that bot. Agents keep using their own Lific MCP connection; the plugin does not configure MCP.
- In Paseo, open Settings, then Plugins, then Lific, and enter the Lific URL and the API key.
- Bind each repository with `lific bind`, or pick its Lific project in the plugin settings.

## Data and limits

The plugin calls your Lific server's REST API from the daemon host. The API key is stored in the plugin settings on that host as plain JSON and is readable by clients connected to it. Start work always creates a worktree; it does not switch branches in your main checkout.
