import { hasValidSession } from '../lib/auth.mjs'
import { json } from '../lib/http.mjs'
import { readCashMovements } from '../lib/google-sheets.mjs'

export async function handler(event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Método no permitido.' })
  if (!hasValidSession(event)) return json(401, { error: 'La sesión ha caducado.' })

  try {
    const movements = await readCashMovements()
    return json(200, { movements, updatedAt: new Date().toISOString() })
  } catch (error) {
    console.error('Google Sheets error:', error.message)
    return json(500, { error: 'No se pudo consultar la hoja de caja.' })
  }
}
