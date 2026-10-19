import { type PluginSidebarItemProps, useRpc } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { getAttention } from "../shared/rpc";

const REFRESH_MS = 60_000;

/** The Lific sidebar row, with a badge counting what waits on you. */
export function LificSidebarItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const fetchAttention = useRpc(getAttention);
  const attention = useQuery({
    queryKey: ["attention"],
    queryFn: () => fetchAttention({}),
    refetchInterval: REFRESH_MS,
  });
  const issues = attention.data?.issues ?? 0;
  const pausedRuns = attention.data?.pausedRuns ?? 0;
  const total = issues + pausedRuns;

  const description = [
    issues > 0 ? `${issues} ${issues === 1 ? "issue needs" : "issues need"} you` : null,
    pausedRuns > 0 ? `${pausedRuns} ${pausedRuns === 1 ? "plan is" : "plans are"} paused` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <SidebarRow
      icon="SquareKanban"
      active={currentScreen !== null}
      onPress={() => openScreen({ screenId: "home" })}
      trailing={
        total > 0 ? (
          <View
            accessible
            accessibilityLabel={description}
            style={{
              minWidth: 18,
              height: 18,
              paddingHorizontal: 5,
              borderRadius: 9,
              alignItems: "center",
              justifyContent: "center",
              // A paused plan blocks agents, so it takes the stronger color.
              backgroundColor: pausedRuns > 0 ? theme.colors.statusWarning : theme.colors.accent,
            }}
          >
            <Text style={{ color: theme.colors.accentForeground, fontSize: 11, fontWeight: "700" }}>
              {total > 99 ? "99+" : total}
            </Text>
          </View>
        ) : undefined
      }
    />
  );
}
