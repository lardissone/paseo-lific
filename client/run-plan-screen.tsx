import { type PluginScreenProps, useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsCard, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { errorMessage } from "../shared/errors";
import { getPlanPreview, listPlans, startRun } from "../shared/rpc";
import type { RunBranching, RunMode } from "../shared/run";
import { AgentSelect, BaseBranchSelect, ProjectPicker } from "./form-fields";
import { Button, Message, type OpenScreen, ScreenScaffold, Section, SelectableRow } from "./kit";
import { useBaseBranch, useProjectRoot, useProvider } from "./paseo-data";

const MODES: readonly Option<RunMode>[] = [
  { value: "review", label: "Pause after each step", hint: "You review each step, then press Continue." },
  { value: "continuous", label: "Run straight through", hint: "The next step starts as soon as the previous issue is done." },
];

const BRANCHING: readonly Option<RunBranching>[] = [
  { value: "stacked", label: "Stack the branches", hint: "Each step branches off the previous step's branch." },
  { value: "base", label: "Branch from the base", hint: "Every step branches off the base branch." },
];

interface Option<Value extends string> {
  value: Value;
  label: string;
  hint: string;
}

/** Built by the client entry, which supplies `openScreen` to return to the home after starting. */
export function createRunPlanScreen(openScreen: OpenScreen) {
  return function RunPlanScreen({ theme, layout, params }: PluginScreenProps) {
    const toast = useToast();
    const { projects, projectRoot, setProjectRoot } = useProjectRoot(params.projectRoot);
    const { branches, baseBranch, setBaseBranch, remember } = useBaseBranch(projectRoot);
    const agent = useProvider();
    const [plan, setPlan] = useState<string | null>(params.plan ?? null);
    const [mode, setMode] = useState<RunMode>("review");
    const [branching, setBranching] = useState<RunBranching>("stacked");
    const [archivePrevious, setArchivePrevious] = useState(true);

    const fetchPlans = useRpc(listPlans);
    const fetchPreview = useRpc(getPlanPreview);
    const start = useRpc(startRun);

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

    const launch = useMutation({
      mutationFn: async () => {
        await start({
          projectRoot: projectRoot!,
          plan: plan!,
          mode,
          branching,
          base: baseBranch!,
          provider: agent.provider!,
          archivePrevious: branching === "stacked" && archivePrevious,
        });
        await remember();
      },
      onSuccess: () => {
        toast.show(`Running ${plan}`, { variant: "success" });
        openScreen({ screenId: "home" });
      },
      onError: (error) => toast.error(errorMessage(error)),
    });

    const remaining = preview.data?.steps.filter((step) => !step.done).length ?? 0;
    const canStart = projectRoot !== null && plan !== null && baseBranch !== null && agent.provider !== null && remaining > 0;

    return (
      <ScreenScaffold
        theme={theme}
        compact={layout.compact}
        title="Run a plan"
        description="Paseo works through the plan's steps in order, one agent and worktree per step. Agents commit on their branch and close the step's issue; they do not open pull requests."
      >
        <Section theme={theme} title="Project">
          <ProjectPicker
            theme={theme}
            projects={projects.data ?? []}
            value={projectRoot}
            onChange={(root) => {
              setProjectRoot(root);
              setPlan(null);
            }}
          />
        </Section>

        {projectRoot ? (
          <Section theme={theme} title="Plan">
            {plans.isLoading ? <Message theme={theme}>Loading plans…</Message> : null}
            {plans.error ? <Message theme={theme} tone="danger">{errorMessage(plans.error)}</Message> : null}
            {plans.data?.plans.length === 0 ? <Message theme={theme}>This project has no plans.</Message> : null}
            <View style={{ gap: 2 }}>
              {(plans.data?.plans ?? []).map((candidate) => (
                <SelectableRow
                  key={candidate.identifier}
                  theme={theme}
                  selected={candidate.identifier === plan}
                  onPress={() => setPlan(candidate.identifier)}
                  identifier={candidate.identifier}
                  identifierWidth={92}
                  title={candidate.title}
                  trailing={`${candidate.doneCount}/${candidate.stepCount}`}
                />
              ))}
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
                  {step.issue ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{step.issue}</Text> : null}
                </View>
              ))}
            </View>
            {remaining === 0 ? <Message theme={theme}>Every step is already done.</Message> : null}
            <Message theme={theme}>Steps without an issue get one when the run reaches them.</Message>
          </Section>
        ) : null}

        {plan ? (
          <Section theme={theme} title="How to run it">
            <OptionGroup<RunMode> theme={theme} options={MODES} value={mode} onChange={setMode} />
            <OptionGroup<RunBranching> theme={theme} options={BRANCHING} value={branching} onChange={setBranching} />
            <SettingsCard>
              <BaseBranchSelect
                label={branching === "stacked" ? "First step branches from" : "Base branch"}
                branches={branches}
                value={baseBranch}
                onChange={setBaseBranch}
              />
              {branching === "stacked" ? (
                <SettingsSwitch
                  label="Archive finished steps"
                  hint="When a step starts, archive the previous step's workspace. Its commits are already on the new branch. Workspaces with uncommitted changes are kept."
                  value={archivePrevious}
                  onValueChange={setArchivePrevious}
                />
              ) : null}
              <AgentSelect options={agent.options} value={agent.provider} onChange={agent.setProvider} />
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
      </ScreenScaffold>
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
  options: readonly Option<Value>[];
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
