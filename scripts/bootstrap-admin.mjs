import { createClient } from '@supabase/supabase-js'

const required = ['SUPABASE_URL']
for (const name of required) {
  if (!process.env[name]) throw new Error(`Falta la variable ${name}.`)
}
const ownerEmailValue = process.env.BOOTSTRAP_OWNER_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL
if (!ownerEmailValue) throw new Error('Falta la variable BOOTSTRAP_OWNER_EMAIL.')
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!secretKey) throw new Error('Falta la variable SUPABASE_SECRET_KEY.')

const client = createClient(process.env.SUPABASE_URL, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const organizationName = process.env.ORGANIZATION_NAME || 'Bucio Coliving'
const organizationSlug = process.env.ORGANIZATION_SLUG || 'bucio-coliving'
const cashAccountName = process.env.CASH_ACCOUNT_NAME || 'Caja principal'
const ownerEmail = ownerEmailValue.toLowerCase()
const ownerName = process.env.BOOTSTRAP_OWNER_NAME || process.env.BOOTSTRAP_ADMIN_NAME || ownerEmail.split('@')[0]

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
let user = usersPage.users.find((candidate) => candidate.email?.toLowerCase() === ownerEmail)

if (!user) {
  const { data, error } = await client.auth.admin.inviteUserByEmail(ownerEmail, {
    data: { display_name: ownerName },
    redirectTo: process.env.SITE_URL ? `${process.env.SITE_URL}/set-password` : undefined,
  })
  if (error) throw error
  user = data.user
}

const { error: profileError } = await client.from('profiles').upsert({
  id: user.id,
  email: ownerEmail,
  display_name: ownerName,
})
if (profileError) throw profileError

const { data: configuredOrganization, error: ownerConfigurationError } = await client
  .from('organizations')
  .select('owner_user_id')
  .eq('id', organization.id)
  .single()
if (ownerConfigurationError) throw ownerConfigurationError
if (configuredOrganization.owner_user_id && configuredOrganization.owner_user_id !== user.id) {
  throw new Error('La organización ya tiene otro superusuario configurado.')
}

const { error: organizationOwnerError } = await client
  .from('organizations')
  .update({ owner_user_id: user.id })
  .eq('id', organization.id)
if (organizationOwnerError) throw organizationOwnerError

const { error: memberError } = await client.from('organization_members').upsert({
  organization_id: organization.id,
  user_id: user.id,
  role: 'owner',
  is_active: true,
}, { onConflict: 'organization_id,user_id' })
if (memberError) throw memberError

console.log(`Superusuario preparado para ${ownerEmail} en ${organizationName}.`)
