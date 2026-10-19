import { type SettingsState, usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { listBranches } from "../shared/rpc";
import { type LificSettings, lificSettings } from "../shared/settings";

export type ReadySettings = Extract<SettingsState<typeof lificSettings.schema>, { status: "ready" }>;

/** Settings when loaded, plus a writer that merges a partial change into the current revision. */
export function useLificSettings() {
  const settings = useSettings(lificSettings);
  const ready = settings.status === "ready" ? settings : null;
  const patch = useCallback(
    async (changes: Partial<LificSettings>) => {
      if (!ready) return false;
      return ready.save({ ...ready.values, ...changes }, ready.revision);
    },
    [ready],
  );
  return { settings, values: ready?.values ?? null, patch };
}

export interface GitProject {
  root: string;
  name: string;
}

export function useGitProjects() {
  const paseo = usePaseo();
  return useQuery({
    queryKey: ["paseo", "projects"],
    queryFn: async (): Promise<GitProject[]> => {
      const { projects } = await paseo.projects.list();
      return projects
        .filter((project) => project.projectKind === "git")
        .map((project) => ({ root: project.projectRootPath, name: project.projectDisplayName }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/** The selected project: the one passed in, else the only git project on the host. */
export function useProjectRoot(initial: string | undefined) {
  const projects = useGitProjects();
  const [projectRoot, setProjectRoot] = useState<string | null>(initial ?? null);
  useEffect(() => {
    if (projectRoot === null && projects.data?.length === 1) setProjectRoot(projects.data[0]!.root);
  }, [projectRoot, projects.data]);
  return { projects, projectRoot, setProjectRoot };
}

/** Branches of a project and the selected base: the last one used there, else the repository default. */
export function useBaseBranch(projectRoot: string | null) {
  const fetchBranches = useRpc(listBranches);
  const { values, patch } = useLificSettings();
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const branches = useQuery({
    queryKey: ["branches", projectRoot],
    queryFn: () => fetchBranches({ projectRoot: projectRoot! }),
    enabled: projectRoot !== null,
  });
  const remembered = projectRoot ? values?.lastBaseBranch[projectRoot] : undefined;
  useEffect(() => {
    if (!branches.data) return;
    setBaseBranch(remembered && branches.data.branches.includes(remembered) ? remembered : branches.data.defaultBranch);
  }, [branches.data, remembered]);

  const remember = useCallback(async () => {
    if (!projectRoot || !baseBranch || !values) return;
    await patch({ lastBaseBranch: { ...values.lastBaseBranch, [projectRoot]: baseBranch } });
  }, [projectRoot, baseBranch, values, patch]);

  return { branches: branches.data?.branches ?? [], baseBranch, setBaseBranch, remember };
}

export interface ProviderOption {
  label: string;
  value: string;
  isDefault: boolean;
}

/** `provider/model` choices from the host's ready providers, preselecting the configured default. */
export function useProvider() {
  const paseo = usePaseo();
  const { values } = useLificSettings();
  const [provider, setProvider] = useState<string | null>(null);
  const options = useQuery({
    queryKey: ["paseo", "providers"],
    queryFn: async (): Promise<ProviderOption[]> => {
      const { entries } = await paseo.providers.snapshot();
      return entries
        .filter((entry) => entry.enabled && entry.status === "ready")
        .flatMap((entry) =>
          (entry.models ?? []).map((model) => ({
            label: `${entry.label ?? entry.provider} · ${model.label}`,
            value: `${entry.provider}/${model.id}`,
            isDefault: model.isDefault === true,
          })),
        );
    },
  });
  useEffect(() => {
    if (provider !== null || !options.data?.length || !values) return;
    const configured = options.data.find((option) => option.value === values.defaultProvider);
    setProvider((configured ?? options.data.find((option) => option.isDefault) ?? options.data[0]!).value);
  }, [provider, options.data, values]);
  return { options: options.data ?? [], provider, setProvider };
}
