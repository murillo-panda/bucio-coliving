import { describe, expect, it, vi } from 'vitest'
import { createClientId } from './ids.js'

describe('createClientId', () => {
  it('usa randomUUID cuando el navegador lo permite', () => {
    const randomUUID = vi.fn(() => 'native-uuid')

    expect(createClientId({ randomUUID })).toBe('native-uuid')
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('genera un UUID con getRandomValues en conexiones HTTP móviles', () => {
    const cryptoProvider = {
      getRandomValues(bytes) {
        bytes.forEach((_, index) => {
          bytes[index] = index
        })
        return bytes
      },
    }

    expect(createClientId(cryptoProvider)).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
  })

  it('mantiene un fallback para navegadores antiguos', () => {
    expect(createClientId(null)).toMatch(/^[a-z0-9]+-[a-z0-9]+$/)
  })
})
