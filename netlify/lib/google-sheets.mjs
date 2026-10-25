import { createSign } from 'node:crypto'
import { fetchCashCsv } from '../../src/lib/csv.js'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly'

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function getRequiredEnvironment(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`)
  return value
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000)
  const header = encode({ alg: 'RS256', typ: 'JWT' })
  const claim = encode({
    iss: getRequiredEnvironment('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  })
  const unsignedToken = `${header}.${claim}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsignedToken)
  signer.end()
  const privateKey = getRequiredEnvironment('GOOGLE_PRIVATE_KEY').replace(/\\n/g, '\n')
  const assertion = `${unsignedToken}.${signer.sign(privateKey, 'base64url')}`

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  if (!response.ok) throw new Error(`Google rechazó la autenticación (${response.status}).`)
  const payload = await response.json()
  if (!payload.access_token) throw new Error('Google no devolvió un token de acceso.')
  return payload.access_token
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

function parseGoogleDate(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = Math.round((value - 25569) * 86400 * 1000)
    return new Date(milliseconds).toISOString().slice(0, 10)
  }

  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text

  const spanishDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (spanishDate) {
    const [, day, month, year] = spanishDate
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  }

  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10)
}

function parseAmount(value) {
  if (typeof value === 'number') return Math.abs(value)
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

function rowsToMovements(rows) {
  if (!rows.length) return []

  const headers = rows[0]
  const dateIndex = columnIndex(headers, ['fecha'], 0)
  const conceptIndex = columnIndex(headers, ['concepto', 'descripcion'], 1)
  const typeIndex = columnIndex(headers, ['tipo'], 2)
  const amountIndex = columnIndex(headers, ['importe', 'monto', 'cantidad'], 3)

  return rows.slice(1).map((row, index) => {
    const concept = String(row[conceptIndex] || '').trim()
    return {
      id: `sheet-${index + 2}`,
      date: parseGoogleDate(row[dateIndex]),
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

export async function readCashMovements() {
  if (process.env.GOOGLE_SHEET_CSV_URL) {
    return fetchCashCsv(process.env.GOOGLE_SHEET_CSV_URL)
  }

  const sheetId = getRequiredEnvironment('GOOGLE_SHEET_ID')
  const range = process.env.GOOGLE_SHEET_RANGE || 'Caja!A:D'
  const accessToken = await getAccessToken()
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`)
  url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE')
  url.searchParams.set('dateTimeRenderOption', 'SERIAL_NUMBER')

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`No se pudo leer Google Sheets (${response.status}).`)

  const payload = await response.json()
  return rowsToMovements(payload.values || [])
}
