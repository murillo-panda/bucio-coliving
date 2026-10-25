import { describe, expect, it } from 'vitest'
import { buildCashSnapshot, filterRowsByDateRange, formatPeriod } from './cash.js'

const movements = [
  { id: '1', date: '2026-01-01', concept: 'Saldo inicial', type: 'Ingreso', amount: 310 },
  { id: '2', date: '2026-01-01', concept: 'Reserva', type: 'Ingreso', amount: 100 },
  { id: '3', date: '2026-01-02', concept: 'Compra', type: 'Egreso', amount: 40 },
  { id: '4', date: '2026-02-01', concept: 'Reserva', type: 'Ingreso', amount: 50 },
]

describe('buildCashSnapshot', () => {
  it('usa el saldo inicial como apertura y no como ingreso', () => {
    const snapshot = buildCashSnapshot(movements)

    expect(snapshot.movements[0].type).toBe('Apertura')
    expect(snapshot.currentBalance).toBe(420)
    expect(snapshot.annual[0]).toMatchObject({
      opening: 310,
      income: 150,
      expense: 40,
      net: 110,
      closing: 420,
    })
  })

  it('calcula saldos de apertura y cierre diarios y mensuales', () => {
    const snapshot = buildCashSnapshot(movements)

    expect(snapshot.daily[0]).toMatchObject({ opening: 310, closing: 410 })
    expect(snapshot.daily[1]).toMatchObject({ opening: 410, closing: 370 })
    expect(snapshot.monthly[0]).toMatchObject({ opening: 310, closing: 370 })
    expect(snapshot.monthly[1]).toMatchObject({ opening: 370, closing: 420 })
  })

  it('mantiene el orden original entre movimientos del mismo día', () => {
    const snapshot = buildCashSnapshot([movements[1], movements[0]])
    expect(snapshot.movements.map((movement) => movement.id)).toEqual(['2', '1'])
  })
})

describe('formatPeriod', () => {
  it('formatea los meses en español', () => {
    expect(formatPeriod('2026-02', 'monthly')).toBe('Febrero de 2026')
  })
})

describe('filterRowsByDateRange', () => {
  const rows = [
    { key: '2026-01-01' },
    { key: '2026-01-15' },
    { key: '2026-02-01' },
  ]

  it('incluye los límites del rango seleccionado', () => {
    expect(filterRowsByDateRange(rows, '2026-01-01', '2026-01-15')).toEqual(rows.slice(0, 2))
  })

  it('permite rangos abiertos y mostrar todo', () => {
    expect(filterRowsByDateRange(rows, '2026-01-15', '')).toEqual(rows.slice(1))
    expect(filterRowsByDateRange(rows)).toEqual(rows)
  })
})
