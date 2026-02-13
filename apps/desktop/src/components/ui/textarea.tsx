import * as React from 'react';

import { cn } from '@/lib/utils';

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[120px] w-full rounded border border-input bg-background px-4 py-3 text-sm text-foreground',
          'transition-colors duration-200',
          'placeholder:text-muted-foreground/60',
          'focus-visible:outline-none focus-visible:border-gold/50 focus-visible:ring-1 focus-visible:ring-gold/20',
          'disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-60',
          'resize-y',
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';

export { Textarea };
