import type { PluginTheme } from "@getpaseo/plugin";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import type { IssueStatus, Priority } from "../shared/lific";
import { type ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

/** Shared height so buttons and icon buttons line up in a row. */
export const CONTROL_HEIGHT = 34;

interface ButtonProps {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  busy?: boolean;
  /** Defaults to `flex-start` so buttons keep their width inside column layouts. */
  alignSelf?: "flex-start" | "center";
}

export function Button({ theme, label, onPress, variant = "secondary", disabled, busy, alignSelf = "flex-start" }: ButtonProps) {
  const primary = variant === "primary";
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        minHeight: CONTROL_HEIGHT,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: primary ? 0 : 1,
        borderColor: theme.colors.border,
        backgroundColor: primary ? theme.colors.accent : theme.colors.surface1,
        opacity: inactive ? 0.5 : 1,
        alignSelf,
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={primary ? theme.colors.accentForeground : theme.colors.foreground} />
      ) : null}
      <Text style={{ color: primary ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Chip({
  theme,
  label,
  selected,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  selected: boolean;
  onPress?(): void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityState={{ selected }}
      disabled={!onPress}
      onPress={onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.accent : "transparent",
      }}
    >
      <Text style={{ fontSize: 12, color: selected ? theme.colors.accentForeground : theme.colors.foregroundMuted }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Section({ theme, title, children }: { theme: PluginTheme; title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontWeight: "600", textTransform: "uppercase" }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Message({
  theme,
  children,
  tone = "muted",
}: {
  theme: PluginTheme;
  children: ReactNode;
  tone?: "muted" | "danger";
}) {
  return (
    <Text
      accessibilityRole={tone === "danger" ? "alert" : undefined}
      style={{ color: tone === "danger" ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 13 }}
    >
      {children}
    </Text>
  );
}

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function priorityColor(theme: PluginTheme, priority: Priority): string {
  switch (priority) {
    case "urgent":
      return theme.colors.statusDanger;
    case "high":
      return theme.colors.statusWarning;
    case "medium":
      return theme.colors.accent;
    case "low":
    case "none":
      return theme.colors.border;
  }
}

export function statusColor(theme: PluginTheme, status: IssueStatus): string {
  switch (status) {
    case "active":
      return theme.colors.accent;
    case "done":
      return theme.colors.statusSuccess;
    case "cancelled":
      return theme.colors.statusDanger;
    case "todo":
      return theme.colors.foregroundMuted;
    case "backlog":
      return theme.colors.border;
  }
}

export function Card({ theme, children, onPress, label }: { theme: PluginTheme; children: ReactNode; onPress?(): void; label?: string }) {
  const style = {
    gap: 6,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  };
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [style, pressed ? { backgroundColor: theme.colors.surface2 } : null]}>
      {children}
    </Pressable>
  );
}

/** `openScreen` from the client entry. Screen props carry no navigation to other plugin screens. */
export type OpenScreen = (input: { screenId: string; params?: Record<string, string> }) => void;

/** Scrolling page with a title and one-line description, shared by the plugin's screens. */
export function ScreenScaffold({
  theme,
  compact,
  title,
  description,
  children,
}: {
  theme: PluginTheme;
  compact: boolean;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: compact ? 16 : 24, gap: 20, maxWidth: 760 }}
    >
      <View style={{ gap: 2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 22, fontWeight: "700" }}>{title}</Text>
        <Text style={{ color: theme.colors.foregroundMuted }}>{description}</Text>
      </View>
      {children}
    </ScrollView>
  );
}

export function TextField({
  theme,
  value,
  onChangeText,
  placeholder,
  multiline,
  autoCapitalize = "none",
}: {
  theme: PluginTheme;
  value: string;
  onChangeText(text: string): void;
  placeholder: string;
  multiline?: boolean;
  autoCapitalize?: "none" | "characters";
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.foregroundMuted}
      autoCapitalize={autoCapitalize}
      multiline={multiline}
      style={{
        color: theme.colors.foreground,
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
        backgroundColor: theme.colors.surface1,
        ...(multiline ? { minHeight: 64, textAlignVertical: "top" as const } : {}),
      }}
    />
  );
}

/** One choice in a vertical list: an identifier column, a title, and optional trailing text. */
export function SelectableRow({
  theme,
  selected,
  onPress,
  identifier,
  title,
  trailing,
  identifierWidth = 64,
}: {
  theme: PluginTheme;
  selected: boolean;
  onPress(): void;
  identifier: string;
  title: string;
  trailing?: string;
  identifierWidth?: number;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        backgroundColor: selected ? theme.colors.surface2 : "transparent",
      }}
    >
      <Text
        numberOfLines={1}
        style={{ color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"], minWidth: identifierWidth, flexShrink: 0 }}
      >
        {identifier}
      </Text>
      <Text style={{ color: theme.colors.foreground, flex: 1 }} numberOfLines={2}>
        {title}
      </Text>
      {trailing ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{trailing}</Text> : null}
    </Pressable>
  );
}
