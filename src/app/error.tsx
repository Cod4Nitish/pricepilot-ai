"use client";
import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-md py-20 text-center">
      <h1 className="font-display text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted">{error.message || "An unexpected error occurred."}</p>
      <Button onClick={reset} className="mt-6">Try again</Button>
    </div>
  );
}
