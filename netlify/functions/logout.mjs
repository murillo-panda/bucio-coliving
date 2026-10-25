import { clearSessionCookie } from '../lib/auth.mjs'
import { json } from '../lib/http.mjs'

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido.' })
  return json(200, { authenticated: false }, { 'Set-Cookie': clearSessionCookie() })
}
