import { z } from "zod";

const schema = z.object({
  TINYFISH_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(8).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

/** Lazy, server-only env read. Empty strings are treated as unset. */
export function getEnv(): ServerEnv {
  const raw: Record<string, string | undefined> = {};
  for (const k of Object.keys(schema.shape)) {
    const v = process.env[k];
    raw[k] = v && v.trim() ? v.trim() : undefined;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    // Invalid values are treated as unconfigured rather than crashing.
    const out: Record<string, string | undefined> = { ...raw };
    for (const issue of parsed.error.issues) delete out[String(issue.path[0])];
    return out as ServerEnv;
  }
  return parsed.data;
}

export class NotConfiguredError extends Error {
  constructor(public what: string) {
    super(`${what} is not configured on the server.`);
    this.name = "NotConfiguredError";
  }
}

export function requireEnv<K extends keyof ServerEnv>(key: K): string {
  const v = getEnv()[key];
  if (!v) throw new NotConfiguredError(String(key));
  return v;
}
