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
