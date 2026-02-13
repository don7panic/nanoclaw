import * as React from 'react';

import { cn } from '@/lib/utils';

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-10 w-full rounded border border-input bg-background px-4 py-2 text-sm text-foreground',
          'transition-colors duration-200',
          'placeholder:text-muted-foreground/60',
          'focus-visible:outline-none focus-visible:border-gold/50 focus-visible:ring-1 focus-visible:ring-gold/20',
          'disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
