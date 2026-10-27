export const RECEIPT_TARGET_BYTES = 350 * 1024
export const RECEIPT_MAX_BYTES = 2 * 1024 * 1024

const START_QUALITY = 0.8
const MIN_QUALITY = 0.4
const QUALITY_STEP = 0.12
const DIMENSION_STEP = 0.82
const MAX_DIMENSION = 1600
const MIN_DIMENSION = 320
const MAX_ATTEMPTS = 18

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo comprimir el comprobante.'))),
      type,
      quality,
    )
  })
}

async function encodeCanvas(canvas, quality) {
  const webp = await canvasToBlob(canvas, 'image/webp', quality)
  if (webp.type === 'image/webp') return { blob: webp, extension: 'webp' }

  const jpeg = await canvasToBlob(canvas, 'image/jpeg', quality)
  if (jpeg.type !== 'image/jpeg') {
    throw new Error('Este navegador no permite convertir la imagen del comprobante.')
  }
  return { blob: jpeg, extension: 'jpg' }
}

function imageElementSource(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => resolve({
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(objectUrl),
    })
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('No se pudo leer esta imagen. Prueba a seleccionarla nuevamente.'))
    }
    image.src = objectUrl
  })
}

async function loadImageSource(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close(),
      }
    } catch {
      // Some mobile browsers can display camera formats they cannot decode as an ImageBitmap.
    }
  }

  return imageElementSource(file)
}

export function nextReceiptCompressionStep({ width, height, quality }) {
  if (quality > MIN_QUALITY) {
    return {
      width,
      height,
      quality: Math.max(MIN_QUALITY, quality - QUALITY_STEP),
    }
  }

  const largestDimension = Math.max(width, height)
  if (largestDimension <= MIN_DIMENSION) return { width, height, quality }

  const scale = Math.max(MIN_DIMENSION / largestDimension, DIMENSION_STEP)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality,
  }
}

function receiptBaseName(fileName) {
  return fileName.replace(/\.[^.]+$/, '') || 'comprobante'
}

export async function compressReceipt(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('El comprobante debe ser una imagen.')

  let image
  try {
    image = await loadImageSource(file)
  } catch (error) {
    throw new Error(error.message || 'No se pudo leer la imagen del comprobante.')
  }

  const scale = Math.min(1, MAX_DIMENSION / Math.max(image.width, image.height))
  let settings = {
    width: Math.max(1, Math.round(image.width * scale)),
    height: Math.max(1, Math.round(image.height * scale)),
    quality: START_QUALITY,
  }
  let encoded

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = settings.width
      canvas.height = settings.height
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('Este navegador no permite procesar la imagen del comprobante.')

      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, settings.width, settings.height)
      context.drawImage(image.source, 0, 0, settings.width, settings.height)
      encoded = await encodeCanvas(canvas, settings.quality)
      if (encoded.blob.size <= RECEIPT_TARGET_BYTES) break

      const nextSettings = nextReceiptCompressionStep(settings)
      if (
        nextSettings.width === settings.width
        && nextSettings.height === settings.height
        && nextSettings.quality === settings.quality
      ) break
      settings = nextSettings
    }
  } finally {
    image.close()
  }

  if (!encoded || encoded.blob.size > RECEIPT_MAX_BYTES) {
    throw new Error('La imagen sigue siendo demasiado grande. Prueba a tomar la foto un poco más cerca del recibo.')
  }

  return new File(
    [encoded.blob],
    `${receiptBaseName(file.name)}.${encoded.extension}`,
    {
      type: encoded.blob.type,
      lastModified: Date.now(),
    },
  )
}

export function formatFileSize(bytes) {
  return `${Math.max(1, Math.round(Number(bytes || 0) / 1024))} KB`
}
