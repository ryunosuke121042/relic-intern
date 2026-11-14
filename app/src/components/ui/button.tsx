import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex min-h-tap items-center justify-center gap-2 rounded-2xl px-5 text-body font-bold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-base hover:bg-accent/90',
        done: 'bg-done text-base hover:bg-done/90',
        outline: 'border-2 border-line bg-transparent text-fg hover:border-sub',
        quiet: 'bg-card text-fg hover:bg-line',
        link: 'px-2 text-accent underline-offset-4 hover:underline',
      },
      size: {
        default: '',
        wide: 'w-full',
      },
    },
    defaultVariants: { variant: 'primary', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
