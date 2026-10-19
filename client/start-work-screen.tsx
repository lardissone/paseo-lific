import { type PluginScreenProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import {
  SettingsCard,
  SettingsInput,
  type SettingsInputHandle,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { renderBranchName } from "../shared/branch";
import { type IssueSummary, listBranches, listIssues, resolveProject, startWork } from "../shared/rpc";
import { lificSettings } from "../shared/settings";
import { Button, Chip, Message, Section, errorText, useDebounced } from "./kit";
import { useGitProjects, useProviderOptions } from "./paseo-data";

export function StartWorkScreen({ theme, layout, params, navigation }: PluginScreenProps) {
  const settings = useSettings(lificSettings);
  const projects = useGitProjects();
  const providers = useProviderOptions();
  const [projectRoot, setProjectRoot] = useState<string | null>(params.projectRoot ?? null);
  const [query, setQuery] = useState(params.identifier ?? "");
  const [issue, setIssue] = useState<IssueSummary | null>(null);
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("");
  const [provider, setProvider] = useState<string | null>(null);
  const branchInput = useRef<SettingsInputHandle>(null);
  const toast = useToast();

  const values = settings.status === "ready" ? settings.values : null;
  const fetchIssues = useRpc(listIssues);
  const fetchBranches = useRpc(listBranches);
  const fetchProject = useRpc(resolveProject);
  const start = useRpc(startWork);

  useEffect(() => {
    if (projectRoot === null && projects.data?.length === 1) setProjectRoot(projects.data[0]!.root);
  }, [projectRoot, projects.data]);

  const project = useQuery({
    queryKey: ["project", projectRoot],
    queryFn: () => fetchProject({ projectRoot: projectRoot! }),
    enabled: projectRoot !== null,
  });
  const issueQuery = useDebounced(query, 300);
  const issues = useQuery({
    queryKey: ["issues", projectRoot, issueQuery],
    queryFn: () => fetchIssues({ projectRoot: projectRoot!, query: issueQuery }),
    enabled: projectRoot !== null && project.data?.kind === "resolved",
  });
  const branches = useQuery({
    queryKey: ["branches", projectRoot],
    queryFn: () => fetchBranches({ projectRoot: projectRoot! }),
    enabled: projectRoot !== null,
  });

  // Preselect the remembered base branch, then the repository default.
  useEffect(() => {
    if (!branches.data || !projectRoot) return;
    const remembered = values?.lastBaseBranch[projectRoot];
    setBaseBranch(
      remembered && branches.data.branches.includes(remembered) ? remembered : branches.data.defaultBranch,
    );
  }, [branches.data, projectRoot, values?.lastBaseBranch]);

  useEffect(() => {
    if (provider !== null || !providers.data?.length) return;
    const preferred = values?.defaultProvider;
    const match = providers.data.find((option) => option.value === preferred);
    setProvider((match ?? providers.data.find((option) => option.isDefault) ?? providers.data[0]!).value);
  }, [provider, providers.data, values?.defaultProvider]);

  function pickIssue(next: IssueSummary) {
    setIssue(next);
    const name = renderBranchName(values?.branchTemplate ?? "{slug}", next);
    setBranchName(name);
    branchInput.current?.replaceText(name);
  }

  const launch = useMutation({
    mutationFn: async () => {
      const result = await start({
        identifier: issue!.identifier,
        projectRoot: projectRoot!,
        baseBranch: baseBranch!,
        branchName: branchName.trim(),
        provider: provider!,
      });
      if (settings.status === "ready") {
        await settings.save(
          {
            ...settings.values,
            lastBaseBranch: { ...settings.values.lastBaseBranch, [projectRoot!]: baseBranch! },
          },
          settings.revision,
        );
      }
      return result;
    },
    onSuccess: ({ workspaceId }) => {
      toast.show(`Started ${issue!.identifier}`, { variant: "success" });
      navigation?.openWorkspace({ workspaceId });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const canStart =
    issue !== null && projectRoot !== null && baseBranch !== null && branchName.trim() !== "" && provider !== null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 16 : 24, gap: 20, maxWidth: 760 }}
    >
      {values && !values.baseUrl ? (
        <Message theme={theme} tone="danger">
          Lific is not configured. Open Settings → Plugins → Lific to add the URL and API key.
        </Message>
      ) : null}

      <Section theme={theme} title="Project">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {(projects.data ?? []).map((candidate) => (
            <Chip
              key={candidate.root}
              theme={theme}
              label={candidate.name}
              selected={candidate.root === projectRoot}
              onPress={() => {
                setProjectRoot(candidate.root);
                setIssue(null);
              }}
            />
          ))}
        </View>
        {project.data?.kind === "resolved" ? (
          <Message theme={theme}>
            Lific project {project.data.project.identifier} · {project.data.project.name}
          </Message>
        ) : null}
        {project.data?.kind === "none" ? (
          <Message theme={theme} tone="danger">
            This repository is not bound to a Lific project. Run `lific bind` in it, or pick a project in settings.
          </Message>
        ) : null}
        {project.data?.kind === "conflict" ? (
          <Message theme={theme} tone="danger">
            This repository is bound to several Lific projects (
            {project.data.projects.map((p) => p.identifier).join(", ")}). Pick one in settings.
          </Message>
        ) : null}
        {project.error ? <Message theme={theme} tone="danger">{errorText(project.error)}</Message> : null}
      </Section>

      {project.data?.kind === "resolved" ? (
        <Section theme={theme} title="Issue">
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search, or type an ID like MIO-23. Empty shows workable issues."
            placeholderTextColor={theme.colors.foregroundMuted}
            autoCapitalize="none"
            style={{
              color: theme.colors.foreground,
              borderWidth: 1,
              borderColor: theme.colors.border,
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 8,
              backgroundColor: theme.colors.surface1,
            }}
          />
          {issues.isLoading ? <Message theme={theme}>Loading issues…</Message> : null}
          {issues.error ? <Message theme={theme} tone="danger">{errorText(issues.error)}</Message> : null}
          {issues.data?.issues.length === 0 ? <Message theme={theme}>No matching issues.</Message> : null}
          <View style={{ gap: 2 }}>
            {(issues.data?.issues ?? []).map((candidate) => {
              const selected = candidate.identifier === issue?.identifier;
              return (
                <Pressable
                  key={candidate.identifier}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => pickIssue(candidate)}
                  style={{
                    flexDirection: "row",
                    gap: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 8,
                    borderRadius: 8,
                    backgroundColor: selected ? theme.colors.surface2 : "transparent",
                  }}
                >
                  <Text style={{ color: theme.colors.foregroundMuted, fontVariant: ["tabular-nums"], minWidth: 64 }}>
                    {candidate.identifier}
                  </Text>
                  <Text style={{ color: theme.colors.foreground, flex: 1 }} numberOfLines={2}>
                    {candidate.title}
                  </Text>
                  {candidate.status ? (
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{candidate.status}</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Section>
      ) : null}

      {issue ? (
        <Section theme={theme} title="Workspace">
          <SettingsCard>
            <SettingsSelect
              label="Base branch"
              value={baseBranch ?? ""}
              options={(branches.data?.branches ?? []).map((name) => ({ label: name, value: name }))}
              onValueChange={setBaseBranch}
            />
            <SettingsInput
              ref={branchInput}
              label="New branch"
              initialValue={branchName}
              onChangeText={setBranchName}
              placeholder="branch-name"
            />
            <SettingsSelect
              label="Agent"
              value={provider ?? ""}
              options={(providers.data ?? []).map(({ label, value }) => ({ label, value }))}
              onValueChange={setProvider}
            />
          </SettingsCard>
          <Button
            theme={theme}
            variant="primary"
            label={`Start ${issue.identifier}`}
            disabled={!canStart}
            busy={launch.isPending}
            onPress={() => launch.mutate()}
          />
          <Message theme={theme}>
            Creates a worktree on a new branch, links it to {issue.identifier} in the local git config, sets the issue
            to active, and starts the agent with the issue as context.
          </Message>
        </Section>
      ) : null}
    </ScrollView>
  );
}
