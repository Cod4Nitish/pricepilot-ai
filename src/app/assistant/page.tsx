"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Send, Sparkles } from "lucide-react";
import { api } from "@/lib/api-client";
import type { SearchResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import ProductCard from "@/components/product/ProductCard";
import ErrorCard from "@/components/product/ErrorCard";

interface Msg {
  role: "user" | "assistant";
  content: string;
  search?: SearchResponse;
}

export default function AssistantPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const chat = useMutation({
    mutationFn: (history: Msg[]) => api.assistant(history.map(({ role, content }) => ({ role, content }))),
    onSuccess: (r) => setMsgs((m) => [...m, { role: "assistant", content: r.reply, search: r.search }]),
  });
  useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [msgs, chat.isPending]);

  function send() {
    const v = text.trim();
    if (!v || chat.isPending) return;
    const next = [...msgs, { role: "user" as const, content: v }];
    setMsgs(next);
    setText("");
    chat.mutate(next);
  }

  return (
    <div className="flex min-h-[calc(100dvh-14rem)] flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 font-display text-h1 font-bold"><Sparkles className="h-6 w-6 text-accent" aria-hidden /> Assistant</h1>
        <p className="text-sm text-muted">Ask for a product or a comparison. Answers come from live search results, not memory.</p>
      </div>

      <div className="flex-1 space-y-4" aria-live="polite">
        {msgs.length === 0 && <Card><p className="text-sm text-muted">Try: “Best phone under ₹20,000 with 8GB RAM” or “Is the Sony WH-1000XM5 cheaper on Amazon or Croma?”</p></Card>}
        {msgs.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-full space-y-3 sm:max-w-[85%]", m.role === "user" && "items-end")}>
              <div className={cn("whitespace-pre-wrap rounded-xl px-4 py-3 text-sm", m.role === "user" ? "bg-primary text-white" : "border border-line bg-surface")}>
                {m.content}
              </div>
              {m.search && m.search.offers.slice(0, 3).map((o) => <ProductCard key={o.id} offer={o} query={m.search?.query} />)}
              {m.search && m.search.offers.length === 0 && <p className="text-xs text-muted">The search returned no confident matches.</p>}
            </div>
          </div>
        ))}
        {chat.isPending && <div className="text-sm text-muted" role="status">Thinking and checking retailers…</div>}
        {chat.isError && <ErrorCard error={chat.error} />}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] flex gap-2 rounded-xl border border-line-strong bg-surface p-2 lg:bottom-4"
      >
        <label htmlFor="chat-in" className="sr-only">Message</label>
        <input
          id="chat-in"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask about a product…"
          className="h-11 flex-1 rounded-xl bg-transparent px-3 text-base sm:text-sm placeholder:text-muted focus:outline-none"
        />
        <Button type="submit" size="icon" aria-label="Send" disabled={!text.trim() || chat.isPending}><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  );
}
