const MAX_SLUG_LENGTH = 48;

export const DEFAULT_BRANCH_TEMPLATE = "{slug}";

export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length <= MAX_SLUG_LENGTH) return slug;
  const cut = slug.slice(0, MAX_SLUG_LENGTH);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > 0 ? cut.slice(0, lastDash) : cut;
}

/**
 * Renders a branch name from a template with `{slug}` and `{identifier}` tokens.
 * The identifier is lowercased so `{identifier}-{slug}` yields `mio-23-fix-sync`.
 */
export function renderBranchName(
  template: string,
  issue: { identifier: string; title: string },
): string {
  const name = template
    .replaceAll("{slug}", slugify(issue.title) || "work")
    .replaceAll("{identifier}", issue.identifier.toLowerCase());
  return name.replace(/\/{2,}/g, "/").replace(/^[-/]+|[-/]+$/g, "");
}
