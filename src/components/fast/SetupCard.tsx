import { Card, CardTitle } from "@/components/ui/card";

export function SetupCard() {
  return (
    <Card className="border-warn/40" role="alert">
      <CardTitle>Live quick-commerce checks are not set up</CardTitle>
      <p className="mt-2 text-sm text-muted">
        The server has no <code>TINYFISH_API_KEY</code>, so Blinkit and Zepto cannot be checked. We never show sample prices. Add the key to the server environment (see the README) and reload.
      </p>
    </Card>
  );
}

export function ProviderNotes({ providers }: { providers: { id: string; name: string; status: string; reason: string }[] }) {
  return (
    <details className="rounded-xl border border-line p-3 text-sm">
      <summary className="cursor-pointer font-medium">Which stores are checked, and why</summary>
      <ul className="mt-2 space-y-2">
        {providers.map((p) => (
          <li key={p.id}>
            <span className="font-medium">{p.name}</span> <span className="text-muted">({p.status})</span>
            <p className="text-xs text-muted">{p.reason}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
