const MAX_BYTES = 350 * 1024
const START_QUALITY = 0.78
const MIN_QUALITY = 0.42
const MAX_DIMENSION = 1600

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo comprimir el comprobante.'))),
      'image/webp',
      quality,
    )
  })
}

export async function compressReceipt(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('El comprobante debe ser una imagen.')

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
  let width = Math.max(1, Math.round(bitmap.width * scale))
  let height = Math.max(1, Math.round(bitmap.height * scale))
  let quality = START_QUALITY
  let blob

  for (let attempt = 0; attempt < 7; attempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false })
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
    blob = await canvasToBlob(canvas, quality)
    if (blob.size <= MAX_BYTES) break
    quality = Math.max(MIN_QUALITY, quality - 0.09)
    if (quality === MIN_QUALITY) {
      width = Math.max(1, Math.round(width * 0.84))
      height = Math.max(1, Math.round(height * 0.84))
    }
  }

  bitmap.close()
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'comprobante'}.webp`, {
    type: 'image/webp',
    lastModified: Date.now(),
  })
}

export function formatFileSize(bytes) {
  return `${Math.max(1, Math.round(Number(bytes || 0) / 1024))} KB`
}
