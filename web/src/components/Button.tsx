import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const base =
  'inline-flex items-center justify-center gap-2 rounded-md font-sans text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

const sizes = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4',
}

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand/90',
  secondary: 'bg-ink text-text border border-line hover:border-text-dim',
  ghost: 'text-text-dim hover:text-text hover:bg-panel-raised',
  danger: 'bg-danger-dim text-danger border border-danger/30 hover:bg-danger/15',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: keyof typeof sizes
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className = '', ...props },
  ref,
) {
  return <button ref={ref} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />
})
