import { Card } from "@/components/ui";

// Shown inside the app shell while a page's server work runs. Every page here is
// dynamic, so without this a click shows nothing until the whole page is ready.
export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-6">
        <div className="h-7 w-48 rounded bg-line" />
        <div className="mt-2 h-4 w-80 max-w-full rounded bg-line" />
      </div>
      <Card className="p-4">
        <div className="space-y-3">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="h-4 rounded bg-line" />
          ))}
        </div>
      </Card>
    </div>
  );
}
