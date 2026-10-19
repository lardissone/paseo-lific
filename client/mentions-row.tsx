import { openExternalUrl, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Pressable, Text, View } from "react-native";
import type { z } from "zod";
import type { MentionsSchema } from "../shared/mentions";
import { statusColor } from "./kit";

export function MentionsRow({ theme, item }: PluginTimelineItemProps<z.output<typeof MentionsSchema>>) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {item.data.issues.map((issue) => (
        <Pressable
          key={issue.identifier}
          accessibilityRole="link"
          accessibilityLabel={`${issue.identifier}, ${issue.status}: ${issue.title}`}
          onPress={() => void openExternalUrl(issue.url)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            maxWidth: 360,
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: pressed ? theme.colors.surface2 : theme.colors.surface1,
          })}
        >
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor(theme, issue.status) }} />
          <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: "600", flexShrink: 0 }}>
            {issue.identifier}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, flexShrink: 1 }} numberOfLines={1}>
            {issue.title}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
