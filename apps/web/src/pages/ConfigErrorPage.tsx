export function ConfigErrorPage() {
  return (
    <div className="grid min-h-[100dvh] place-items-center p-6">
      <div className="max-w-lg rounded-3xl border border-border bg-surface p-6">
        <h1 className="text-xl font-extrabold">Configuration needed</h1>
        <p className="mt-2 text-sm text-muted">
          The app is missing environment variables. Copy <code>apps/web/.env.example</code> to <code>apps/web/.env</code>, fill in your Supabase URL, publishable key and Worker URLs,
          then restart <code>pnpm dev</code>. See <code>docs/setup.md</code>.
        </p>
      </div>
    </div>
  );
}
