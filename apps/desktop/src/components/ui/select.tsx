import * as React from 'react';

import { cn } from '@/lib/utils';

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded border border-input bg-background px-4 py-2 text-sm text-foreground',
        'transition-colors duration-200',
        'focus-visible:outline-none focus-visible:border-gold/50 focus-visible:ring-1 focus-visible:ring-gold/20',
        'disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export { Select };
