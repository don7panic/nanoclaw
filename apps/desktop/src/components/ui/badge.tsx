import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded border px-2.5 py-0.5 text-xs font-medium tracking-wider transition-colors',
  {
    variants: {
      variant: {
        default: 'border-border bg-muted text-muted-foreground',
        success: 'border-forest/40 bg-forest/10 text-forest',
        warning: 'border-gold/50 bg-gold/10 text-gold/90',
        danger: 'border-burgundy/40 bg-burgundy/10 text-burgundy',
        accent: 'border-navy/40 bg-navy/10 text-navy',
        gold: 'border-gold/50 bg-gold/15 text-gold/90',
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
