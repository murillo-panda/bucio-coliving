import { describe, expect, it } from 'vitest'
import { movementsToCsv } from './export.js'

describe('movementsToCsv', () => {
  it('incluye usuario y fechas de auditoría y escapa conceptos', () => {
    const csv = movementsToCsv([{
      occurredAt: '2026-08-01T12:00:00.000Z',
      createdAt: '2026-08-01T12:00:00.000Z',
      concept: 'Reserva, habitación 2',
      type: 'Ingreso',
      amount: 100,
      createdByLabel: 'Migración inicial',
    }])
    expect(csv).toContain('Fecha efectiva,Fecha de creación')
    expect(csv).toContain('"Reserva, habitación 2"')
    expect(csv).toContain('Migración inicial')
  })
})
