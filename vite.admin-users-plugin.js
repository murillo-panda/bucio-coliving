const maxBodyBytes = 1024 * 1024

async function readRequestBody(request) {
  const chunks = []
  let size = 0

  for await (const chunk of request) {
    size += chunk.length
    if (size > maxBodyBytes) throw new Error('La solicitud supera el tamaño permitido.')
    chunks.push(chunk)
  }

  return Buffer.concat(chunks).toString('utf8')
}

function sendFunctionResponse(response, result) {
  response.statusCode = result.statusCode || 500
  for (const [name, value] of Object.entries(result.headers || {})) {
    response.setHeader(name, value)
  }
  response.end(result.body || '')
}

export function createAdminUsersApiPlugin(handler) {
  return {
    name: 'local-admin-users-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split('?')[0]
        if (pathname !== '/api/admin-users') {
          next()
          return
        }

        try {
          const body = ['GET', 'HEAD', 'OPTIONS'].includes(request.method || '')
            ? ''
            : await readRequestBody(request)
          const result = await handler({
            httpMethod: request.method || 'GET',
            headers: request.headers,
            body,
          })
          sendFunctionResponse(response, result)
        } catch (error) {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ error: error.message || 'No se pudo ejecutar la función local.' }))
        }
      })
    },
  }
}
