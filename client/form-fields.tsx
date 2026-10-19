import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import { View } from "react-native";
import { Chip } from "./kit";
import type { GitProject, ProviderOption } from "./paseo-data";

export function ProjectPicker({
  theme,
  projects,
  value,
  onChange,
}: {
  theme: PluginTheme;
  projects: readonly GitProject[];
  value: string | null;
  onChange(root: string): void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {projects.map((project) => (
        <Chip
          key={project.root}
          theme={theme}
          label={project.name}
          selected={project.root === value}
          onPress={() => onChange(project.root)}
        />
      ))}
    </View>
  );
}

export function BaseBranchSelect({
  label = "Base branch",
  branches,
  value,
  onChange,
}: {
  label?: string;
  branches: readonly string[];
  value: string | null;
  onChange(branch: string): void;
}) {
  return (
    <SettingsSelect
      label={label}
      value={value ?? ""}
      options={branches.map((name) => ({ label: name, value: name }))}
      onValueChange={onChange}
    />
  );
}

export function AgentSelect({
  options,
  value,
  onChange,
}: {
  options: readonly ProviderOption[];
  value: string | null;
  onChange(provider: string): void;
}) {
  return (
    <SettingsSelect
      label="Agent"
      value={value ?? ""}
      options={options.map(({ label, value: option }) => ({ label, value: option }))}
      onValueChange={onChange}
    />
  );
}
