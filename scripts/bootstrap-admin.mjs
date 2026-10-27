import { createClient } from '@supabase/supabase-js'

const required = ['SUPABASE_URL', 'BOOTSTRAP_ADMIN_EMAIL']
for (const name of required) {
  if (!process.env[name]) throw new Error(`Falta la variable ${name}.`)
}
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!secretKey) throw new Error('Falta la variable SUPABASE_SECRET_KEY.')

const client = createClient(process.env.SUPABASE_URL, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const organizationName = process.env.ORGANIZATION_NAME || 'Bucio Coliving'
const organizationSlug = process.env.ORGANIZATION_SLUG || 'bucio-coliving'
const cashAccountName = process.env.CASH_ACCOUNT_NAME || 'Caja principal'
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL.toLowerCase()
const adminName = process.env.BOOTSTRAP_ADMIN_NAME || adminEmail.split('@')[0]

const { data: organization, error: organizationError } = await client
  .from('organizations')
  .upsert({ name: organizationName, slug: organizationSlug }, { onConflict: 'slug' })
  .select('id')
  .single()
if (organizationError) throw organizationError

const { error: accountError } = await client.from('cash_accounts').upsert({
  organization_id: organization.id,
  name: cashAccountName,
  currency: process.env.CURRENCY || 'EUR',
}, { onConflict: 'organization_id,name' })
if (accountError) throw accountError

const { data: usersPage, error: usersError } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 })
if (usersError) throw usersError
let user = usersPage.users.find((candidate) => candidate.email?.toLowerCase() === adminEmail)

if (!user) {
  const { data, error } = await client.auth.admin.inviteUserByEmail(adminEmail, {
    data: { display_name: adminName },
    redirectTo: process.env.SITE_URL ? `${process.env.SITE_URL}/set-password` : undefined,
  })
  if (error) throw error
  user = data.user
}

const { error: profileError } = await client.from('profiles').upsert({
  id: user.id,
  email: adminEmail,
  display_name: adminName,
})
if (profileError) throw profileError

const { error: memberError } = await client.from('organization_members').upsert({
  organization_id: organization.id,
  user_id: user.id,
  role: 'admin',
  is_active: true,
}, { onConflict: 'organization_id,user_id' })
if (memberError) throw memberError

console.log(`Administrador preparado para ${adminEmail} en ${organizationName}.`)
