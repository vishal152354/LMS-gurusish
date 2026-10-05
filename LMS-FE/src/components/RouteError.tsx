import { Link, useRouteError } from 'react-router'
import { Button } from '@/components/ui/button'
import { Brand } from './Brand'

export function RouteError({ notFound }: { notFound?: boolean }) {
  const error = useRouteError() as Error | undefined
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 text-center">
      <Brand />
      <h1 className="font-display text-3xl font-semibold">{notFound ? 'Page not found' : 'Something went wrong'}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        {notFound ? 'That address doesn’t exist in Pariksha.' : error?.message || 'An unexpected error occurred.'}
      </p>
      <Button asChild><Link to="/">Back to sign in</Link></Button>
    </div>
  )
}
