import { Sparkles } from "lucide-react";
import { CareerWorkspace } from "@/components/CareerWorkspace";

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-5 sm:px-6">
          <span className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Career Intelligence Assistant</h1>
            <p className="text-sm text-muted-foreground">
              Upload a resume and job descriptions, then ask about career fit.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <CareerWorkspace />
      </main>
    </div>
  );
}
