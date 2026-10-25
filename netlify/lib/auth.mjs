import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

const COOKIE_NAME = 'hostel_session'
const SESSION_DURATION_SECONDS = 12 * 60 * 60

function encode(value) {
  return Buffer.from(value).toString('base64url')
}

function decode(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function digest(value) {
  return createHash('sha256').update(String(value)).digest()
}

function safeEqual(left, right) {
  return timingSafeEqual(digest(left), digest(right))
}

function sign(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function getRequiredEnvironment(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`)
  return value
}

export function credentialsAreValid(username, password) {
  return safeEqual(username, getRequiredEnvironment('APP_USERNAME'))
    && safeEqual(password, getRequiredEnvironment('APP_PASSWORD'))
}

export function createSessionCookie(username) {
  const secret = getRequiredEnvironment('SESSION_SECRET')
  const payload = encode(JSON.stringify({
    sub: username,
    exp: Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS,
  }))
  const token = `${payload}.${sign(payload, secret)}`

  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DURATION_SECONDS}`
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

export function hasValidSession(event) {
  try {
    const cookies = String(event.headers.cookie || event.headers.Cookie || '')
      .split(';')
      .map((cookie) => cookie.trim().split('='))
    const token = cookies.find(([name]) => name === COOKIE_NAME)?.slice(1).join('=')
    if (!token) return false

    const [payload, signature] = token.split('.')
    if (!payload || !signature) return false

    const expectedSignature = sign(payload, getRequiredEnvironment('SESSION_SECRET'))
    if (!safeEqual(signature, expectedSignature)) return false

    const session = JSON.parse(decode(payload))
    return typeof session.sub === 'string' && session.exp > Math.floor(Date.now() / 1000)
  } catch {
    return false
  }
}
