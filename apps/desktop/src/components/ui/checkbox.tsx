import * as React from 'react';

import { cn } from '@/lib/utils';

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onCheckedChange'> {
  onCheckedChange?: (checked: boolean) => void;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, onCheckedChange, onChange, ...props }, ref) => {
    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange?.(event);
      onCheckedChange?.(event.target.checked);
    };

    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'h-4 w-4 rounded border border-input bg-background',
          'text-navy accent-navy',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-gold/50',
          'transition-colors',
          className,
        )}
        onChange={handleChange}
        {...props}
      />
    );
  },
);
Checkbox.displayName = 'Checkbox';

export { Checkbox };
