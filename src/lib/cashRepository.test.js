import { describe, expect, it } from 'vitest'
import { mapMovement } from './cashRepository.js'

const baseRow = {
  id: 'movement-1',
  occurred_at: '2026-10-27T10:00:00.000Z',
  created_at: '2026-10-27T10:01:00.000Z',
  concept: 'Compra de prueba',
  movement_type: 'expense',
  amount: '12.50',
  created_by: 'user-1',
  created_by_label: null,
  reversal_of: null,
  reversal_reason: null,
  creator: { display_name: 'Rodolfo Ortiz', email: 'rodolfo@example.com' },
}

describe('mapMovement', () => {
  it('conserva el comprobante cuando Supabase devuelve una relación individual como objeto', () => {
    const receipt = { id: 'receipt-1', storage_path: 'org/receipt.webp' }

    expect(mapMovement({ ...baseRow, receipts: receipt }).receipt).toEqual(receipt)
  })

  it('mantiene compatibilidad con relaciones devueltas como array o sin comprobante', () => {
    const receipt = { id: 'receipt-1', storage_path: 'org/receipt.webp' }

    expect(mapMovement({ ...baseRow, receipts: [receipt] }).receipt).toEqual(receipt)
    expect(mapMovement({ ...baseRow, receipts: null }).receipt).toBeNull()
  })

  it('normaliza la visibilidad tanto si Supabase devuelve objeto como array', () => {
    const visibility = { is_hidden: true, reason: 'Registro de prueba', updated_at: '2026-10-27T11:00:00.000Z' }

    expect(mapMovement({ ...baseRow, receipts: null, visibility }).isHidden).toBe(true)
    expect(mapMovement({ ...baseRow, receipts: null, visibility: [visibility] }).visibilityReason).toBe('Registro de prueba')
    expect(mapMovement({ ...baseRow, receipts: null, visibility: null }).isHidden).toBe(false)
  })
})
