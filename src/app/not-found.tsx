import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <p className="gradient-text font-display text-6xl font-bold">404</p>
      <h1 className="mt-3 font-display text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted">The page you are looking for does not exist.</p>
      <Button asChild className="mt-6"><Link href="/">Back home</Link></Button>
    </div>
  );
}
