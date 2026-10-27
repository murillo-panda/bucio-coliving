import { describe, expect, it } from 'vitest'
import { buildHistoricalRows } from './import.js'

describe('buildHistoricalRows', () => {
  it('usa la misma fecha del movimiento como fecha efectiva y de creación', () => {
    const rows = buildHistoricalRows({
      movements: [{ id: 'csv-2', date: '2026-08-01', concept: 'Saldo inicial', type: 'Apertura', amount: 310 }],
      organizationId: 'org-1',
      accountId: 'cash-1',
    })

    expect(rows[0]).toMatchObject({
      occurred_at: '2026-08-01T12:00:00.000Z',
      created_at: '2026-08-01T12:00:00.000Z',
      created_by: null,
      created_by_label: 'Migración inicial',
    })
  })

  it('omite referencias previamente importadas', () => {
    const rows = buildHistoricalRows({
      movements: [{ id: 'csv-2', date: '2026-08-01', concept: 'Reserva', type: 'Ingreso', amount: 100 }],
      organizationId: 'org-1',
      accountId: 'cash-1',
      existingReferences: new Set(['google-sheets:csv-2']),
    })
    expect(rows).toEqual([])
  })
})
