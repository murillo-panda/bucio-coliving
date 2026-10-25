function parseRows(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const nextCharacter = text[index + 1]

    if (character === '"' && quoted && nextCharacter === '"') {
      field += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && nextCharacter === '\n') index += 1
      row.push(field)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  row.push(field)
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function columnIndex(headers, names, fallback) {
  const index = headers.findIndex((header) => names.includes(normalizeHeader(header)))
  return index === -1 ? fallback : index
}

function parseDate(value) {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (!match) return ''
  const [, day, month, year] = match
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function parseAmount(value) {
  const text = String(value || '').replace(/[€\s]/g, '')
  const normalized = text.includes(',')
    ? text.replace(/\./g, '').replace(',', '.')
    : text
  return Math.abs(Number(normalized))
}

function normalizeType(value, concept) {
  const type = String(value || '').trim().toLocaleLowerCase('es')
  const normalizedConcept = String(concept || '').trim().toLocaleLowerCase('es')
  if (type === 'apertura' || normalizedConcept.includes('saldo inicial')) return 'Apertura'
  if (type === 'ingreso') return 'Ingreso'
  if (type === 'egreso' || type === 'gasto') return 'Egreso'
  return ''
}

export function parseCashCsv(text) {
  const rows = parseRows(String(text || '').replace(/^\uFEFF/, ''))
  if (rows.length < 2) return []

  const headers = rows[0]
  const dateIndex = columnIndex(headers, ['fecha'], 0)
  const conceptIndex = columnIndex(headers, ['concepto', 'descripcion'], 1)
  const typeIndex = columnIndex(headers, ['tipo'], 2)
  const amountIndex = columnIndex(headers, ['importe', 'monto', 'cantidad'], 3)

  return rows.slice(1).map((row, index) => {
    const concept = String(row[conceptIndex] || '').trim()
    return {
      id: `csv-${index + 2}`,
      date: parseDate(row[dateIndex]),
      concept,
      type: normalizeType(row[typeIndex], concept),
      amount: parseAmount(row[amountIndex]),
    }
  }).filter((movement) => (
    movement.date
    && movement.concept
    && movement.type
    && Number.isFinite(movement.amount)
  ))
}

export async function fetchCashCsv(csvUrl) {
  if (!csvUrl) throw new Error('Falta configurar la URL publicada de Google Sheets.')
  const url = new URL(csvUrl)
  url.searchParams.set('_actualizado', String(Date.now()))

  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error('No se pudo consultar Google Sheets.')
  const movements = parseCashCsv(await response.text())
  if (!movements.length) throw new Error('Google Sheets no contiene movimientos válidos.')
  return movements
}
