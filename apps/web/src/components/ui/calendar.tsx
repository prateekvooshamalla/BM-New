import * as React from 'react';
import { DayPicker } from 'react-day-picker';
import 'react-day-picker/style.css';
import { cn } from '@/lib/utils';

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

export function Calendar({ className, ...props }: CalendarProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-3 text-sm', className)}>
      <DayPicker {...props} />
    </div>
  );
}
