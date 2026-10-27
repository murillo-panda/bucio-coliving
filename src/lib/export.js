function escapeCsv(value) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function movementsToCsv(movements) {
  const header = ['Fecha efectiva', 'Fecha de creación', 'Concepto', 'Tipo', 'Importe', 'Usuario', 'Anulación de', 'Motivo']
  const rows = movements.map((movement) => [
    movement.occurredAt || movement.date,
    movement.createdAt || '',
    movement.concept,
    movement.type,
    movement.amount,
    movement.createdByLabel || '',
    movement.reversalOf || '',
    movement.reversalReason || '',
  ])
  return [header, ...rows].map((row) => row.map(escapeCsv).join(',')).join('\n')
}

export function downloadMovementsCsv(movements, fileName = 'movimientos-caja.csv') {
  const blob = new Blob([`\uFEFF${movementsToCsv(movements)}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}
