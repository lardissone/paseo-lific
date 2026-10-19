import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { IssuePanel } from "./client/issue-panel";
import { LificSettingsScreen } from "./client/settings-screen";
import { StartWorkScreen } from "./client/start-work-screen";

function LificSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="SquareKanban"
      active={currentScreen?.screenId === "start"}
      onPress={() => openScreen({ screenId: "start" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "start", title: "Start work from Lific", Component: StartWorkScreen });
  client.addSidebarHeaderItem({ id: "start", title: "Lific", Component: LificSidebarItem });
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
