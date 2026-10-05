import { Toaster as Sonner, type ToasterProps } from 'sonner'

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="top-right"
      offset={{ top: 76, right: 16 }}
      mobileOffset={{ top: 72 }}
      richColors
      closeButton
      toastOptions={{ style: { background: 'var(--color-popover)', border: '1px solid var(--color-border-strong)' } }}
      {...props}
    />
  )
}
