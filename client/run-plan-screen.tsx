import { type PluginScreenProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsCard, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { getPlanPreview, listBranches, listPlans, startRun } from "../shared/rpc";
import { lificSettings } from "../shared/settings";
import { Button, Chip, Message, Section, errorText } from "./kit";
import { useGitProjects, useProviderOptions } from "./paseo-data";

type OpenScreen = (input: { screenId: string; params?: Record<string, string> }) => void;

const MODES = [
  { value: "review", label: "Pause after each step", hint: "You review each step, then press Continue." },
  { value: "continuous", label: "Run straight through", hint: "The next step starts as soon as the previous issue is done." },
] as const;

const BRANCHING = [
  { value: "stacked", label: "Stack the branches", hint: "Each step branches off the previous step's branch." },
  { value: "base", label: "Branch from the base", hint: "Every step branches off the base branch." },
] as const;

export function createRunPlanScreen(openScreen: OpenScreen) {
  return function RunPlanScreen({ theme, layout, params }: PluginScreenProps) {
    const settings = useSettings(lificSettings);
    const projects = useGitProjects();
    const providers = useProviderOptions();
    const toast = useToast();
    const [projectRoot, setProjectRoot] = useState<string | null>(params.projectRoot ?? null);
    const [plan, setPlan] = useState<string | null>(params.plan ?? null);
    const [mode, setMode] = useState<"review" | "continuous">("review");
    const [branching, setBranching] = useState<"stacked" | "base">("stacked");
    const [base, setBase] = useState<string | null>(null);
    const [provider, setProvider] = useState<string | null>(null);
    const [archivePrevious, setArchivePrevious] = useState(true);

    const fetchPlans = useRpc(listPlans);
    const fetchPreview = useRpc(getPlanPreview);
    const fetchBranches = useRpc(listBranches);
    const start = useRpc(startRun);

    useEffect(() => {
      if (projectRoot === null && projects.data?.length === 1) setProjectRoot(projects.data[0]!.root);
    }, [projectRoot, projects.data]);

    const plans = useQuery({
      queryKey: ["plans", projectRoot],
      queryFn: () => fetchPlans({ projectRoot: projectRoot! }),
      enabled: projectRoot !== null,
    });
    const preview = useQuery({
      queryKey: ["plan-preview", plan],
      queryFn: () => fetchPreview({ identifier: plan! }),
      enabled: plan !== null,
    });
    const branches = useQuery({
      queryKey: ["branches", projectRoot],
      queryFn: () => fetchBranches({ projectRoot: projectRoot! }),
      enabled: projectRoot !== null,
    });

    const values = settings.status === "ready" ? settings.values : null;
    useEffect(() => {
      if (!branches.data || !projectRoot) return;
      const remembered = values?.lastBaseBranch[projectRoot];
      setBase(remembered && branches.data.branches.includes(remembered) ? remembered : branches.data.defaultBranch);
    }, [branches.data, projectRoot, values?.lastBaseBranch]);
    useEffect(() => {
      if (provider !== null || !providers.data?.length) return;
      const match = providers.data.find((option) => option.value === values?.defaultProvider);
      setProvider((match ?? providers.data.find((option) => option.isDefault) ?? providers.data[0]!).value);
    }, [provider, providers.data, values?.defaultProvider]);

    const launch = useMutation({
      mutationFn: () => start({
          projectRoot: projectRoot!,
          plan: plan!,
          mode,
          branching,
          base: base!,
          provider: provider!,
          archivePrevious: branching === "stacked" && archivePrevious,
        }),
      onSuccess: () => {
        toast.show(`Running ${plan}`, { variant: "success" });
        openScreen({ screenId: "home" });
      },
      onError: (error) => toast.error(errorText(error)),
    });

    const remaining = preview.data?.steps.filter((step) => !step.done).length ?? 0;
    const canStart = projectRoot !== null && plan !== null && base !== null && provider !== null && remaining > 0;

    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
        contentContainerStyle={{ padding: layout.compact ? 16 : 24, gap: 20, maxWidth: 760 }}
      >
        <View style={{ gap: 2 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 22, fontWeight: "700" }}>Run a plan</Text>
          <Text style={{ color: theme.colors.foregroundMuted }}>
            Paseo works through the plan's steps in order, one agent and worktree per step. Agents commit on their
            branch and close the step's issue; they do not open pull requests.
          </Text>
        </View>

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
                  setPlan(null);
                }}
              />
            ))}
          </View>
        </Section>

        {projectRoot ? (
          <Section theme={theme} title="Plan">
            {plans.isLoading ? <Message theme={theme}>Loading plans…</Message> : null}
            {plans.error ? <Message theme={theme} tone="danger">{errorText(plans.error)}</Message> : null}
            {plans.data?.plans.length === 0 ? <Message theme={theme}>This project has no plans.</Message> : null}
            <View style={{ gap: 2 }}>
              {(plans.data?.plans ?? []).map((candidate) => {
                const selected = candidate.identifier === plan;
                return (
                  <Pressable
                    key={candidate.identifier}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => setPlan(candidate.identifier)}
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
                    <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, flexShrink: 0, minWidth: 92 }}>
                      {candidate.identifier}
                    </Text>
                    <Text numberOfLines={1} style={{ color: theme.colors.foreground, flex: 1 }}>
                      {candidate.title}
                    </Text>
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                      {candidate.doneCount}/{candidate.stepCount}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </Section>
        ) : null}

        {plan && preview.data ? (
          <Section theme={theme} title="Steps">
            <View style={{ gap: 4 }}>
              {preview.data.steps.map((step, index) => (
                <View key={index} style={{ flexDirection: "row", gap: 8, paddingLeft: step.depth * 16 }}>
                  <Text style={{ color: step.done ? theme.colors.statusSuccess : theme.colors.foregroundMuted }}>
                    {step.done ? "✓" : "○"}
                  </Text>
                  <Text style={{ color: step.done ? theme.colors.foregroundMuted : theme.colors.foreground, flex: 1 }}>
                    {step.title}
                  </Text>
                  {step.issue ? (
                    <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{step.issue}</Text>
                  ) : null}
                </View>
              ))}
            </View>
            {remaining === 0 ? <Message theme={theme}>Every step is already done.</Message> : null}
            <Message theme={theme}>Steps without an issue get one when the run reaches them.</Message>
          </Section>
        ) : null}

        {plan ? (
          <Section theme={theme} title="How to run it">
            <OptionGroup<"review" | "continuous"> theme={theme} options={MODES} value={mode} onChange={setMode} />
            <OptionGroup<"stacked" | "base"> theme={theme} options={BRANCHING} value={branching} onChange={setBranching} />
            <SettingsCard>
              <SettingsSelect
                label={branching === "stacked" ? "First step branches from" : "Base branch"}
                value={base ?? ""}
                options={(branches.data?.branches ?? []).map((name) => ({ label: name, value: name }))}
                onValueChange={setBase}
              />
              {branching === "stacked" ? (
                <SettingsSwitch
                  label="Archive finished steps"
                  hint="When a step starts, archive the previous step's workspace. Its commits are already on the new branch. Workspaces with uncommitted changes are kept."
                  value={archivePrevious}
                  onValueChange={setArchivePrevious}
                />
              ) : null}
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
              label={`Run ${plan}`}
              disabled={!canStart}
              busy={launch.isPending}
              onPress={() => launch.mutate()}
            />
          </Section>
        ) : null}
      </ScrollView>
    );
  };
}

function OptionGroup<Value extends string>({
  theme,
  options,
  value,
  onChange,
}: {
  theme: PluginScreenProps["theme"];
  options: readonly { value: Value; label: string; hint: string }[];
  value: Value;
  onChange(value: Value): void;
}) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{
              flexGrow: 1,
              flexBasis: 220,
              gap: 2,
              padding: 10,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: selected ? theme.colors.accent : theme.colors.border,
              backgroundColor: selected ? theme.colors.surface2 : theme.colors.surface1,
            }}
          >
            <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{option.label}</Text>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{option.hint}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
