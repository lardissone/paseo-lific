import type { PluginTheme } from "@getpaseo/plugin";
import {
  openExternalUrl,
  type PluginScreenProps,
  useRpc,
} from "@getpaseo/plugin/client";
import { Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import type { IssueCard, IssueStatus } from "../shared/lific";
import { errorMessage } from "../shared/errors";
import { type ConfiguredHome, controlRun, getBriefing, getHome, type Home } from "../shared/rpc";
import { describeRunPause, type RunControlAction } from "../shared/run";
import { Button, Card, CONTROL_HEIGHT, Chip, Message, type OpenScreen, priorityColor, statusColor } from "./kit";
import { MarkdownText } from "./markdown";
import { useLificSettings } from "./paseo-data";
import { ATTENTION_QUERY_KEY } from "./sidebar-item";

const REFRESH_MS = 60_000;

type Navigation = PluginScreenProps["navigation"];

/**
 * The Lific home: what agents are working on, what needs you, and what is ready to start.
 * Screen props carry no `openScreen`, so the client entry passes its own.
 */
export function createHomeScreen(openScreen: OpenScreen) {
  return function HomeScreen({ theme, layout, navigation }: PluginScreenProps) {
    const fetchHome = useRpc(getHome);
    const home = useQuery({ queryKey: ["home"], queryFn: () => fetchHome({}), refetchInterval: REFRESH_MS });
    // The home and the sidebar badge read the same state; keep the badge in step with each reload.
    const queryClient = useQueryClient();
    useEffect(() => {
      if (home.dataUpdatedAt) void queryClient.invalidateQueries({ queryKey: ATTENTION_QUERY_KEY });
    }, [home.dataUpdatedAt, queryClient]);
    const startWork = (params: Record<string, string>) => openScreen({ screenId: "start", params });
    const wide = !layout.compact;

    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
        contentContainerStyle={{ padding: layout.compact ? 16 : 28, gap: 24 }}
        refreshControl={
          <RefreshControl refreshing={home.isRefetching} onRefresh={() => void home.refetch()} tintColor={theme.colors.foregroundMuted} />
        }
      >
        <Header
          theme={theme}
          home={home.data}
          loading={home.isFetching}
          onRefresh={() => void home.refetch()}
          onStart={() => startWork({})}
          onRunPlan={() => openScreen({ screenId: "plan" })}
        />

        {home.isLoading ? <Loading theme={theme} /> : null}
        {home.error ? (
          <Card theme={theme}>
            <Message theme={theme} tone="danger">
              Could not load Lific: {errorMessage(home.error)}
            </Message>
          </Card>
        ) : null}
        {home.data && !home.data.configured ? <Onboarding theme={theme} /> : null}

        {home.data?.configured ? (
          <View style={{ flexDirection: wide ? "row" : "column", gap: 24, alignItems: "flex-start" }}>
            <View style={{ flex: wide ? 1 : undefined, alignSelf: "stretch", gap: 24 }}>
              <Plans theme={theme} runs={home.data.runs} activePlans={home.data.activePlans} onChanged={() => void home.refetch()} />
              <InProgress theme={theme} home={home.data} navigation={navigation} />
              <NeedsYou theme={theme} issues={home.data.needsYou} />
              <Briefing theme={theme} projects={home.data.projects.map((p) => p.project.identifier)} />
            </View>
            <View style={{ flex: wide ? 1 : undefined, alignSelf: "stretch", gap: 24 }}>
              <ReadyToStart theme={theme} home={home.data} onStart={startWork} />
            </View>
          </View>
        ) : null}
      </ScrollView>
    );
  };
}

