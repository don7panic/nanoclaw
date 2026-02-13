import { cn } from '@/lib/utils';

export type BreathingStatus = 'checking' | 'running' | 'missing' | 'ready' | 'error';

interface StatusBreathingDotProps {
  status: BreathingStatus;
  className?: string;
}

const STATUS_CLASS: Record<BreathingStatus, string> = {
  checking: 'bg-gold animate-breathe',
  running: 'bg-navy animate-breathe',
  missing: 'bg-muted-foreground/60',
  ready: 'bg-forest',
  error: 'bg-burgundy animate-breathe',
};

export function StatusBreathingDot({
  status,
  className,
}: StatusBreathingDotProps): JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('inline-flex h-2 w-2 rounded-full', STATUS_CLASS[status], className)}
    />
  );
}
