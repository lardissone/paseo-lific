import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { DEFAULT_BRANCH_TEMPLATE } from "./branch";

export const lificSettings = defineSettings({
  id: "lific",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Lific instance URL, e.g. https://lific.example.com. The API lives under `/api`. */
    baseUrl: z.string().trim().default(""),
    /** API key of the `paseo` bot user. Stored as plain host JSON. */
    apiKey: z.string().trim().default(""),
    branchTemplate: z.string().trim().min(1).default(DEFAULT_BRANCH_TEMPLATE),
    /** Ask agents to keep Lific identifiers out of commits and pull requests. */
    privateTracker: z.boolean().default(true),
    /** `provider/model` used for agents started from an issue. Empty uses the host default. */
    defaultProvider: z.string().trim().default(""),
    /** Paseo project root path → Lific project identifier, for repos `lific bind` does not cover. */
    projectOverrides: z.record(z.string(), z.string()).default({}),
    /** Paseo project root path → last base branch picked in Start work. */
    lastBaseBranch: z.record(z.string(), z.string()).default({}),
    /** Lific project identifier → when its briefing was last shown, for "since last time". */
    briefingSeenAt: z.record(z.string(), z.string()).default({}),
    /** Lific project identifiers collapsed in the home's Ready to start list. */
    collapsedProjects: z.array(z.string()).default([]),
  }),
});

export type LificSettings = z.output<typeof lificSettings.schema>;

export function isConfigured(settings: LificSettings): boolean {
  return settings.baseUrl !== "" && settings.apiKey !== "";
}
