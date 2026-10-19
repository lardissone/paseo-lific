import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Text } from "react-native";
import { checkConnection } from "../shared/rpc";
import { isConfigured, lificSettings } from "../shared/settings";
import { type ReadySettings, useGitProjects, useProvider } from "./paseo-data";


const AUTO = "__auto__";
const HOST_DEFAULT = "__default__";

export function LificSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(lificSettings);
  const text = { color: theme.colors.foreground };
  if (settings.status === "loading") return <Text style={text}>Loading settings…</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Lific">
        <Text style={text}>{settings.error}</Text>
        <SettingsAction label="Try again" actionLabel="Reload" onPress={settings.reload} />
        {settings.status === "invalid" ? (
          <SettingsAction label="Restore default settings" actionLabel="Reset" onPress={settings.reset} />
        ) : null}
      </SettingsSection>
    );
  }
  return <ReadySettingsScreen settings={settings} theme={theme} />;
}

function ReadySettingsScreen({ settings, theme }: { settings: ReadySettings; theme: PluginSurfaceProps["theme"] }) {
  const check = useRpc(checkConnection);
  const connection = useMutation({ mutationFn: () => check({}) });
  const projects = useGitProjects();
  const providers = useProvider();
  const [draft, setDraft] = useState(() => ({
    baseUrl: settings.values.baseUrl,
    apiKey: settings.values.apiKey,
    branchTemplate: settings.values.branchTemplate,
  }));
  const text = { color: theme.colors.foreground };
  const muted = { color: theme.colors.foregroundMuted };

  const saveConnection = useCallback(async () => {
    if (await settings.save({ ...settings.values, ...draft }, settings.revision)) connection.mutate();
  }, [settings, draft, connection]);

  const update = useCallback(
    (changes: Partial<ReadySettings["values"]>) => {
      void settings.save({ ...settings.values, ...changes }, settings.revision);
    },
    [settings],
  );

  const lificProjects = connection.data?.ok ? connection.data.projects : [];
  const projectOptions = [
    { label: "Automatic (lific bind)", value: AUTO },
    ...lificProjects.map((project) => ({ label: `${project.identifier} · ${project.name}`, value: project.identifier })),
  ];

  return (
    <>
      <SettingsSection title="Connection">
        <SettingsCard>
          <SettingsInput
            label="Lific URL"
            hint="The address you open Lific at, for example https://lific.example.com"
            initialValue={draft.baseUrl}
            placeholder="https://lific.example.com"
            onChangeText={(baseUrl) => setDraft((current) => ({ ...current, baseUrl }))}
            disabled={settings.saving}
          />
          <SettingsInput
            label="API key"
            hint="Create a bot named paseo in Lific (Settings → Connect a tool) and paste its key. It is stored on this host as plain JSON."
            initialValue={draft.apiKey}
            secureTextEntry
            onChangeText={(apiKey) => setDraft((current) => ({ ...current, apiKey }))}
            disabled={settings.saving}
          />
          <SettingsAction
            label="Save and test the connection"
            actionLabel={connection.isPending ? "Testing…" : "Save"}
            disabled={settings.saving || connection.isPending}
            onPress={saveConnection}
          />
          {isConfigured(settings.values) && !connection.data ? (
            <SettingsAction label="Load Lific projects" actionLabel="Test" onPress={() => connection.mutate()} />
          ) : null}
        </SettingsCard>
        {insecureUrl(draft.baseUrl) ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning }}>
            This address is not HTTPS, so the API key travels unencrypted. Use HTTPS unless Lific runs on this machine.
          </Text>
        ) : null}
        {connection.data?.ok === false ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
            {connection.data.error}
          </Text>
        ) : null}
        {connection.data?.ok ? (
          <Text style={muted}>Connected. {connection.data.projects.length} projects visible.</Text>
        ) : null}
        {settings.saveError ? (
          <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
            {settings.saveError}
          </Text>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Starting work">
        <SettingsCard>
          <SettingsInput
            label="Branch name template"
            hint="{slug} is the issue title, {identifier} the issue ID. The default keeps Lific IDs out of the repository."
            initialValue={draft.branchTemplate}
            onChangeText={(branchTemplate) => setDraft((current) => ({ ...current, branchTemplate }))}
            disabled={settings.saving}
          />
          <SettingsAction
            label="Branch name template"
            actionLabel="Save template"
            disabled={settings.saving || draft.branchTemplate.trim() === ""}
            onPress={() => update({ branchTemplate: draft.branchTemplate })}
          />
          <SettingsSelect
            label="Default agent"
            value={settings.values.defaultProvider || HOST_DEFAULT}
            options={[
              { label: "Ask each time", value: HOST_DEFAULT },
              ...providers.options.map(({ label, value }) => ({ label, value })),
            ]}
            disabled={settings.saving}
            onValueChange={(value) => update({ defaultProvider: value === HOST_DEFAULT ? "" : value })}
          />
          <SettingsSwitch
            label="Private tracker"
            hint="Ask agents to keep Lific IDs and links out of commits and pull requests."
            value={settings.values.privateTracker}
            disabled={settings.saving}
            onValueChange={(privateTracker) => update({ privateTracker })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Projects"
        info="Projects use the binding from `lific bind` by default. Pick a Lific project to override it."
      >
        <SettingsCard>
          {(projects.data ?? []).map((project) => {
            const override = settings.values.projectOverrides[project.root];
            return (
              <SettingsSelect
                key={project.root}
                label={project.name}
                hint={project.root}
                value={override ?? AUTO}
                options={
                  override && !lificProjects.some((p) => p.identifier === override)
                    ? [...projectOptions, { label: override, value: override }]
                    : projectOptions
                }
                disabled={settings.saving}
                onValueChange={(value) => {
                  const { [project.root]: _removed, ...rest } = settings.values.projectOverrides;
                  update({ projectOverrides: value === AUTO ? rest : { ...rest, [project.root]: value } });
                }}
              />
            );
          })}
          {projects.data?.length === 0 ? (
            <SettingsRow label="No git projects on this host yet." />
          ) : null}
        </SettingsCard>
        {!connection.data?.ok ? <Text style={text}>Test the connection to list Lific projects.</Text> : null}
      </SettingsSection>
    </>
  );
}

/** Plain HTTP to anything but this machine sends the bearer key in clear text. */
function insecureUrl(url: string): boolean {
  const match = /^http:\/\/([^/:]+)/i.exec(url.trim());
  return match !== null && !["localhost", "127.0.0.1", "[::1]"].includes(match[1]!.toLowerCase());
}
