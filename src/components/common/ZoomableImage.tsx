'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { ExternalLink, Minimize2, ZoomIn, ZoomOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ZOOM_STEPS, scrollToKeepPoint, stepZoom, toggleZoom } from '@/lib/ui/image-zoom'

/**
 * An underlag image that can be read (fork bok.dalavs.se): fitted to its box
 * by default, a click zooms in where you clicked and a second click fits it
 * again; the buttons step the zoom and open the original in a new tab. The
 * rules (steps, click level, keeping the clicked point in place) live in
 * lib/ui/image-zoom.ts so every viewer behaves the same.
 */
export function ZoomableImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const fitWidth = useRef(0)
  const t = useTranslations('image_zoom')
  const [zoom, setZoom] = useState(1)

  useEffect(() => setZoom(1), [src])

  const applyZoom = (to: number, point?: { x: number; y: number }) => {
    const box = boxRef.current
    const img = imgRef.current
    const from = zoom
    const anchor = point ?? (box ? { x: box.clientWidth / 2, y: box.clientHeight / 2 } : { x: 0, y: 0 })
    let scroll = box ? { left: box.scrollLeft, top: box.scrollTop } : { left: 0, top: 0 }
    if (zoom === 1 && img && box) {
      // At fit the image is centred in the box: count the click from the image's
      // own edge (a negative scroll), so the zoom lands where the person clicked.
      const ir = img.getBoundingClientRect()
      const br = box.getBoundingClientRect()
      fitWidth.current = ir.width
      scroll = { left: br.left - ir.left, top: br.top - ir.top }
    }
    setZoom(to)
    requestAnimationFrame(() => {
      if (!box) return
      box.scrollLeft = scrollToKeepPoint({ pointInViewport: anchor.x, scroll: scroll.left, from, to })
      box.scrollTop = scrollToKeepPoint({ pointInViewport: anchor.y, scroll: scroll.top, from, to })
    })
  }

  const zoomed = zoom > 1
  return (
    <div className={cn('relative min-h-0', className)}>
      <div
        ref={boxRef}
        className={cn('h-full w-full overflow-auto rounded-lg border bg-background', !zoomed && 'flex items-start justify-center')}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          onClick={(e) => {
            const rect = boxRef.current?.getBoundingClientRect()
            applyZoom(toggleZoom(zoom), rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : undefined)
          }}
          className={cn('block', zoomed ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full object-contain cursor-zoom-in')}
          style={zoomed && fitWidth.current > 0 ? { width: `${Math.round(fitWidth.current * zoom)}px`, height: 'auto' } : undefined}
        />
      </div>
      <div className="absolute right-2 top-2 flex gap-1">
        <Button type="button" variant="secondary" size="icon-sm" aria-label={t('zoom_out')} disabled={!zoomed} onClick={() => applyZoom(stepZoom(zoom, -1))}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon-sm"
          aria-label={t('zoom_in')}
          disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
          onClick={() => applyZoom(stepZoom(zoom, 1))}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        {zoomed && (
          <Button type="button" variant="secondary" size="icon-sm" aria-label={t('fit')} onClick={() => applyZoom(1)}>
            <Minimize2 className="h-4 w-4" />
          </Button>
        )}
        <Button asChild variant="secondary" size="icon-sm" aria-label={t('open_new_tab')}>
          <a href={src} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4" />
          </a>
        </Button>
      </div>
    </div>
  )
}
