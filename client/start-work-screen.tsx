import { type PluginScreenProps, useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsCard, SettingsInput, type SettingsInputHandle } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { DEFAULT_BRANCH_TEMPLATE, renderBranchName } from "../shared/branch";
import { errorMessage } from "../shared/errors";
import { type IssueSummary, listIssues, resolveProject, startWork } from "../shared/rpc";
import { AgentSelect, BaseBranchSelect, ProjectPicker } from "./form-fields";
import { Button, Message, ScreenScaffold, Section, SelectableRow, TextField, useDebounced } from "./kit";
import { useBaseBranch, useLificSettings, useProjectRoot, useProvider } from "./paseo-data";

export function StartWorkScreen({ theme, layout, params, navigation }: PluginScreenProps) {
  const { values } = useLificSettings();
  const { projects, projectRoot, setProjectRoot } = useProjectRoot(params.projectRoot);
  const { branches, baseBranch, setBaseBranch, remember } = useBaseBranch(projectRoot);
  const agent = useProvider();
  const [query, setQuery] = useState(params.identifier ?? "");
  const [issue, setIssue] = useState<IssueSummary | null>(null);
  const [branchName, setBranchName] = useState("");
  const branchInput = useRef<SettingsInputHandle>(null);
  const toast = useToast();

  const fetchIssues = useRpc(listIssues);
  const fetchProject = useRpc(resolveProject);
  const start = useRpc(startWork);

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

  const branchTemplate = values?.branchTemplate ?? DEFAULT_BRANCH_TEMPLATE;
  const pickIssue = useCallback(
    (next: IssueSummary) => {
      setIssue(next);
      const name = renderBranchName(branchTemplate, next);
      setBranchName(name);
      branchInput.current?.replaceText(name);
    },
    [branchTemplate],
  );

  // Opened from the home screen with an issue: select it as soon as it is listed.
  const requested = params.identifier;
  useEffect(() => {
    if (!requested || issue) return;
    const match = issues.data?.issues.find((candidate) => candidate.identifier === requested);
    if (match) pickIssue(match);
  }, [requested, issue, issues.data, pickIssue]);

  const launch = useMutation({
    mutationFn: async () => {
      const result = await start({
        identifier: issue!.identifier,
        projectRoot: projectRoot!,
        baseBranch: baseBranch!,
        branchName: branchName.trim(),
        provider: agent.provider!,
      });
      await remember();
      return result;
    },
    onSuccess: ({ workspaceId }) => {
      toast.show(`Started ${issue!.identifier}`, { variant: "success" });
      navigation?.openWorkspace({ workspaceId });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const canStart =
    issue !== null && projectRoot !== null && baseBranch !== null && branchName.trim() !== "" && agent.provider !== null;

  return (
    <ScreenScaffold
      theme={theme}
      compact={layout.compact}
      title="Start work"
      description="Pick an issue and Paseo creates a worktree on a new branch and starts an agent on it."
    >
      {project.data?.kind === "unconfigured" ? (
        <Message theme={theme} tone="danger">
          Lific is not configured. Open Settings → Plugins → Lific to add the URL and API key.
        </Message>
      ) : null}

      <Section theme={theme} title="Project">
        <ProjectPicker
          theme={theme}
          projects={projects.data ?? []}
          value={projectRoot}
          onChange={(root) => {
            setProjectRoot(root);
            setIssue(null);
          }}
        />
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
            This repository is bound to several Lific projects ({project.data.projects.map((p) => p.identifier).join(", ")}).
            Pick one in settings.
          </Message>
        ) : null}
        {project.error ? <Message theme={theme} tone="danger">{errorMessage(project.error)}</Message> : null}
      </Section>

      {project.data?.kind === "resolved" ? (
        <Section theme={theme} title="Issue">
          <TextField
            theme={theme}
            value={query}
            onChangeText={setQuery}
            placeholder="Search, or type an ID like MIO-23. Empty shows workable issues."
          />
          {issues.isLoading ? <Message theme={theme}>Loading issues…</Message> : null}
          {issues.error ? <Message theme={theme} tone="danger">{errorMessage(issues.error)}</Message> : null}
          {issues.data?.issues.length === 0 ? <Message theme={theme}>No matching issues.</Message> : null}
          <View style={{ gap: 2 }}>
            {(issues.data?.issues ?? []).map((candidate) => (
              <SelectableRow
                key={candidate.identifier}
                theme={theme}
                selected={candidate.identifier === issue?.identifier}
                onPress={() => pickIssue(candidate)}
                identifier={candidate.identifier}
                title={candidate.title}
                trailing={candidate.status}
              />
            ))}
          </View>
        </Section>
      ) : null}

      {issue ? (
        <Section theme={theme} title="Workspace">
          <SettingsCard>
            <BaseBranchSelect branches={branches} value={baseBranch} onChange={setBaseBranch} />
            <SettingsInput
              ref={branchInput}
              label="New branch"
              initialValue={branchName}
              onChangeText={setBranchName}
              placeholder="branch-name"
            />
            <AgentSelect options={agent.options} value={agent.provider} onChange={agent.setProvider} />
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
    </ScreenScaffold>
  );
}
