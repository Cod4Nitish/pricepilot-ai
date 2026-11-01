"use client";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, MonitorSmartphone, XCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import { getSupabase, supabaseConfigured } from "@/lib/supabase-browser";
import { useSession } from "@/lib/use-session";
import { useTheme } from "@/app/providers";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorCard from "@/components/product/ErrorCard";
import { clearUserKey, getUserKey, maskKey, setUserKey, userKeyHeaders } from "@/lib/user-key";

function TinyFishKey() {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSaved(getUserKey()), []);

  async function test(): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/key-check", { method: "POST", headers: userKeyHeaders() });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: { message?: string } };
      const ok = r.ok && j.ok === true;
      setMsg({ ok, text: j.message ?? j.error?.message ?? (ok ? "Key works." : "Key check failed.") });
      return ok;
    } catch {
      setMsg({ ok: false, text: "Could not reach the server to check the key." });
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    const k = draft.trim();
    if (!/^[A-Za-z0-9_\-.:]{16,200}$/.test(k)) {
      setMsg({ ok: false, text: "That does not look like a TinyFish API key." });
      return;
    }
    const prev = getUserKey();
    setUserKey(k);
    if (await test()) {
      setSaved(k);
      setDraft("");
    } else if (prev) setUserKey(prev);
    else clearUserKey();
  }
  function remove() {
    clearUserKey();
    setSaved(null);
    setMsg({ ok: true, text: "Removed. Searches use the site's own TinyFish key again." });
  }

  return (
    <div className="space-y-3 text-sm">
      <p className="text-muted">
        Use your own TinyFish API key for searches from this browser, for example when the site's credits run out.
        Get one at <a className="text-primary underline" href="https://agent.tinyfish.ai/api-keys" target="_blank" rel="noopener noreferrer">tinyfish.ai</a>.
      </p>
      <p>
        Current key: <strong>{saved ? `Your key (${maskKey(saved)})` : "Site default"}</strong>
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label htmlFor="tf-key" className="sr-only">TinyFish API key</label>
        <Input id="tf-key" type="password" autoComplete="off" spellCheck={false} placeholder={saved ? "Paste a new key to replace it" : "Paste your TinyFish API key"} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Button type="submit" disabled={busy || !draft.trim()}>{busy ? "Checking..." : saved ? "Replace key" : "Save key"}</Button>
        {saved && <Button type="button" variant="secondary" onClick={remove} disabled={busy}>Remove</Button>}
        {saved && <Button type="button" variant="secondary" onClick={() => void test()} disabled={busy}>Test</Button>}
      </form>
      {msg && <p role="status" className={msg.ok ? "text-good" : "text-warn"}>{msg.ok ? "✓ " : "✕ "}{msg.text}</p>}
      <p className="text-xs text-muted">
        Stored only in this browser. It is sent over HTTPS with your searches, used only for that request, and never saved or logged on the server.
        Paid Agent steps run on your key are billed to your TinyFish account. Do not use this on a shared computer.
      </p>
    </div>
  );
}

function HealthRow({ label, ok, hint }: { label: string; ok: boolean; hint: string }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2 text-sm">
      <span>{label}</span>
      <span className={ok ? "flex items-center gap-1 text-good" : "flex items-center gap-1 text-warn"}>
        {ok ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <XCircle className="h-4 w-4" aria-hidden />}
        {ok ? "Configured" : `Not configured (${hint})`}
      </span>
    </li>
  );
}

function Account() {
  const { session, loading } = useSession();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "sent" | "error"; msg?: string }>({ kind: "idle" });
  if (!supabaseConfigured) {
    return <p className="text-sm text-muted">Sign-in is not available: this deployment has no <code>NEXT_PUBLIC_SUPABASE_URL</code> / <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>. Watchlist and alerts need an account.</p>;
  }
  if (loading) return <Skeleton className="h-16 w-full" />;
  if (session) {
    return (
      <div className="space-y-3">
        <p className="text-sm">Signed in as <strong>{session.user.email}</strong></p>
        <Button variant="secondary" onClick={() => getSupabase()?.auth.signOut()}>Sign out</Button>
      </div>
    );
  }
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setState({ kind: "sending" });
        const { error } = await getSupabase()!.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + "/settings" } });
        setState(error ? { kind: "error", msg: error.message } : { kind: "sent" });
      }}
    >
      <label htmlFor="auth-email" className="block text-sm text-muted">Email for a magic sign-in link</label>
      <div className="flex gap-2">
        <Input id="auth-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <Button type="submit" disabled={state.kind === "sending"}>{state.kind === "sending" ? "Sending…" : "Send link"}</Button>
      </div>
      <p role="status" className="text-sm">
        {state.kind === "sent" && <span className="text-good">Link sent. Check your inbox and open it on this device.</span>}
        {state.kind === "error" && <span className="text-bad">{state.msg}</span>}
      </p>
    </form>
  );
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, staleTime: 0 });
  const [platform, setPlatform] = useState<"android" | "iphone" | "desktop">("android");

  return (
    <div className="space-y-6">
      <h1 className="font-display text-h1 font-bold">Settings</h1>

      <Card>
        <CardTitle>Theme</CardTitle>
        <div className="mt-3">
          <Tabs label="Theme" value={theme} onChange={setTheme} items={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
        </div>
      </Card>

      <Card id="account">
        <CardTitle>Account</CardTitle>
        <div className="mt-3"><Account /></div>
      </Card>

      <Card id="install">
        <CardTitle><MonitorSmartphone className="mr-2 inline h-5 w-5" aria-hidden />Install the app</CardTitle>
        <div className="mt-3 space-y-3">
          <Tabs label="Platform" value={platform} onChange={setPlatform} items={[{ value: "android", label: "Android" }, { value: "iphone", label: "iPhone" }, { value: "desktop", label: "Desktop" }]} />
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            {platform === "android" && (<><li>Open PricePilot AI in Chrome.</li><li>Tap the install banner, or the ⋮ menu then “Install app”.</li><li>Launch it from your home screen.</li></>)}
            {platform === "iphone" && (<><li>Open PricePilot AI in Safari (other browsers cannot install on iPhone).</li><li>Tap the Share button.</li><li>Choose “Add to Home Screen”, then Add.</li></>)}
            {platform === "desktop" && (<><li>Open PricePilot AI in Chrome or Edge.</li><li>Click the install icon at the right of the address bar.</li><li>Confirm “Install”.</li></>)}
          </ol>
        </div>
      </Card>

      <Card id="tinyfish-key">
        <CardTitle>TinyFish API key</CardTitle>
        <div className="mt-3"><TinyFishKey /></div>
      </Card>

      <Card>
        <CardTitle>Server status</CardTitle>
        {health.isPending && <Skeleton className="mt-3 h-20 w-full" />}
        {health.isError && <div className="mt-3"><ErrorCard error={health.error} onRetry={() => health.refetch()} /></div>}
        {health.data && (
          <ul className="mt-2 divide-y divide-line">
            <HealthRow label="Live search (TinyFish)" ok={health.data.tinyfish} hint="TINYFISH_API_KEY" />
            <HealthRow label="Database and auth (Supabase)" ok={health.data.supabase} hint="SUPABASE_*" />
            <HealthRow label="AI assistant (Claude)" ok={health.data.claude} hint="ANTHROPIC_API_KEY" />
          </ul>
        )}
      </Card>
    </div>
  );
}
