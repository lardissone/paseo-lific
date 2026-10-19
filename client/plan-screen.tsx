import { openExternalUrl, type PluginScreenProps, useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { Pressable, Text, View } from "react-native";
import { errorMessage } from "../shared/errors";
import { getPlanPreview } from "../shared/rpc";
import { Button, Message, type OpenScreen, ScreenScaffold, Section, statusColor } from "./kit";

/** One plan's steps and their issues. Built by the client entry, which supplies `openScreen` for Run this plan. */
export function createPlanScreen(openScreen: OpenScreen) {
  return function PlanScreen({ theme, layout, params }: PluginScreenProps) {
    const identifier = params.plan ?? null;
    const fetchPlan = useRpc(getPlanPreview);
    const plan = useQuery({
      queryKey: ["plan-preview", identifier],
      queryFn: () => fetchPlan({ identifier: identifier! }),
      enabled: identifier !== null,
    });

    const data = plan.data;
    const remaining = data?.steps.filter((step) => !step.done).length ?? 0;
    const active = data?.steps.filter((step) => step.issueStatus === "active").length ?? 0;

    return (
      <ScreenScaffold
        theme={theme}
        compact={layout.compact}
        title={data?.title ?? identifier ?? "Plan"}
        description={
          data ? `${identifier} · ${data.status} · ${data.doneCount}/${data.stepCount} steps done · ${active} active` : ""
        }
      >
        {identifier === null ? <Message theme={theme}>No plan selected.</Message> : null}
        {plan.isLoading ? <Message theme={theme}>Loading plan…</Message> : null}
        {plan.error ? <Message theme={theme} tone="danger">{errorMessage(plan.error)}</Message> : null}

        {data ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {remaining > 0 && params.projectRoot ? (
              <Button
                theme={theme}
                variant="primary"
                label="Run this plan"
                onPress={() => openScreen({ screenId: "plan", params: { projectRoot: params.projectRoot!, plan: identifier! } })}
              />
            ) : null}
            <Button theme={theme} label="Open in Lific" onPress={() => void openExternalUrl(data.url)} />
          </View>
        ) : null}

        {data ? (
          <Section theme={theme} title="Steps">
            {data.steps.length === 0 ? <Message theme={theme}>This plan has no steps.</Message> : null}
            <View style={{ gap: 2 }}>
              {data.steps.map((step, index) => {
                const working = step.issueStatus === "active";
                return (
                  <Pressable
                    key={index}
                    accessibilityRole={step.issueUrl ? "link" : undefined}
                    disabled={!step.issueUrl}
                    onPress={() => (step.issueUrl ? void openExternalUrl(step.issueUrl) : undefined)}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      paddingVertical: 6,
                      paddingRight: 6,
                      paddingLeft: 6 + step.depth * 16,
                      borderRadius: 6,
                      backgroundColor: pressed || working ? theme.colors.surface2 : undefined,
                    })}
                  >
                    <StepMarker theme={theme} done={step.done} working={working} />
                    <Text
                      style={{
                        color: step.done ? theme.colors.foregroundMuted : theme.colors.foreground,
                        fontWeight: working ? "600" : undefined,
                        flex: 1,
                      }}
                    >
                      {step.title}
                    </Text>
                    {working ? <Text style={{ color: theme.colors.accent, fontSize: 12 }}>Active</Text> : null}
                    {step.issue ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        {step.issueStatus ? (
                          <View
                            accessibilityLabel={step.issueStatus}
                            style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor(theme, step.issueStatus) }}
                          />
                        ) : null}
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontVariant: ["tabular-nums"] }}>
                          {step.issue}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </Section>
        ) : null}
      </ScreenScaffold>
    );
  };
}

function StepMarker({ theme, done, working }: { theme: PluginScreenProps["theme"]; done: boolean; working: boolean }) {
  if (done) return <Icon name="CircleCheck" size={14} color={theme.colors.statusSuccess} />;
  if (working) return <Icon name="CirclePlay" size={14} color={theme.colors.accent} />;
  return <Icon name="Circle" size={14} color={theme.colors.foregroundMuted} />;
}
