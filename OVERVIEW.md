Lific is a local-first issue tracker. This plugin lets you start agent work from a Lific issue and keeps the issue visible while the agent runs.

## What it does

- **Start work from an issue.** Pick a project and an issue (workable issues are listed first), choose the base branch, the new branch name, and the agent. The plugin creates a worktree workspace, sets the issue to active, leaves one comment saying where the work started, and starts the agent.
- **Issue context for agents.** Every agent created in a linked workspace gets the issue title, description, labels, blockers, and the last three comments in its system prompt, plus instructions to close the issue with a summary when done.
- **Issue panel.** A workspace panel shows the linked issue, its status, description, and recent comments. You can change the status, comment, open it in Lific, link a different issue, or unlink it.

- **Attach from Lific.** The composer attachment menu searches issues and pages, and accepts IDs like `MIO-23`, `MIO-DOC-4`, or `MIO-PLAN-2`. The selected item is attached as a text snapshot.
- **Slash commands** in an agent's composer. Each one reports its result as a card in the agent's timeline:
  - `/issue MIO-23` links the workspace to an issue.
  - `/file <title>` files an issue in the project's backlog. Lines after the first become the description.
  - `/done [summary]` marks the linked issue done, with an optional comment.
  - `/block <reason>` comments the reason and puts the issue on a person.
  - `/briefing [since]` shows the project briefing.
- **Lifecycle updates** on the linked issue, kept to state changes a person needs to see:
  - When an agent asks you a question, the question is commented on the issue and the issue is put on a person. When every question is answered, the previous assignees come back.
  - When agent turns start failing, one comment with the error. It reports again only after a turn succeeds.
  - When the workspace is archived while the issue is still active, the issue moves back to todo with a comment.

- **Home.** The Lific sidebar item opens a home with plan runs, issues agents are working on, issues waiting on a person, workable issues ready to start, and a project briefing that shows what changed since you last looked. When an agent mentions issues in a reply, a row of issue chips follows it in the timeline.
- **Plan runs.** Pick a Lific plan and Paseo works through its steps in order, one worktree and agent per step. Steps without an issue get one. You choose whether the run pauses after each step for your review or runs straight through, and whether each step branches off the previous step's branch or off a base branch. Agents commit on their branch and close the step's issue; they do not open pull requests unless asked. A failed turn or a cancelled step pauses the run.

## How linking works

The link between a workspace and an issue is stored in the repository's local git config (`branch.<name>.lificIssue`), together with the small amount of state the lifecycle updates need. Plan runs are stored the same way, under `lific-run.<plan>`, so they keep going after a restart. It is shared by every worktree of the repository, follows branch renames, and is never pushed. Branch names default to the issue title only, so Lific identifiers stay out of the shared repository. With the private tracker setting on, agents are also told not to mention Lific identifiers or links in commits and pull requests.

## Setup

- Lific 2.11 or newer.
- In Lific, create a bot for a tool named `paseo` and copy its API key. Plugin actions are attributed to that bot. Agents keep using their own Lific MCP connection; the plugin does not configure MCP.
- In Paseo, open Settings, then Plugins, then Lific, and enter the Lific URL and the API key.
- Bind each repository with `lific bind`, or pick its Lific project in the plugin settings.

## Data and limits

The plugin calls your Lific server's REST API from the daemon host. The API key is stored in the plugin settings on that host as plain JSON and is readable by clients connected to it. Start work always creates a worktree; it does not switch branches in your main checkout.
