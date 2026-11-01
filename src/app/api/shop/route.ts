import { NextResponse } from "next/server";
import { z } from "zod";
import { handleError, limited, readJson } from "@/lib/api";
import { requireTinyFishKey, withUserKey } from "@/lib/byok";
import { withCostContext } from "@/lib/cost/context";
import { runShop } from "@/lib/shop/pipeline";
import type { StepSink } from "@/lib/shop/discovery/types";
import { RunTracker } from "@/lib/runs";

export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  query: z.string().trim().min(2).max(300),
  pincode: z.string().trim().max(10).optional(),
  weights: z
    .object({ price: z.number().min(0).max(1000).optional(), delivery: z.number().min(0).max(1000).optional(), evidence: z.number().min(0).max(1000).optional() })
    .optional(),
  sort: z.enum(["price", "delivery", "relevance"]).optional(),
  cards: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  /** Optional client-generated run id so the UI can poll GET /api/shop/run/:id while the search runs. */
  runId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  /** user-triggered fresh check: bypass caches and re-read prices live */
  fresh: z.boolean().optional(),
  /** When true, respond with NDJSON: one {type:"step"} line per real pipeline step, then {type:"result"} or {type:"error"}. */
  stream: z.boolean().optional(),
});

/** A RunTracker that also forwards each step (label/status/timestamp only) to a listener. */
function forwardingTracker(runId: string | undefined, onStep: (s: { at: string; label: string; status: "ok" | "warn" | "error" }) => void): StepSink {
  const inner = new RunTracker("search", runId);
  return {
    get id() {
      return inner.id;
    },
    step(label, status = "ok") {
      inner.step(label, status);
      const last = inner.run.steps[inner.run.steps.length - 1];
      try {
        onStep({ at: last?.at ?? new Date().toISOString(), label, status });
      } catch {
        /* listener errors must never break the search */
      }
    },
    finish: (error) => inner.finish(error),
  };
}

/** Universal E-Commerce search: parse -> discovery/offers -> ranked, evidence-backed groups. Never sample data. */
export async function POST(req: Request) {
  try {
    const rl = limited(req, "shop", 3);
    if (rl) return rl;
    const { fresh, stream, ...input } = Body.parse(await readJson(req));
    return await withUserKey(req, async () => {
    requireTinyFishKey();
    if (fresh) {
      const frl = limited(req, "shop-fresh", 2);
      if (frl) return frl;
    }
    if (stream) return streamShop(input, !!fresh);
    const { result, usage } = await withCostContext(!!fresh, () => runShop(input, fresh ? { noCache: true } : {}));
    return NextResponse.json({ ...result, usage: result.cached ? { ...usage, cacheHits: usage.cacheHits + 1 } : usage });
    });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * NDJSON stream of the SAME single run (no duplicate search). Called inside withUserKey, so the
 * async work started here keeps the per-request key context. Lines carry only step labels/status/time.
 */
function streamShop(input: Omit<z.infer<typeof Body>, "fresh" | "stream">, fresh: boolean): Response {
  const enc = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  const send = (obj: unknown) => {
    if (closed || !ctrl) return;
    try {
      ctrl.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
    } catch {
      closed = true;
    }
  };
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
    cancel() {
      closed = true;
    },
  });
  const tracker = forwardingTracker(input.runId, (s) => send({ type: "step", ...s }));
  send({ type: "start", runId: tracker.id, at: new Date().toISOString() });
  void (async () => {
    try {
      const deps = fresh ? { noCache: true, tracker } : { tracker };
      const { result, usage } = await withCostContext(fresh, () => runShop(input, deps), (label, status) => send({ type: "step", at: new Date().toISOString(), label, status }));
      send({ type: "result", data: { ...result, usage: result.cached ? { ...usage, cacheHits: usage.cacheHits + 1 } : usage } });
    } catch (e) {
      const r = handleError(e);
      let error: { code?: string; message?: string } = { code: "INTERNAL", message: "Unexpected server error." };
      try {
        error = ((await r.json()) as { error: typeof error }).error;
      } catch {
        /* keep default */
      }
      send({ type: "error", status: r.status, error });
    } finally {
      if (!closed) {
        closed = true;
        try {
          (ctrl as ReadableStreamDefaultController<Uint8Array> | null)?.close();
        } catch {
          /* already closed */
        }
      }
    }
  })();
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
