import type { PluginTheme } from "@getpaseo/plugin";
import { openExternalUrl } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { type Inline, parseMarkdown } from "../shared/markdown";

const HEADING_SIZES = [18, 16, 15, 14, 14, 14];

interface MarkdownProps {
  theme: PluginTheme;
  source: string;
  /** Render only the first N blocks; the caller owns the "show more" control. */
  maxBlocks?: number;
  color?: string;
}

export function Markdown({ theme, source, maxBlocks, color = theme.colors.foreground }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);
  const visible = maxBlocks === undefined ? blocks : blocks.slice(0, maxBlocks);
  return (
    <View style={{ gap: 6 }}>
      {visible.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <Text
                key={index}
                selectable
                style={{ color, fontWeight: "600", fontSize: HEADING_SIZES[block.level - 1], marginTop: index === 0 ? 0 : 4 }}
              >
                <Inlines theme={theme} inlines={block.inlines} />
              </Text>
            );
          case "item":
            return (
              <View key={index} style={{ flexDirection: "row", gap: 6, paddingLeft: block.depth * 14 }}>
                <Text style={{ color: theme.colors.foregroundMuted }}>{block.marker}</Text>
                <Text selectable style={{ color, flex: 1 }}>
                  <Inlines theme={theme} inlines={block.inlines} />
                </Text>
              </View>
            );
          case "paragraph":
            return (
              <Text key={index} selectable style={{ color }}>
                <Inlines theme={theme} inlines={block.inlines} />
              </Text>
            );
          case "code":
            return (
              <Text
                key={index}
                selectable
                style={{
                  color,
                  fontFamily: "monospace",
                  fontSize: 12,
                  padding: 8,
                  borderRadius: 6,
                  backgroundColor: theme.colors.surface2,
                }}
              >
                {block.text}
              </Text>
            );
          case "rule":
            return <View key={index} style={{ height: 1, backgroundColor: theme.colors.border }} />;
        }
      })}
    </View>
  );
}

export function countMarkdownBlocks(source: string): number {
  return parseMarkdown(source).length;
}

function Inlines({ theme, inlines }: { theme: PluginTheme; inlines: Inline[] }) {
  return inlines.map((inline, index) => {
    switch (inline.type) {
      case "text":
        return inline.text;
      case "bold":
        return (
          <Text key={index} style={{ fontWeight: "600" }}>
            {inline.text}
          </Text>
        );
      case "italic":
        return (
          <Text key={index} style={{ fontStyle: "italic" }}>
            {inline.text}
          </Text>
        );
      case "code":
        return (
          <Text key={index} style={{ fontFamily: "monospace", backgroundColor: theme.colors.surface2 }}>
            {inline.text}
          </Text>
        );
      case "link":
        return (
          <Text
            key={index}
            accessibilityRole="link"
            style={{ color: theme.colors.accent }}
            onPress={() => void openExternalUrl(inline.url)}
          >
            {inline.text}
          </Text>
        );
    }
  });
}
