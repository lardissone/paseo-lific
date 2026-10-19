import type { RpcOutput } from "@getpaseo/plugin";
import { openExternalUrl, type PluginWorkspacePanelProps, useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { ISSUE_STATUSES, type IssueStatus } from "../shared/lific";
import { addIssueComment, getWorkspaceIssue, linkWorkspaceIssue, setIssueStatus } from "../shared/rpc";
import { Button, Chip, Message, Section, errorText } from "./kit";
import { Markdown } from "./markdown";

const REFRESH_MS = 30_000;

export function IssuePanel({ theme, layout, workspaceId }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const fetchIssue = useRpc(getWorkspaceIssue);
  const queryKey = ["workspace-issue", directory];
  const issue = useQuery({
    queryKey,
    queryFn: () => fetchIssue({ directory: directory! }),
    enabled: directory !== null,
    refetchInterval: REFRESH_MS,
  });

  const inputStyle = {
    color: theme.colors.foreground,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: theme.colors.surface1,
  };

  const body = (() => {
    if (directory === null || issue.isLoading) return <Message theme={theme}>Loading…</Message>;
    if (issue.error) return <Message theme={theme} tone="danger">{errorText(issue.error)}</Message>;
    const data = issue.data!;
    if (!data.configured) {
      return (
        <Message theme={theme}>
          Lific is not configured. Open Settings → Plugins → Lific to add the URL and API key.
        </Message>
      );
    }
    if (!data.identifier) return <LinkForm theme={theme} directory={directory} inputStyle={inputStyle} />;
    if (!data.issue) {
      return (
        <View style={{ gap: 12 }}>
          <Message theme={theme} tone="danger">
            Linked to {data.identifier}, but Lific did not return it: {data.error}
          </Message>
          <UnlinkButton theme={theme} directory={directory} />
        </View>
      );
    }
    return (
      <LinkedIssue
        theme={theme}
        directory={directory}
        issue={data.issue}
        comments={data.comments}
        url={data.url}
        inputStyle={inputStyle}
      />
    );
  })();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ padding: layout.compact ? 16 : 20, gap: 16 }}
    >
      {body}
    </ScrollView>
  );
}

type Theme = PluginWorkspacePanelProps["theme"];
type IssueData = RpcOutput<typeof getWorkspaceIssue>;

function useInvalidateIssue(directory: string) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["workspace-issue", directory] });
}

function LinkForm({ theme, directory, inputStyle }: { theme: Theme; directory: string; inputStyle: object }) {
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
        This workspace is not linked to an issue. Link one to give its agents the issue as context. The link is
        stored in the repository's local git config and is never pushed.
      </Message>
      <TextInput
        value={identifier}
        onChangeText={setIdentifier}
        placeholder="MIO-23"
        placeholderTextColor={theme.colors.foregroundMuted}
        autoCapitalize="characters"
        style={inputStyle}
      />
      <Button
        theme={theme}
        variant="primary"
        label="Link issue"
        disabled={identifier.trim() === ""}
        busy={mutation.isPending}
        onPress={() => mutation.mutate()}
      />
      {mutation.error ? <Message theme={theme} tone="danger">{errorText(mutation.error)}</Message> : null}
    </Section>
  );
}

function UnlinkButton({ theme, directory }: { theme: Theme; directory: string }) {
  const link = useRpc(linkWorkspaceIssue);
  const invalidate = useInvalidateIssue(directory);
  const mutation = useMutation({ mutationFn: () => link({ directory, identifier: null }), onSuccess: invalidate });
  return <Button theme={theme} label="Unlink" busy={mutation.isPending} onPress={() => mutation.mutate()} />;
}

function LinkedIssue({
  theme,
  directory,
  issue,
  comments,
  url,
  inputStyle,
}: {
  theme: Theme;
  directory: string;
  issue: NonNullable<IssueData["issue"]>;
  comments: IssueData["comments"];
  url: string | null;
  inputStyle: object;
}) {
  const toast = useToast();
  const invalidate = useInvalidateIssue(directory);
  const updateStatus = useRpc(setIssueStatus);
  const comment = useRpc(addIssueComment);
  const [draft, setDraft] = useState("");

  const status = useMutation({
    mutationFn: (next: IssueStatus) => updateStatus({ identifier: issue.identifier, status: next }),
    onSuccess: invalidate,
    onError: (error) => toast.error(errorText(error)),
  });
  const send = useMutation({
    mutationFn: () => comment({ identifier: issue.identifier, content: draft }),
    onSuccess: () => {
      setDraft("");
      void invalidate();
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const text = { color: theme.colors.foreground };
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };

  return (
    <>
      <View style={{ gap: 4 }}>
        <Text style={muted}>
          {issue.identifier} · {issue.priority} priority
          {issue.labels.length > 0 ? ` · ${issue.labels.join(", ")}` : ""}
        </Text>
        <Text style={{ ...text, fontSize: 18, fontWeight: "600" }}>{issue.title}</Text>
        {issue.needs_human ? <Text style={{ color: theme.colors.statusWarning }}>Waiting on a person</Text> : null}
        {issue.blocked_by?.length ? (
          <Text style={{ color: theme.colors.statusWarning }}>Blocked by {issue.blocked_by.join(", ")}</Text>
        ) : null}
      </View>

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
        {url ? <Button theme={theme} label="Open in Lific" onPress={() => void openExternalUrl(url)} /> : null}
        <UnlinkButton theme={theme} directory={directory} />
      </View>

      <Section theme={theme} title="Description">
        {issue.description.trim() ? (
          <Markdown theme={theme} source={issue.description} />
        ) : (
          <Message theme={theme}>No description.</Message>
        )}
      </Section>

      <Section theme={theme} title="Recent comments">
        {comments.length === 0 ? <Message theme={theme}>No comments yet.</Message> : null}
        {comments.map((entry) => (
          <View
            key={entry.id}
            style={{ gap: 4, padding: 10, borderRadius: 8, backgroundColor: theme.colors.surface1 }}
          >
            <Text style={muted}>
              {entry.author_display_name || entry.author} · {new Date(entry.created_at).toLocaleString()}
            </Text>
            <Markdown theme={theme} source={entry.content} />
          </View>
        ))}
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a comment"
          placeholderTextColor={theme.colors.foregroundMuted}
          multiline
          style={{ ...inputStyle, minHeight: 64, textAlignVertical: "top" }}
        />
        <Button
          theme={theme}
          label="Comment"
          disabled={draft.trim() === ""}
          busy={send.isPending}
          onPress={() => send.mutate()}
        />
      </Section>
    </>
  );
}
