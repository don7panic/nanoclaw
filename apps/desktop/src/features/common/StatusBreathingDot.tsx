import { cn } from '@/lib/utils';

export type BreathingStatus = 'checking' | 'running' | 'missing' | 'ready' | 'error';

interface StatusBreathingDotProps {
  status: BreathingStatus;
  className?: string;
}

const STATUS_CLASS: Record<BreathingStatus, string> = {
  checking: 'bg-cyan-500 shadow-[0_0_10px_rgba(14,165,197,0.5)] animate-breathe',
  running:
    'bg-cyan-400 shadow-[0_0_14px_rgba(14,165,197,0.6)] animate-pulse-fast',
  missing:
    'bg-amber-500 shadow-[0_0_10px_rgba(217,158,20,0.55)] animate-breathe',
  ready: 'bg-emerald-500 shadow-[0_0_12px_rgba(16,150,100,0.5)]',
  error: 'bg-rose-500 shadow-[0_0_12px_rgba(220,50,80,0.6)] animate-breathe-slow',
};

export function StatusBreathingDot({
  status,
  className,
}: StatusBreathingDotProps): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('inline-flex h-2.5 w-2.5 rounded-full', STATUS_CLASS[status], className)}
    />
  );
}
