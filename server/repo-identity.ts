import { gitOptional } from "./git";

// Port of Lific's src/repo_identity.rs. The values must match byte for byte, or
// `POST /api/repos/resolve` will not find the binding `lific bind` created.

export interface RepoAlias {
  kind: "remote" | "root";
  value: string;
}

const ALLOWED_SCHEMES = new Set(["ssh", "https", "http", "git"]);
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export function normalizeRemoteUrl(raw: string): string | null {
  const url = raw.trim();
  if (url === "") return null;

  const schemeEnd = url.indexOf("://");
  if (schemeEnd !== -1 && SCHEME.test(url.slice(0, schemeEnd))) {
    if (!ALLOWED_SCHEMES.has(url.slice(0, schemeEnd).toLowerCase())) return null;
    const rest = url.slice(schemeEnd + 3);
    const slash = rest.indexOf("/");
    const authority = slash === -1 ? rest : rest.slice(0, slash);
    const path = slash === -1 ? "" : rest.slice(slash);
    const hostPort = splitHostPort(authority.slice(authority.lastIndexOf("@") + 1));
    if (!hostPort) return null;
    return join(hostPort, path);
  }

  // scp-style: [user@]host:path
  const firstSlash = url.indexOf("/");
  const beforeSlash = firstSlash === -1 ? url : url.slice(0, firstSlash);
  if (!beforeSlash.includes(":")) return null;
  const at = beforeSlash.lastIndexOf("@");
  const target = url.slice(at + 1);
  let host: string;
  let path: string;
  if (target.startsWith("[")) {
    const close = target.indexOf("]");
    if (close <= 1 || target[close + 1] !== ":") return null;
    host = target.slice(0, close + 1);
    path = target.slice(close + 2);
  } else {
    const colon = target.indexOf(":");
    host = target.slice(0, colon);
    path = target.slice(colon + 1);
  }
  if (!validHost(host)) return null;
  return join(host.toLowerCase(), path);
}

function splitHostPort(hostPort: string): string | null {
  let host: string;
  let port: string;
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    if (close <= 1) return null;
    host = hostPort.slice(0, close + 1);
    const after = hostPort.slice(close + 1);
    if (after !== "" && !after.startsWith(":")) return null;
    port = after.slice(1);
  } else {
    const colon = hostPort.indexOf(":");
    host = colon === -1 ? hostPort : hostPort.slice(0, colon);
    port = colon === -1 ? "" : hostPort.slice(colon + 1);
  }
  if (!validHost(host)) return null;
  if (port !== "" && !/^\d+$/.test(port)) return null;
  return port === "" ? host.toLowerCase() : `${host.toLowerCase()}:${port}`;
}

function validHost(host: string): boolean {
  return host !== "" && !/\s/.test(host);
}

function join(host: string, rawPath: string): string | null {
  let path = trimSlashes(rawPath);
  if (path.endsWith(".git")) path = path.slice(0, -4);
  path = trimSlashes(path);
  if (path === "") return null;
  return `v1:${host}/${path}`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

export async function computeRepoAliases(cwd: string): Promise<RepoAlias[]> {
  if ((await gitOptional(cwd, ["rev-parse", "--git-dir"])) === null) return [];
  const aliases: RepoAlias[] = [];

  const origin = await gitOptional(cwd, ["remote", "get-url", "origin"]);
  const remote = origin ? normalizeRemoteUrl(origin) : null;
  if (remote) aliases.push({ kind: "remote", value: remote });

  const shallow = await gitOptional(cwd, ["rev-parse", "--is-shallow-repository"]);
  if (shallow !== "true") {
    const roots = await gitOptional(cwd, [
      "--no-replace-objects",
      "rev-list",
      "--first-parent",
      "--max-parents=0",
      "HEAD",
    ]);
    if (roots && OID.test(roots)) aliases.push({ kind: "root", value: `v1:${roots}` });
  }
  return aliases;
}
