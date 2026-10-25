import { createSessionCookie, credentialsAreValid } from '../lib/auth.mjs'
import { json } from '../lib/http.mjs'

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Método no permitido.' })

  try {
    const { username = '', password = '' } = JSON.parse(event.body || '{}')
    if (!credentialsAreValid(username, password)) {
      return json(401, { error: 'Usuario o contraseña incorrectos.' })
    }

    return json(200, { authenticated: true }, {
      'Set-Cookie': createSessionCookie(username),
    })
  } catch (error) {
    console.error('Login error:', error.message)
    return json(500, { error: 'No se pudo iniciar sesión.' })
  }
}
