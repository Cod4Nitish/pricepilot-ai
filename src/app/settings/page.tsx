"use client";
import { useState } from "react";
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