function Header({
  theme,
  home,
  loading,
  onRefresh,
  onStart,
  onRunPlan,
}: {
  theme: PluginTheme;
  home: Home | undefined;
  loading: boolean;
  onRefresh(): void;
  onStart(): void;
  onRunPlan(): void;
}) {
  const ready = home?.configured ? readyCount(home) : 0;
  const summary = home?.configured
    ? [
        plural(inProgressCount(home), "in progress", "in progress"),
        plural(home.needsYou.length, "needs you", "need you"),
        plural(ready, "ready to start", "ready to start"),
      ].join(" · ")
    : "Your Lific issues, next to your agents";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <View style={{ flex: 1, minWidth: 220, gap: 2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 24, fontWeight: "700" }}>Lific</Text>
        <Text style={{ color: theme.colors.foregroundMuted }}>{summary}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Refresh"
        onPress={onRefresh}
        disabled={loading}
        style={{
          width: CONTROL_HEIGHT,
          height: CONTROL_HEIGHT,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
        }}
      >
        {loading ? (
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        ) : (
          <Icon name="RefreshCw" size={16} color={theme.colors.foregroundMuted} />
        )}
      </Pressable>
      {home?.configured ? <Button theme={theme} label="Run a plan" onPress={onRunPlan} alignSelf="center" /> : null}
      {home?.configured ? <Button theme={theme} variant="primary" label="Start work" onPress={onStart} alignSelf="center" /> : null}
    </View>
  );
}

function SectionHeader({ theme, icon, title, count }: { theme: PluginTheme; icon: string; title: string; count?: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Icon name={icon} size={16} color={theme.colors.foregroundMuted} />
      <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>{title}</Text>
      {count !== undefined && count > 0 ? (
        <View style={{ paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: theme.colors.surface2 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{count}</Text>
        </View>
      ) : null}
    </View>
  );
}

function IssueLine({ theme, issue, trailing }: { theme: PluginTheme; issue: IssueCard; trailing?: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View
        accessibilityLabel={`${issue.priority} priority`}
        style={{ width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: priorityColor(theme, issue.priority) }}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontVariant: ["tabular-nums"] }}>{issue.identifier}</Text>
        <Text style={{ color: theme.colors.foreground }} numberOfLines={2}>
          {issue.title}
        </Text>
      </View>
      {trailing}
    </View>
  );
}

function StatusPill({ theme, status }: { theme: PluginTheme; status: IssueStatus }) {
  const color = statusColor(theme, status);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{status}</Text>
    </View>
  );
}

