import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded text-sm font-medium tracking-wide transition-all duration-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-navy text-white shadow-sm hover:bg-navy-light hover:shadow',
        secondary:
          'bg-transparent text-foreground border border-border hover:bg-muted/50 hover:border-muted-foreground/30',
        outline:
          'bg-transparent border border-border hover:bg-muted/30 hover:border-gold/50',
        ghost: 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        destructive:
          'bg-burgundy text-white hover:bg-burgundy-light shadow-sm',
        gold:
          'bg-gradient-to-r from-gold to-gold-muted text-white shadow-sm hover:shadow hover:from-gold/90 hover:to-gold-muted/90',
      },
      size: {
        default: 'h-10 px-5 py-2',
        sm: 'h-8 rounded px-4 text-xs tracking-wider',
        lg: 'h-11 px-8 text-sm',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
  VariantProps<typeof buttonVariants> { }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        type={type}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
