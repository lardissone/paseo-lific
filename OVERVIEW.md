Connects [Lific](https://github.com/VoidNullable/lific), a local-first issue tracker, to Paseo. Start agent work from an issue, keep the issue in view while the agent works, and run a Lific plan step by step with one agent per step.

## What you can do

- **Start work from an issue.** Pick a project and an issue, then choose the base branch, the new branch name, and the agent. Paseo creates a worktree on that branch, sets the issue to active with one comment saying where work started, and starts the agent.
- **Give agents the issue as context.** Agents created in a linked workspace get the issue title, status, blockers, description, and last three comments in their instructions, and are asked to close the issue with a summary when they finish.
- **Follow the issue from the workspace.** The Lific issue panel shows the linked issue, its description, and recent comments. Change its status, comment, open it in Lific, or link a different issue.
- **See your work at a glance.** The Lific item in the sidebar opens a home with plan runs, issues agents are working on, issues waiting on a person, workable issues ready to start, and a project briefing of what changed since you last looked. A badge on the sidebar item counts issues waiting on you and paused plan runs.
- **Run a plan.** Pick a Lific plan and Paseo works through its steps in order, one worktree and agent per step. Steps without an issue get one. Choose whether the run pauses after each step for your review or runs straight through, and whether each step branches off the previous step's branch or off a base branch. With stacked branches you can archive each finished step's workspace when the next one starts, since its commits are already on the new branch. Agents commit on their branch and close the step's issue. They do not open pull requests unless you ask.
- **Attach Lific content to a prompt.** The attachment menu searches issues and pages, and accepts IDs such as `MIO-23`, `MIO-DOC-4`, or `MIO-PLAN-2`.
- **Use slash commands in an agent's composer:** `/issue MIO-23` links the workspace, `/file <title>` files an issue in the project's backlog, `/done [summary]` closes the linked issue, `/block <reason>` puts it on a person, and `/briefing [since]` shows the project briefing. Each command reports its result as a card in the timeline.
- **See issue chips.** When an agent mentions issues in a reply, a row of chips with each issue's status and title follows it.

## Lifecycle updates

The plugin writes to Lific only when a state change is worth a person's attention:

- When an agent asks you a question, the question is commented on the issue and the issue is put on a person until every question is answered.
- When agent turns start failing, one comment with the error. A plan run with that step pauses.
- When a workspace is archived while its issue is still active, the issue moves back to todo with a comment. A plan run with that step pauses, and Continue restarts the step.

## Setup

- Lific 2.11 or newer, and git on the daemon host.
- In Lific, create a bot for a tool named `paseo` and copy its API key. Everything the plugin writes is attributed to that bot.
- In Paseo, open Settings, then Plugins, then Lific, and enter your Lific URL and the API key.
- Run `lific bind` in each repository, or pick the repository's Lific project in the plugin settings.
- Agents use their own Lific MCP connection, which you set up with `lific connect`. The plugin does not configure MCP. An agent without it still gets the issue as context but cannot update Lific itself.

## Data, storage, and limits

- The plugin calls your Lific server's REST API from the daemon host. The project briefing uses Lific's MCP endpoint with the same key.
- Issue titles, descriptions, and comments are added to agent instructions, so they are sent to the agent's model provider like the rest of the prompt. The issue text is marked as data, not instructions, but treat issues from people you do not trust with the same care as any prompt.
- The API key is stored in the plugin settings on the daemon host as plain JSON and is visible to every client connected to that host. Use HTTPS unless Lific runs on the same machine.
- Links between workspaces and issues, and plan run state, are stored in each repository's local git config under `branch.<name>.lific*` and `lific-run.<plan>`. Git never pushes this config, so Lific identifiers stay out of the shared repository. Branch names default to the issue title, and with the private tracker setting on, agents are asked not to mention Lific identifiers or links in commits and pull requests.
- Plan runs advance every 30 seconds and when an agent's turn ends. After a daemon restart, they resume once a Paseo app connects to the host or any agent turn ends.
- Start work always creates a worktree. It never switches the branch of your main checkout.
