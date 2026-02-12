import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide transition-colors',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-foreground',
        success: 'border-success/40 bg-success/15 text-success-foreground',
        warning: 'border-warning/45 bg-warning/20 text-warning-foreground',
        danger: 'border-danger/45 bg-danger/20 text-danger-foreground',
        accent: 'border-accent/45 bg-accent/20 text-accent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
  VariantProps<typeof badgeVariants> { }

function Badge({ className, variant, ...props }: BadgeProps): JSX.Element {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
