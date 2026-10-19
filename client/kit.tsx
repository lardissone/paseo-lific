import type { PluginTheme } from "@getpaseo/plugin";
import { type ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

interface ButtonProps {
  theme: PluginTheme;
  label: string;
  onPress(): void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  busy?: boolean;
}

export function Button({ theme, label, onPress, variant = "secondary", disabled, busy }: ButtonProps) {
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
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 8,
        borderWidth: primary ? 0 : 1,
        borderColor: theme.colors.border,
        backgroundColor: primary ? theme.colors.accent : theme.colors.surface1,
        opacity: inactive ? 0.5 : 1,
        alignSelf: "flex-start",
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

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