function InProgress({ theme, home, navigation }: { theme: PluginTheme; home: ConfiguredHome; navigation: Navigation }) {
  const { inProgress, activeWithoutWorkspace } = home;
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader theme={theme} icon="Bot" title="In progress" count={inProgressCount(home)} />
      {inProgress.length === 0 && activeWithoutWorkspace.length === 0 ? (
        <Message theme={theme}>No agent is working on an open issue right now.</Message>
      ) : null}
      {inProgress.map((entry) => (
        <Card
          key={entry.workspaceId}
          theme={theme}
          label={`Open workspace for ${entry.issue.identifier}`}
          onPress={navigation ? () => navigation.openWorkspace({ workspaceId: entry.workspaceId }) : undefined}
        >
          <IssueLine theme={theme} issue={entry.issue} trailing={<StatusPill theme={theme} status={entry.issue.status} />} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 13 }}>
            <Icon name="FolderGit2" size={12} color={theme.colors.foregroundMuted} />
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }} numberOfLines={1}>
              {entry.workspaceName}
            </Text>
          </View>
        </Card>
      ))}
      {activeWithoutWorkspace.length > 0 ? (
        <Card theme={theme}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Active in Lific, no workspace linked</Text>
          {activeWithoutWorkspace.map((issue) => (
            <Pressable
              key={issue.identifier}
              accessibilityRole="link"
              onPress={() => void openExternalUrl(issue.url)}
              style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.colors.border }}
            >
              <IssueLine
                theme={theme}
                issue={issue}
                trailing={<Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{issue.projectName}</Text>}
              />
            </Pressable>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

function runStatusText(run: ConfiguredHome["runs"][number]): string {
  if (run.pause) return describeRunPause(run.pause);
  if (run.status === "done") return "Complete";
  if (run.status === "running") return run.current ? `Working on ${run.current.identifier ?? run.current.title}` : "Running";
  return "Paused";
}

function Plans({
  theme,
  runs,
  activePlans,
  onChanged,
}: {
  theme: PluginTheme;
  runs: ConfiguredHome["runs"];
  activePlans: ConfiguredHome["activePlans"];
  onChanged(): void;
}) {
  const control = useRpc(controlRun);
  const toast = useToast();
  const act = useMutation({
    mutationFn: (input: { projectRoot: string; plan: string; action: RunControlAction }) => control(input),
    onSuccess: onChanged,
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (runs.length === 0 && activePlans.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader theme={theme} icon="ListChecks" title="Plans" count={runs.length + activePlans.length} />
      {runs.map((run) => {
        const progress = progressOf(run.doneCount, run.stepCount);
        const waiting = run.status === "paused";
        const target = { projectRoot: run.projectRoot, plan: run.plan };
        return (
          <Card key={`${run.projectRoot}:${run.plan}`} theme={theme}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
              <Text style={{ color: theme.colors.foreground, fontWeight: "600", flex: 1 }} numberOfLines={1}>
                {run.title}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                {run.plan} · {run.doneCount}/{run.stepCount}
              </Text>
            </View>
            <ProgressBar
              theme={theme}
              progress={progress}
              color={run.status === "done" ? theme.colors.statusSuccess : theme.colors.accent}
            />
            <Text style={{ color: waiting ? theme.colors.statusWarning : theme.colors.foregroundMuted, fontSize: 12 }}>
              {runStatusText(run)}
              {run.mode === "review" && run.status === "running" ? " · pauses after each step" : ""}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {waiting ? (
                <Button theme={theme} variant="primary" label="Continue" busy={act.isPending} onPress={() => act.mutate({ ...target, action: "continue" })} />
              ) : null}
              {run.status === "running" ? (
                <Button theme={theme} label="Pause" busy={act.isPending} onPress={() => act.mutate({ ...target, action: "pause" })} />
              ) : null}
              <Button
                theme={theme}
                label={run.status === "done" ? "Dismiss" : "Stop"}
                busy={act.isPending}
                onPress={() => act.mutate({ ...target, action: "stop" })}
              />
            </View>
          </Card>
        );
      })}
      {activePlans.map((plan) => (
        <Card key={plan.identifier} theme={theme} label={`Open ${plan.identifier} in Lific`} onPress={() => void openExternalUrl(plan.url)}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <Text style={{ color: theme.colors.foreground, fontWeight: "600", flex: 1 }} numberOfLines={1}>
              {plan.title}
            </Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              {plan.identifier} · {plan.doneCount}/{plan.stepCount}
            </Text>
          </View>
          <ProgressBar theme={theme} progress={progressOf(plan.doneCount, plan.stepCount)} color={theme.colors.accent} />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Active in Lific · not run from Paseo</Text>
        </Card>
      ))}
    </View>
  );
}

function ProgressBar({ theme, progress, color }: { theme: PluginTheme; progress: number; color: string }) {
  return (
    <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.surface2, overflow: "hidden" }}>
      <View style={{ width: `${Math.round(progress * 100)}%`, height: 4, backgroundColor: color }} />
    </View>
  );
}

function progressOf(done: number, total: number): number {
  return total === 0 ? 0 : done / total;
}

const REASONS: Record<ConfiguredHome["needsYou"][number]["reason"], string> = {
  assigned: "Assigned to you",
  waiting: "Waiting on you",
  human: "For anyone",
};

function NeedsYou({ theme, issues }: { theme: PluginTheme; issues: ConfiguredHome["needsYou"] }) {
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader theme={theme} icon="Hand" title="Needs you" count={issues.length} />
      {issues.length === 0 ? <Message theme={theme}>Nothing is waiting on a person.</Message> : null}
      {issues.length > 0 ? (
        <Card theme={theme}>
          {issues.map((issue, index) => (
            <Pressable
              key={issue.identifier}
              accessibilityRole="link"
              onPress={() => void openExternalUrl(issue.url)}
              style={{
                paddingVertical: 8,
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: theme.colors.border,
              }}
            >
              <IssueLine
                theme={theme}
                issue={issue}
                trailing={
                  <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>{REASONS[issue.reason]}</Text>
                }
              />
            </Pressable>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

function ReadyToStart({
  theme,
  home,
  onStart,
}: {
  theme: PluginTheme;
  home: ConfiguredHome;
  onStart(params: Record<string, string>): void;
}) {
  const total = readyCount(home);
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader theme={theme} icon="Sparkles" title="Ready to start" count={total} />
      {home.projects.length === 0 ? (
        <Message theme={theme}>No workable issues in the Lific projects linked to your repositories.</Message>
      ) : null}
      {home.projects.map(({ project, projectRoot, ready }) => (
        <Card key={project.id} theme={theme}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
            <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{project.name}</Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{project.identifier}</Text>
          </View>
          {ready.map((issue) => (
            <View key={issue.identifier} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
              <IssueLine
                theme={theme}
                issue={issue}
                trailing={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Start work on ${issue.identifier}`}
                    onPress={() => onStart({ projectRoot, identifier: issue.identifier })}
                    style={{ padding: 6, borderRadius: 6, borderWidth: 1, borderColor: theme.colors.border }}
                  >
                    <Icon name="Play" size={14} color={theme.colors.accent} />
                  </Pressable>
                }
              />
            </View>
          ))}
        </Card>
      ))}
      {home.unlinkedProjects.length > 0 ? (
        <Message theme={theme}>
          Not linked to a repository here: {home.unlinkedProjects.map((p) => p.identifier).join(", ")}. Run `lific bind`
          in a repository or pick a project in settings to start work on their issues.
        </Message>
      ) : null}
    </View>
  );
}

function Briefing({ theme, projects }: { theme: PluginTheme; projects: string[] }) {
  const { values, patch } = useLificSettings();
  // The request captures `since` when the user asks, so recording the new cursor does not refetch.
  const [request, setRequest] = useState<{ project: string; since?: string } | null>(null);
  const fetchBriefing = useRpc(getBriefing);

  const briefing = useQuery({
    queryKey: ["briefing", request],
    queryFn: () => fetchBriefing(request!),
    enabled: request !== null,
    staleTime: Infinity,
  });

  // Record what was shown, so the next "since last time" starts here.
  const shown = briefing.data && request ? { project: request.project, at: briefing.data.fetchedAt } : null;
  useEffect(() => {
    if (!shown || !values || values.briefingSeenAt[shown.project] === shown.at) return;
    void patch({ briefingSeenAt: { ...values.briefingSeenAt, [shown.project]: shown.at } });
  }, [shown?.project, shown?.at]);

  function show(project: string, sinceLastTime: boolean) {
    const seenAt = values?.briefingSeenAt[project];
    setRequest({ project, ...(sinceLastTime && seenAt ? { since: seenAt } : {}) });
  }

  if (projects.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      <SectionHeader theme={theme} icon="Newspaper" title="Briefing" />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {projects.map((identifier) => (
          <Chip
            key={identifier}
            theme={theme}
            label={identifier}
            selected={identifier === request?.project}
            onPress={() => (identifier === request?.project ? setRequest(null) : show(identifier, true))}
          />
        ))}
      </View>
      {request ? (
        <Card theme={theme}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, flex: 1 }}>
              {request.since ? `Changes since ${new Date(request.since).toLocaleString()}` : "Full briefing"}
            </Text>
            {request.since ? (
              <Chip theme={theme} label="Show everything" selected={false} onPress={() => show(request.project, false)} />
            ) : null}
          </View>
          {briefing.isLoading ? <Loading theme={theme} /> : null}
          {briefing.error ? <Message theme={theme} tone="danger">{errorMessage(briefing.error)}</Message> : null}
          {briefing.data ? <MarkdownText theme={theme} source={briefing.data.markdown} /> : null}
        </Card>
      ) : (
        <Message theme={theme}>Pick a project to see what changed since you last looked.</Message>
      )}
    </View>
  );
}

function Onboarding({ theme }: { theme: PluginTheme }) {
  const steps = [
    "In Lific, create a bot for a tool named paseo and copy its API key.",
    "Open Settings → Plugins → Lific and enter your Lific URL and the key.",
    "Run `lific bind` in each repository, or pick its Lific project in the plugin settings.",
  ];
  return (
    <Card theme={theme}>
      <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "600" }}>Connect Lific</Text>
      {steps.map((step, index) => (
        <View key={step} style={{ flexDirection: "row", gap: 8 }}>
          <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>{index + 1}</Text>
          <Text style={{ color: theme.colors.foreground, flex: 1 }}>{step}</Text>
        </View>
      ))}
    </Card>
  );
}

function Loading({ theme }: { theme: PluginTheme }) {
  return (
    <View style={{ paddingVertical: 12, alignItems: "flex-start" }}>
      <ActivityIndicator color={theme.colors.foregroundMuted} />
    </View>
  );
}

function inProgressCount(home: ConfiguredHome): number {
  return home.inProgress.length + home.activeWithoutWorkspace.length;
}

function readyCount(home: ConfiguredHome): number {
  return home.projects.reduce((sum, project) => sum + project.ready.length, 0);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
