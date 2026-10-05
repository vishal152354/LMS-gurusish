import { useCallback, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { ImagePlus, ZoomIn } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'

const OUTPUT = 256 // px — stored as a small JPEG data URL

async function cropToDataUrl(src: string, area: Area): Promise<string> {
  const img = new Image()
  img.src = src
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = OUTPUT
  canvas.height = OUTPUT
  canvas.getContext('2d')!.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, OUTPUT, OUTPUT)
  return canvas.toDataURL('image/jpeg', 0.88)
}

export function AvatarCropDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (dataUrl: string | null) => void }) {
  const [src, setSrc] = useState<string | null>(null)
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<Area | null>(null)
  const onComplete = useCallback((_: Area, px: Area) => setArea(px), [])

  function pick(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) return toast.error('Please choose an image file')
    if (file.size > 8 * 1024 * 1024) return toast.error('That image is over 8 MB')
    const reader = new FileReader()
    reader.onload = () => { setSrc(reader.result as string); setZoom(1); setCrop({ x: 0, y: 0 }) }
    reader.readAsDataURL(file)
  }

  async function save() {
    if (!src || !area) return
    onSave(await cropToDataUrl(src, area))
    onOpenChange(false)
    setSrc(null)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setSrc(null) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Profile photo</DialogTitle>
          <DialogDescription>Drag to position and use the slider to zoom. Saved on this device only.</DialogDescription>
        </DialogHeader>
        {src ? (
          <>
            <div className="relative h-72 overflow-hidden rounded-lg bg-black">
              <Cropper image={src} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false}
                onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onComplete} />
            </div>
            <div className="mt-4 flex items-center gap-3">
              <ZoomIn className="size-4 text-muted-foreground" aria-hidden="true" />
              <Slider min={1} max={3} step={0.01} value={[zoom]} onValueChange={([z]) => setZoom(z)} aria-label="Zoom" />
            </div>
          </>
        ) : (
          <label className="flex h-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border-strong text-sm text-muted-foreground hover:border-accent hover:text-foreground">
            <ImagePlus className="size-6" />
            Choose a photo
            <input type="file" accept="image/*" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => { onSave(null); onOpenChange(false) }}>Remove photo</Button>
          <Button onClick={save} disabled={!src || !area}>Save photo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
