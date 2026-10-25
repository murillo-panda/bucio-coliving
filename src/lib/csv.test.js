import { describe, expect, it } from 'vitest'
import { parseCashCsv } from './csv.js'

describe('parseCashCsv', () => {
  it('lee las columnas de caja e ignora el saldo publicado', () => {
    const csv = [
      'Fecha,Concepto,Tipo,Importe,Saldo Acumulado',
      '01/08/2026,Saldo Inicial,Ingreso,"310,00","310,00"',
      '02/08/2026,"Reserva, habitación 2",Ingreso,"100,50","410,50"',
      '03/08/2026,Limpieza,Egreso,"20,25","390,25"',
    ].join('\n')

    expect(parseCashCsv(csv)).toEqual([
      { id: 'csv-2', date: '2026-08-01', concept: 'Saldo Inicial', type: 'Apertura', amount: 310 },
      { id: 'csv-3', date: '2026-08-02', concept: 'Reserva, habitación 2', type: 'Ingreso', amount: 100.5 },
      { id: 'csv-4', date: '2026-08-03', concept: 'Limpieza', type: 'Egreso', amount: 20.25 },
    ])
  })

  it('descarta filas vacías o incompatibles', () => {
    const csv = 'Fecha,Concepto,Tipo,Importe\n,Vacío,Ingreso,10\n02/08/2026,Otro,Desconocido,20'
    expect(parseCashCsv(csv)).toEqual([])
  })
})
