/**
 * Cloudflare API helpers
 * Extracted to avoid circular imports between index.ts and inbox.ts
 */

/** Minimal env type for reindex — avoids importing full Env */
export interface ReindexEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  AUTORAG_NAME: string;
}

/**
 * Trigger AI Search reindex via Cloudflare API
 * Correct endpoint: POST /accounts/{id}/ai-search/instances/{name}/jobs
 * (the documented full_scan endpoint returns 404)
 */
export async function triggerAISearchReindex(env: ReindexEnv): Promise<{ success: boolean; message: string }> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    console.log("AI Search reindex skipped: missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN");
    return { success: false, message: "Missing API credentials for AI Search reindex" };
  }

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai-search/instances/${env.AUTORAG_NAME}/jobs`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json() as { success: boolean; errors?: Array<{ code: number; message: string }> };

    if (data.success) {
      console.log("AI Search reindex triggered successfully");
      return { success: true, message: "Reindex triggered" };
    } else {
      const errorCode = data.errors?.[0]?.code;
      const errorMsg = data.errors?.[0]?.message || "Unknown error";

      // sync_in_cooldown (7020) means a sync was already triggered recently - not a real error
      if (errorCode === 7020) {
        console.log("AI Search sync in cooldown period (sync already triggered recently)");
        return { success: true, message: "Sync already in progress or recently completed" };
      }

      console.error("AI Search reindex failed:", errorMsg);
      return { success: false, message: errorMsg };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("AI Search reindex error:", error);
    return { success: false, message };
  }
}
