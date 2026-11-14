import * as React from 'react'
import { cn } from '@/lib/utils'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'min-h-tap w-full rounded-2xl border-2 border-line bg-card px-4 text-body text-fg placeholder:text-sub focus-visible:border-accent focus-visible:outline-none [color-scheme:dark]',
        className,
      )}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
