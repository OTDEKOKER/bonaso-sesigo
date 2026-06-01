export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-card-foreground">You are offline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The Sesigo Data Portal will continue to show cached pages and previously loaded data.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Reconnect to the internet to sync updates and submit new records.
        </p>
      </section>
    </main>
  )
}
