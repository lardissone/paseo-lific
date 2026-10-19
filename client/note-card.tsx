import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { z } from "zod";
import type { NoteSchema } from "../shared/note";
import { Markdown } from "./markdown";
import { parseMarkdown } from "./markdown-parser";

const COLLAPSED_BLOCKS = 10;

export function NoteCard({ theme, item }: PluginTimelineItemProps<z.output<typeof NoteSchema>>) {
  const { title, body, url, tone } = item.data;
  const [expanded, setExpanded] = useState(false);
  const accent =
    tone === "success" ? theme.colors.statusSuccess : tone === "warning" ? theme.colors.statusWarning : theme.colors.accent;
  const blocks = useMemo(() => (body ? parseMarkdown(body) : []), [body]);
  const long = blocks.length > COLLAPSED_BLOCKS;

  return (
    <View
      style={{
        gap: 6,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderLeftWidth: 3,
        borderLeftColor: accent,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name="SquareKanban" size={14} color={accent} />
        <Text style={{ color: theme.colors.foreground, fontWeight: "600", flex: 1 }}>{title}</Text>
      </View>
      {body ? (
        <Markdown theme={theme} blocks={blocks} maxBlocks={expanded ? undefined : COLLAPSED_BLOCKS} />
      ) : null}
      <View style={{ flexDirection: "row", gap: 12 }}>
        {long ? (
          <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)}>
            <Text style={{ color: theme.colors.accent, fontSize: 12 }}>{expanded ? "Show less" : "Show more"}</Text>
          </Pressable>
        ) : null}
        {url ? (
          <ExternalLink href={url}>
            <Text style={{ color: theme.colors.accent, fontSize: 12 }}>Open in Lific</Text>
          </ExternalLink>
        ) : null}
      </View>
    </View>
  );
}
