import { createClient } from '@supabase/supabase-js'

export function createServerClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!process.env.SUPABASE_URL || !secretKey) {
    throw new Error('Faltan SUPABASE_URL o SUPABASE_SECRET_KEY.')
  }
  return createClient(process.env.SUPABASE_URL, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function requireAdmin(client, event) {
  const token = event.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) throw Object.assign(new Error('Sesión requerida.'), { statusCode: 401 })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw Object.assign(new Error('Sesión inválida.'), { statusCode: 401 })

  const slug = process.env.ORGANIZATION_SLUG || 'bucio-coliving'
  const { data: organization, error: organizationError } = await client
    .from('organizations')
    .select('id, name')
    .eq('slug', slug)
    .single()
  if (organizationError) throw organizationError

  const { data: member, error: memberError } = await client
    .from('organization_members')
    .select('role, is_active')
    .eq('organization_id', organization.id)
    .eq('user_id', data.user.id)
    .single()
  if (memberError || !member?.is_active || !['owner', 'admin'].includes(member.role)) {
    throw Object.assign(new Error('Se requiere el rol administrador.'), { statusCode: 403 })
  }
  return { user: data.user, organization, role: member.role }
}
