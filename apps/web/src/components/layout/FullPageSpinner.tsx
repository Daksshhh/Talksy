import { LogoMark } from '@/components/ui/Logo';

export function FullPageSpinner() {
  return (
    <div className="grid min-h-[100dvh] place-items-center" role="status" aria-label="Loading">
      <div className="relative grid place-items-center">
        <span className="absolute h-16 w-16 rounded-full bg-primary/30 animate-pulse-ring" />
        <LogoMark className="h-12 w-12 animate-orbit" />
      </div>
    </div>
  );
}
