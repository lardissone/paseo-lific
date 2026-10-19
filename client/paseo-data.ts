import { usePaseo } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";

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

export interface ProviderOption {
  label: string;
  value: string;
  isDefault: boolean;
}

/** `provider/model` choices for agents, from the host's ready providers. */
export function useProviderOptions() {
  const paseo = usePaseo();
  return useQuery({
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
}
