import * as React from 'react';

import { cn } from '@/lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
}

export function Progress({ value, className, ...props }: ProgressProps): JSX.Element {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn(
        'relative h-1.5 w-full overflow-hidden rounded-full bg-border',
        className,
      )}
      {...props}
    >
      <div
        className="h-full bg-gradient-to-r from-navy via-navy-light to-gold/80 transition-all duration-500"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}
