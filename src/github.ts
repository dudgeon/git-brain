import { createAppAuth } from "@octokit/auth-app";

// GitHub API types
interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  owner: {
    login: string;
    type: string;
  };
}

interface GitHubContent {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  size?: number;
  download_url?: string;
}

interface GitHubInstallation {
  id: number;
  account: {
    login: string;
    type: string;
  };
}

// Environment type for GitHub-related secrets
export interface GitHubEnv {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_WEBHOOK_SECRET: string;
}

/**
 * Get an installation access token for a GitHub App installation
 */
export async function getInstallationToken(
  env: GitHubEnv,
  installationId: number
): Promise<string> {
  const auth = createAppAuth({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
    installationId,
  });

  const { token } = await auth({ type: "installation" });
  return token;
}

/**
 * Get repositories accessible to an installation
 */
export async function getInstallationRepos(
  token: string
): Promise<GitHubRepo[]> {
  const response = await fetch(
    "https://api.github.com/installation/repositories",
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "brain-stem",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { repositories: GitHubRepo[] };
  return data.repositories;
}

/**
 * Get installation details by installation ID
 */
export async function getInstallation(
  env: GitHubEnv,
  installationId: number
): Promise<GitHubInstallation> {
  // Create app-level auth (JWT) to get installation details
  const auth = createAppAuth({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
  });

  const { token } = await auth({ type: "app" });

  const response = await fetch(
    `https://api.github.com/app/installations/${installationId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "brain-stem",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<GitHubInstallation>;
}

/**
 * Fetch contents of a directory or file from a repo
 */
export async function fetchRepoContents(
  token: string,
  owner: string,
  repo: string,
  path: string = ""
): Promise<GitHubContent[]> {
  const url = path
    ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
    : `https://api.github.com/repos/${owner}/${repo}/contents`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "brain-stem",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      return []; // Empty directory or doesn't exist
    }
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as GitHubContent | GitHubContent[];
  // GitHub returns an array for directories, single object for files
  return Array.isArray(data) ? data : [data];
}

/**
 * Fetch raw file content from a download URL
 */
export async function fetchFileContent(
  token: string,
  downloadUrl: string
): Promise<string> {
  const response = await fetch(downloadUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": "brain-stem",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

/**
 * Create or update a file in a GitHub repo via the Contents API
 * PUT /repos/{owner}/{repo}/contents/{path}
 */
export async function createRepoFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "brain-stem",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      content: btoa(String.fromCharCode(...new TextEncoder().encode(content))),
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub API error: ${response.status} ${response.statusText} - ${errorBody}`);
  }
}

/**
 * Fetch the full file tree of a repo in a single API call (Git Trees API)
 * Returns all blobs (files) with their paths — no recursive directory walking needed
 */
export async function fetchRepoTree(
  token: string,
  owner: string,
  repo: string
): Promise<Array<{ path: string; type: string; size?: number; url: string }>> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "brain-stem",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub Trees API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    tree: Array<{ path: string; type: string; size?: number; url: string }>;
    truncated: boolean;
  };

  if (data.truncated) {
    console.warn("Git tree was truncated — repo may have too many files for a single tree fetch");
  }

  return data.tree;
}

/**
 * Fetch raw file content from a blob URL (Git Blobs API)
 * Returns decoded content from base64
 */
export async function fetchBlobContent(
  token: string,
  blobUrl: string
): Promise<string> {
  const response = await fetch(blobUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "brain-stem",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub Blob API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { content: string; encoding: string };
  if (data.encoding === "base64") {
    return atob(data.content.replace(/\n/g, ""));
  }
  return data.content;
}

/**
 * Fetch the entire repo as a gzip tarball (single API call)
 * and extract text files, returning an array of {path, content} entries.
 * This uses only 1 external subrequest regardless of repo size.
 */
export async function fetchRepoTarballFiles(
  token: string,
  owner: string,
  repo: string,
  opts: {
    textExtensions: string[];
    sensitiveFiles: string[];
    skipDirs: string[];
  }
): Promise<Array<{ path: string; content: string }>> {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/tarball`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "brain-stem",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub Tarball API error: ${response.status} ${response.statusText}`);
  }

  // Decompress gzip
  const ds = new DecompressionStream("gzip");
  const decompressed = response.body!.pipeThrough(ds);
  const tarBytes = new Uint8Array(await new Response(decompressed).arrayBuffer());

  // Parse tar entries
  const files: Array<{ path: string; content: string }> = [];
  let offset = 0;
  const decoder = new TextDecoder();

  while (offset + 512 <= tarBytes.length) {
    const header = tarBytes.slice(offset, offset + 512);

    // Check for end-of-archive (two zero blocks)
    if (header.every(b => b === 0)) break;

    // Extract file name (offset 0, 100 bytes) + UStar prefix (offset 345, 155 bytes)
    const nameRaw = decoder.decode(header.slice(0, 100)).replace(/\0+$/, "");
    const prefix = decoder.decode(header.slice(345, 500)).replace(/\0+$/, "");
    const fullName = prefix ? `${prefix}/${nameRaw}` : nameRaw;

    // File size (offset 124, 12 bytes, octal)
    const sizeStr = decoder.decode(header.slice(124, 136)).replace(/\0+$/, "").trim();
    const size = sizeStr ? parseInt(sizeStr, 8) : 0;

    // Type flag (offset 156): '0' or '\0' = regular file
    const typeFlag = header[156];
    const isFile = typeFlag === 0 || typeFlag === 48; // '\0' or '0'

    offset += 512; // move past header

    if (isFile && size > 0) {
      // Strip the top-level directory (e.g., "owner-repo-sha/")
      const slashIdx = fullName.indexOf("/");
      const relPath = slashIdx >= 0 ? fullName.slice(slashIdx + 1) : fullName;

      if (relPath && shouldSyncFile(relPath, opts)) {
        const content = decoder.decode(tarBytes.slice(offset, offset + size));
        files.push({ path: relPath, content });
      }
    }

    // Advance past content (padded to 512-byte boundary)
    offset += Math.ceil(size / 512) * 512;
  }

  return files;
}

/** Check if a file path should be synced based on extension/directory filters */
function shouldSyncFile(
  path: string,
  opts: { textExtensions: string[]; sensitiveFiles: string[]; skipDirs: string[] }
): boolean {
  const parts = path.split("/");
  if (parts.some(p => opts.skipDirs.includes(p))) return false;
  const fileName = parts[parts.length - 1].toLowerCase();
  if (opts.sensitiveFiles.includes(fileName) || fileName.startsWith(".env.")) return false;
  const ext = path.split(".").pop()?.toLowerCase();
  return opts.textExtensions.includes(ext || "");
}

/**
 * Verify GitHub webhook signature
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) {
    return false;
  }

  // signature format: "sha256=<hash>"
  const expectedPrefix = "sha256=";
  if (!signature.startsWith(expectedPrefix)) {
    return false;
  }

  const providedHash = signature.slice(expectedPrefix.length);

  // Compute HMAC-SHA256
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );

  // Convert to hex
  const hashArray = Array.from(new Uint8Array(signatureBuffer));
  const computedHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

  // Timing-safe comparison
  if (computedHash.length !== providedHash.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < computedHash.length; i++) {
    result |= computedHash.charCodeAt(i) ^ providedHash.charCodeAt(i);
  }

  return result === 0;
}
