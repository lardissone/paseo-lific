import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createHomeScreen } from "./client/home-screen";
import { IssuePanel } from "./client/issue-panel";
import { MentionsRow } from "./client/mentions-row";
import { NoteCard } from "./client/note-card";
import { createPlanScreen } from "./client/plan-screen";
import { createRunPlanScreen } from "./client/run-plan-screen";
import { LificSettingsScreen } from "./client/settings-screen";
import { LificSidebarItem } from "./client/sidebar-item";
import { StartWorkScreen } from "./client/start-work-screen";
import { MENTIONS_KIND, MENTIONS_VERSION, MentionsSchema } from "./shared/mentions";
import { NOTE_KIND, NOTE_VERSION, NoteSchema } from "./shared/note";
import { lificAttachments, runSlashCommand, type SlashCommand } from "./shared/rpc";

const SLASH_COMMANDS: { name: SlashCommand; description: string; argumentHint: string }[] = [
  { name: "issue", description: "Link this workspace to a Lific issue", argumentHint: "MIO-23" },
  { name: "file", description: "File a Lific issue in this project's backlog", argumentHint: "<title>" },
  { name: "done", description: "Mark the linked Lific issue done", argumentHint: "[summary comment]" },
  { name: "block", description: "Put the linked Lific issue on a person", argumentHint: "<what you are waiting for>" },
  { name: "briefing", description: "Show the Lific project briefing", argumentHint: "[since, e.g. 2026-10-01]" },
];

/** Command Center entries that open one of the plugin's screens. */
const SCREEN_COMMANDS = [
  { id: "home", title: "Lific: Open home", icon: "SquareKanban", keywords: ["queue", "briefing", "issues"], screenId: "home" },
  { id: "start-work", title: "Lific: Start work on an issue", icon: "Play", keywords: ["issue", "worktree"], screenId: "start" },
  { id: "run-plan", title: "Lific: Run a plan", icon: "ListChecks", keywords: ["plan", "steps", "runner"], screenId: "plan" },
];

export default function contribute(client: PluginClientContext) {
  // Screen props cannot open other plugin screens, so these screens receive the entry's openScreen.
  client.addScreen({ id: "home", title: "Lific", Component: createHomeScreen(client.openScreen) });
  client.addScreen({ id: "plan", title: "Run a plan", Component: createRunPlanScreen(client.openScreen) });
  client.addScreen({ id: "start", title: "Start work from Lific", Component: StartWorkScreen });
  client.addScreen({ id: "plan-detail", title: "Lific plan", Component: createPlanScreen(client.openScreen) });
  client.addSidebarHeaderItem({ id: "home", title: "Lific", Component: LificSidebarItem });
  client.addSettingsScreen({ id: "lific", title: "Lific", icon: "SquareKanban", Component: LificSettingsScreen });
  client.addWorkspacePanel({
    id: "issue",
    title: "Lific issue",
    icon: "SquareKanban",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: IssuePanel,
  });
  client.addAttachmentSource(lificAttachments);
  client.addTimelineRenderer({ kind: MENTIONS_KIND, version: MENTIONS_VERSION, schema: MentionsSchema, Component: MentionsRow });
  client.addTimelineRenderer({ kind: NOTE_KIND, version: NOTE_VERSION, schema: NoteSchema, Component: NoteCard });

  for (const command of SLASH_COMMANDS) {
    client.addSlashCommand({
      ...command,
      context: "agent",
      async onSubmit({ args, agent, workspace, rpc }) {
        await rpc(runSlashCommand, {
          command: command.name,
          args,
          agentId: agent.id,
          directory: workspace.directory,
          projectRoot: workspace.projectRootPath,
        });
      },
    });
  }

  for (const { screenId, ...item } of SCREEN_COMMANDS) {
    client.addCommandCenterItem({ ...item, context: "global", onSelect: ({ openScreen }) => openScreen({ screenId }) });
  }
  client.addCommandCenterItem({
    id: "start-work-in-project",
    title: "Lific: Start work on an issue in this project",
    icon: "Play",
    keywords: ["issue", "worktree"],
    context: "workspace",
    onSelect({ openScreen, workspace }) {
      openScreen({ screenId: "start", params: { projectRoot: workspace.projectRootPath } });
    },
  });
  client.addCommandCenterItem({
    id: "show-issue",
    title: "Lific: Show linked issue",
    icon: "SquareKanban",
    context: "workspace",
    onSelect: ({ openPanel }) => openPanel("issue"),
  });
  client.addCommandCenterItem({
    id: "settings",
    title: "Lific: Settings",
    icon: "Settings",
    context: "global",
    onSelect: ({ openSettings }) => openSettings("lific"),
  });
  return () => {};
}
