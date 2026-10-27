import { ref, type Ref } from 'vue'

export function useMaskPainter(canvas: Ref<HTMLCanvasElement | null>) {
  const brush = ref(36)
  const erasing = ref(false)
  const ready = ref(false)
  const hasPaint = ref(false)
  let mask: HTMLCanvasElement | undefined
  let previous: { x: number; y: number } | undefined
  let pointer: number | undefined
  let history: ImageData[] = []

  function overlay(): void {
    const context = canvas.value?.getContext('2d')
    const data = mask?.getContext('2d')?.getImageData(0, 0, mask.width, mask.height)
    if (!context || !data) return
    hasPaint.value = data.data.some((value, index) => index % 4 === 0 && value > 0)
    for (let index = 0; index < data.data.length; index += 4) {
      const alpha = (data.data[index] ?? 0) * 0.5
      data.data[index] = 164
      data.data[index + 1] = 112
      data.data[index + 2] = 255
      data.data[index + 3] = alpha
    }
    context.putImageData(data, 0, 0)
  }
  async function initialize(image: HTMLImageElement, savedMask?: string): Promise<void> {
    const target = canvas.value
    if (!target) return
    ready.value = false
    history = []
    const ratio = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight))
    target.width = Math.max(1, Math.round(image.naturalWidth * ratio))
    target.height = Math.max(1, Math.round(image.naturalHeight * ratio))
    mask = document.createElement('canvas')
    mask.width = target.width
    mask.height = target.height
    const context = mask.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.fillStyle = 'black'
    context.fillRect(0, 0, mask.width, mask.height)
    if (savedMask) {
      const restored = new Image()
      restored.src = savedMask
      await restored.decode()
      context.drawImage(restored, 0, 0, mask.width, mask.height)
    }
    overlay()
    ready.value = true
  }
  function paint(event: PointerEvent): void {
    const target = canvas.value
    const context = mask?.getContext('2d')
    if (!target || !mask || !context || pointer !== event.pointerId) return
    const rect = target.getBoundingClientRect()
    const next = {
      x: ((event.clientX - rect.left) * target.width) / rect.width,
      y: ((event.clientY - rect.top) * target.height) / rect.height,
    }
    const size = (brush.value * target.width) / rect.width
    context.strokeStyle = context.fillStyle = erasing.value ? 'black' : 'white'
    context.lineWidth = size
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.beginPath()
    context.moveTo(previous?.x ?? next.x, previous?.y ?? next.y)
    context.lineTo(next.x, next.y)
    context.stroke()
    context.beginPath()
    context.arc(next.x, next.y, size / 2, 0, Math.PI * 2)
    context.fill()
    previous = next
    overlay()
  }
  function start(event: PointerEvent): void {
    if (!ready.value || event.button !== 0 || pointer !== undefined) return
    const snapshot = mask?.getContext('2d')?.getImageData(0, 0, mask.width, mask.height)
    if (snapshot) {
      history.push(snapshot)
      if (history.length > 8) history.shift()
    }
    pointer = event.pointerId
    canvas.value?.setPointerCapture(event.pointerId)
    paint(event)
  }
  function end(event: PointerEvent): void {
    if (event.pointerId !== pointer) return
    canvas.value?.releasePointerCapture(event.pointerId)
    pointer = undefined
    previous = undefined
  }
  function undo(): void {
    const snapshot = history.pop()
    if (snapshot) {
      mask?.getContext('2d')?.putImageData(snapshot, 0, 0)
      overlay()
    }
  }
  function clear(): void {
    if (!mask) return
    const context = mask.getContext('2d')
    if (context) {
      history.push(context.getImageData(0, 0, mask.width, mask.height))
      if (history.length > 8) history.shift()
      context.fillStyle = 'black'
      context.fillRect(0, 0, mask.width, mask.height)
    }
    overlay()
  }
  async function exportMask(): Promise<Blob | null> {
    if (!mask || !hasPaint.value) return null
    const target = mask
    return new Promise((resolve) => target.toBlob(resolve, 'image/png'))
  }
  return { brush, erasing, ready, hasPaint, initialize, start, paint, end, undo, clear, exportMask }
}
