import { openExternalUrl, type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { errorMessage } from "../shared/errors";
import { ISSUE_STATUSES, type IssueStatus } from "../shared/lific";
import {
  addIssueComment,
  controlRun,
  getWorkspaceIssue,
  linkWorkspaceIssue,
  setIssueStatus,
  type WorkspaceIssue,
} from "../shared/rpc";
import { describeRunPause } from "../shared/run";
import { Button, Chip, Message, Section, TextField } from "./kit";
import { MarkdownText } from "./markdown";

const REFRESH_MS = 30_000;

type Theme = PluginWorkspacePanelProps["theme"];
type Linked = Extract<WorkspaceIssue, { state: "linked" }>;
type RunStep = NonNullable<Linked["run"]>;

export function IssuePanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const fetchIssue = useRpc(getWorkspaceIssue);
  const issue = useQuery({
    queryKey: ["workspace-issue", directory],
    queryFn: () => fetchIssue({ directory: directory! }),
    enabled: directory !== null,
    refetchInterval: REFRESH_MS,
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 16 : 20, gap: 16 }}
    >
      {directory === null || issue.isLoading ? <Message theme={theme}>Loading…</Message> : null}
      {issue.error ? <Message theme={theme} tone="danger">{errorMessage(issue.error)}</Message> : null}
      {directory !== null && issue.data ? <PanelBody theme={theme} directory={directory} data={issue.data} /> : null}
    </ScrollView>
  );
}

function PanelBody({ theme, directory, data }: { theme: Theme; directory: string; data: WorkspaceIssue }) {
  switch (data.state) {
    case "unconfigured":
      return <Message theme={theme}>Lific is not configured. Open Settings → Plugins → Lific to add the URL and API key.</Message>;
    case "unlinked":
      return <LinkForm theme={theme} directory={directory} />;
    case "unavailable":
      return (
        <View style={{ gap: 12 }}>
          <Message theme={theme} tone="danger">
            Linked to {data.identifier}, but Lific did not return it: {data.error}
          </Message>
          <UnlinkButton theme={theme} directory={directory} />
        </View>
      );
    case "linked":
      return <LinkedIssue theme={theme} directory={directory} data={data} />;
  }
}

function useInvalidateIssue(directory: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["workspace-issue", directory] });
}

function LinkForm({ theme, directory }: { theme: Theme; directory: string }) {
  const [identifier, setIdentifier] = useState("");
  const link = useRpc(linkWorkspaceIssue);
  const invalidate = useInvalidateIssue(directory);
  const mutation = useMutation({
    mutationFn: () => link({ directory, identifier: identifier.trim() }),
    onSuccess: invalidate,
  });
  return (
    <Section theme={theme} title="Lific issue">
      <Message theme={theme}>
        This workspace is not linked to an issue. Link one to give its agents the issue as context. The link is stored
        in the repository's local git config and is never pushed.
      </Message>
      <TextField theme={theme} value={identifier} onChangeText={setIdentifier} placeholder="MIO-23" autoCapitalize="characters" />
      <Button
        theme={theme}
        variant="primary"
        label="Link issue"
        disabled={identifier.trim() === ""}
        busy={mutation.isPending}
        onPress={() => mutation.mutate()}
      />
      {mutation.error ? <Message theme={theme} tone="danger">{errorMessage(mutation.error)}</Message> : null}
    </Section>
  );
}

function UnlinkButton({ theme, directory }: { theme: Theme; directory: string }) {
  const link = useRpc(linkWorkspaceIssue);
  const invalidate = useInvalidateIssue(directory);
  const mutation = useMutation({ mutationFn: () => link({ directory, identifier: null }), onSuccess: invalidate });
  return <Button theme={theme} label="Unlink" busy={mutation.isPending} onPress={() => mutation.mutate()} />;
}

function LinkedIssue({ theme, directory, data }: { theme: Theme; directory: string; data: Linked }) {
  const { issue, comments, url, run } = data;
  const toast = useToast();
  const invalidate = useInvalidateIssue(directory);
  const updateStatus = useRpc(setIssueStatus);
  const comment = useRpc(addIssueComment);
  const [draft, setDraft] = useState("");

  const status = useMutation({
    mutationFn: (next: IssueStatus) => updateStatus({ identifier: issue.identifier, status: next }),
    onSuccess: invalidate,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const send = useMutation({
    mutationFn: () => comment({ identifier: issue.identifier, content: draft }),
    onSuccess: () => {
      setDraft("");
      void invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };

  return (
    <>
      <View style={{ gap: 4 }}>
        <Text style={muted}>
          {issue.identifier} · {issue.priority} priority
          {issue.labels.length > 0 ? ` · ${issue.labels.join(", ")}` : ""}
        </Text>
        <Text style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "600" }}>{issue.title}</Text>
        {issue.needs_human ? <Text style={{ color: theme.colors.statusWarning }}>Waiting on a person</Text> : null}
        {issue.blocked_by?.length ? (
          <Text style={{ color: theme.colors.statusWarning }}>Blocked by {issue.blocked_by.join(", ")}</Text>
        ) : null}
      </View>

      {run ? <RunStepBanner theme={theme} directory={directory} run={run} /> : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {ISSUE_STATUSES.map((candidate) => (
          <Chip
            key={candidate}
            theme={theme}
            label={candidate}
            selected={candidate === issue.status}
            onPress={candidate === issue.status || status.isPending ? undefined : () => status.mutate(candidate)}
          />
        ))}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button theme={theme} label="Open in Lific" onPress={() => void openExternalUrl(url)} />
        <UnlinkButton theme={theme} directory={directory} />
      </View>

      <Section theme={theme} title="Description">
        {issue.description.trim() ? <MarkdownText theme={theme} source={issue.description} /> : <Message theme={theme}>No description.</Message>}
      </Section>

      <Section theme={theme} title="Recent comments">
        {comments.length === 0 ? <Message theme={theme}>No comments yet.</Message> : null}
        {comments.map((entry) => (
          <View key={entry.id} style={{ gap: 4, padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface1 }}>
            <Text style={muted}>
              {entry.author_display_name || entry.author} · {new Date(entry.created_at).toLocaleString()}
            </Text>
            <MarkdownText theme={theme} source={entry.content} />
          </View>
        ))}
        <TextField theme={theme} value={draft} onChangeText={setDraft} placeholder="Add a comment" multiline />
        <Button theme={theme} label="Comment" disabled={draft.trim() === ""} busy={send.isPending} onPress={() => send.mutate()} />
      </Section>
    </>
  );
}

function RunStepBanner({ theme, directory, run }: { theme: Theme; directory: string; run: RunStep }) {
  const control = useRpc(controlRun);
  const invalidate = useInvalidateIssue(directory);
  const toast = useToast();
  const proceed = useMutation({
    mutationFn: () => control({ projectRoot: run.projectRoot, plan: run.plan, action: "continue" }),
    onSuccess: invalidate,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const paused = run.status === "paused" && run.pause !== null;
  return (
    <View
      style={{
        gap: 8,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: paused ? theme.colors.statusWarning : theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Text style={{ color: theme.colors.foreground }}>
        Step {run.index} of {run.total} in {run.plan}
        {run.status === "done" ? " · plan complete" : ""}
      </Text>
      {paused ? (
        <>
          <Message theme={theme}>{describeRunPause(run.pause!)}</Message>
          <Button theme={theme} variant="primary" label="Continue the plan" busy={proceed.isPending} onPress={() => proceed.mutate()} />
        </>
      ) : null}
    </View>
  );
}
