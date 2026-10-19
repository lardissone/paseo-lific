import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { IssuePanel } from "./client/issue-panel";
import { LificSettingsScreen } from "./client/settings-screen";
import { StartWorkScreen } from "./client/start-work-screen";
import { createHomeScreen } from "./client/home-screen";
import { MentionsRow } from "./client/mentions-row";
import { NoteCard } from "./client/note-card";
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

function LificSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="SquareKanban"
      active={currentScreen?.screenId === "home" || currentScreen?.screenId === "start"}
      onPress={() => openScreen({ screenId: "home" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "home", title: "Lific", Component: createHomeScreen(client.openScreen) });
  client.addScreen({ id: "start", title: "Start work from Lific", Component: StartWorkScreen });
  client.addSidebarHeaderItem({ id: "home", title: "Lific", Component: LificSidebarItem });
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
  client.addSettingsScreen({ id: "lific", title: "Lific", icon: "SquareKanban", Component: LificSettingsScreen });
  client.addWorkspacePanel({
    id: "issue",
    title: "Lific issue",
    icon: "SquareKanban",
    context: "workspace",
    locations: ["workspace", "explorer"],
    Component: IssuePanel,
  });

  client.addCommandCenterItem({
    id: "start-work",
    title: "Lific: Start work on an issue",
    icon: "Play",
    keywords: ["issue", "worktree"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "start" });
    },
  });
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
    onSelect({ openPanel }) {
      openPanel("issue");
    },
  });
  client.addCommandCenterItem({
    id: "home",
    title: "Lific: Open home",
    icon: "SquareKanban",
    keywords: ["queue", "briefing", "issues"],
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "home" });
    },
  });
  client.addCommandCenterItem({
    id: "settings",
    title: "Lific: Settings",
    icon: "Settings",
    context: "global",
    onSelect({ openSettings }) {
      openSettings("lific");
    },
  });
  return () => {};
}
