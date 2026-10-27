import { describe, expect, it } from 'vitest'
import {
  RECEIPT_MAX_BYTES,
  RECEIPT_TARGET_BYTES,
  formatFileSize,
  nextReceiptCompressionStep,
} from './images.js'

describe('receipt image limits', () => {
  it('mantiene un objetivo de 350 KB y un máximo de seguridad de 2 MB', () => {
    expect(RECEIPT_TARGET_BYTES).toBe(350 * 1024)
    expect(RECEIPT_MAX_BYTES).toBe(2 * 1024 * 1024)
  })

  it('reduce primero la calidad sin cambiar las dimensiones', () => {
    expect(nextReceiptCompressionStep({ width: 1600, height: 1200, quality: 0.8 })).toEqual({
      width: 1600,
      height: 1200,
      quality: 0.68,
    })
  })

  it('reduce las dimensiones cuando alcanza la calidad mínima', () => {
    expect(nextReceiptCompressionStep({ width: 1600, height: 1200, quality: 0.4 })).toEqual({
      width: 1312,
      height: 984,
      quality: 0.4,
    })
  })

  it('no reduce la dimensión mayor por debajo del mínimo legible', () => {
    expect(nextReceiptCompressionStep({ width: 340, height: 170, quality: 0.4 })).toEqual({
      width: 320,
      height: 160,
      quality: 0.4,
    })
  })
})

describe('formatFileSize', () => {
  it('formatea el tamaño del comprobante en KB', () => {
    expect(formatFileSize(350 * 1024)).toBe('350 KB')
  })
})
