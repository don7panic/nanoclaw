import * as React from 'react';

import { cn } from '@/lib/utils';

export function Separator({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return <div className={cn('h-px w-full bg-border', className)} {...props} />;
}
