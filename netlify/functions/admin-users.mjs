import { json } from '../lib/http.mjs'
import { createServerClient, requireAdmin } from '../lib/supabase.mjs'

const allowedRoles = new Set(['admin', 'operator', 'viewer'])

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {})
  if (!['GET', 'POST', 'PATCH'].includes(event.httpMethod)) return json(405, { error: 'Método no permitido.' })

  try {
    const client = createServerClient()
    const { user: actor, organization } = await requireAdmin(client, event)

    if (event.httpMethod === 'GET') {
      const { data, error } = await client
        .from('organization_members')
        .select('user_id, role, is_active, profiles!organization_members_user_id_fkey(email, display_name)')
        .eq('organization_id', organization.id)
        .order('created_at')
      if (error) throw error
      return json(200, {
        users: data.map((member) => ({
          userId: member.user_id,
          email: member.profiles?.email || '',
          displayName: member.profiles?.display_name || '',
          role: member.role,
          isActive: member.is_active,
        })),
      })
    }

    const payload = JSON.parse(event.body || '{}')
    if (event.httpMethod === 'POST') {
      const email = String(payload.email || '').trim().toLowerCase()
      const displayName = String(payload.displayName || '').trim()
      const role = String(payload.role || '')
      if (!email || !displayName || !allowedRoles.has(role)) return json(400, { error: 'Nombre, correo y rol válidos son obligatorios.' })

      const redirectTo = process.env.SITE_URL ? `${process.env.SITE_URL}/set-password` : undefined
      const { data: invitation, error: inviteError } = await client.auth.admin.inviteUserByEmail(email, {
        data: { display_name: displayName },
        redirectTo,
      })
      if (inviteError) throw inviteError
      const userId = invitation.user.id
      const { error: profileError } = await client.from('profiles').upsert({ id: userId, email, display_name: displayName })
      if (profileError) throw profileError
      const { error: memberError } = await client.from('organization_members').upsert({
        organization_id: organization.id,
        user_id: userId,
        role,
        is_active: true,
        invited_by: actor.id,
      }, { onConflict: 'organization_id,user_id' })
      if (memberError) throw memberError
      await client.from('audit_events').insert({
        organization_id: organization.id,
        actor_user_id: actor.id,
        action: 'member.invited',
        entity_type: 'organization_member',
        entity_id: userId,
        details: { role, email },
      })
      return json(201, { invited: true })
    }

    const userId = String(payload.userId || '')
    const changes = {}
    if (payload.role !== undefined) {
      if (!allowedRoles.has(payload.role)) return json(400, { error: 'Rol no válido.' })
      changes.role = payload.role
    }
    if (payload.isActive !== undefined) changes.is_active = Boolean(payload.isActive)
    if (!userId || !Object.keys(changes).length) return json(400, { error: 'No hay cambios válidos.' })
    if (userId === actor.id && changes.is_active === false) return json(400, { error: 'No puedes desactivar tu propia cuenta.' })

    const { data: target, error: targetError } = await client
      .from('organization_members')
      .select('role, is_active')
      .eq('organization_id', organization.id)
      .eq('user_id', userId)
      .single()
    if (targetError) throw targetError
    if (target.role === 'owner') {
      return json(403, { error: 'El superusuario no se puede modificar ni desactivar.' })
    }
    const removesActiveAdmin = target.role === 'admin' && target.is_active
      && ((changes.role && changes.role !== 'admin') || changes.is_active === false)
    if (removesActiveAdmin) {
      const { count, error: countError } = await client
        .from('organization_members')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', organization.id)
        .eq('role', 'admin')
        .eq('is_active', true)
      if (countError) throw countError
      if (count <= 1) return json(400, { error: 'La organización debe conservar al menos un administrador activo.' })
    }

    const { error: updateError } = await client
      .from('organization_members')
      .update(changes)
      .eq('organization_id', organization.id)
      .eq('user_id', userId)
    if (updateError) throw updateError
    await client.from('audit_events').insert({
      organization_id: organization.id,
      actor_user_id: actor.id,
      action: 'member.updated',
      entity_type: 'organization_member',
      entity_id: userId,
      details: changes,
    })
    return json(200, { updated: true })
  } catch (error) {
    console.error('Admin users error:', error.message)
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : 'No se pudo completar la gestión de usuarios.' })
  }
}
