import * as React from 'react'
import useEmblaCarousel, { type UseEmblaCarouselType } from 'embla-carousel-react'
import { cn } from '@/lib/utils'

type CarouselApi = UseEmblaCarouselType[1]
type Ctx = { viewportRef: UseEmblaCarouselType[0]; api: CarouselApi; selected: number; count: number }
const CarouselContext = React.createContext<Ctx | null>(null)

/** Auto-advancing carousel with dot indicators (Embla). */
export function Carousel({ className, children, autoplayMs = 4500 }: React.PropsWithChildren<{ className?: string; autoplayMs?: number }>) {
  const [viewportRef, api] = useEmblaCarousel({ loop: true })
  const [selected, setSelected] = React.useState(0)
  const [count, setCount] = React.useState(0)

  React.useEffect(() => {
    if (!api) return
    const onSelect = () => setSelected(api.selectedScrollSnap())
    setCount(api.scrollSnapList().length)
    onSelect()
    api.on('select', onSelect)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = reduce ? undefined : window.setInterval(() => api.scrollNext(), autoplayMs)
    return () => { api.off('select', onSelect); if (t) window.clearInterval(t) }
  }, [api, autoplayMs])

  return (
    <CarouselContext.Provider value={{ viewportRef, api, selected, count }}>
      <div className={cn('relative', className)} role="region" aria-roledescription="carousel">{children}</div>
    </CarouselContext.Provider>
  )
}

function useCarousel() {
  const ctx = React.useContext(CarouselContext)
  if (!ctx) throw new Error('Carousel parts must be inside <Carousel>')
  return ctx
}

export function CarouselContent({ className, children }: React.PropsWithChildren<{ className?: string }>) {
  const { viewportRef } = useCarousel()
  return <div ref={viewportRef} className="overflow-hidden"><div className={cn('flex', className)}>{children}</div></div>
}

export function CarouselItem({ className, children }: React.PropsWithChildren<{ className?: string }>) {
  return <div role="group" aria-roledescription="slide" className={cn('min-w-0 shrink-0 grow-0 basis-full', className)}>{children}</div>
}

export function CarouselDots({ className }: { className?: string }) {
  const { api, selected, count } = useCarousel()
  return (
    <div className={cn('flex justify-center gap-2', className)}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Go to slide ${i + 1}`}
          aria-current={i === selected}
          onClick={() => api?.scrollTo(i)}
          className={cn('h-1.5 rounded-full transition-all cursor-pointer', i === selected ? 'w-6 bg-accent' : 'w-1.5 bg-border-strong hover:bg-muted-foreground')}
        />
      ))}
    </div>
  )
}
