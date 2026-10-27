import { createClient } from '@supabase/supabase-js'
import { parseCashCsv } from '../src/lib/csv.js'
import { buildHistoricalRows } from '../src/lib/import.js'

const required = ['SUPABASE_URL', 'GOOGLE_SHEET_CSV_URL']
for (const name of required) {
  if (!process.env[name]) throw new Error(`Falta la variable ${name}.`)
}
const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!secretKey) throw new Error('Falta la variable SUPABASE_SECRET_KEY.')

const client = createClient(process.env.SUPABASE_URL, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const organizationSlug = process.env.ORGANIZATION_SLUG || 'bucio-coliving'
const cashAccountName = process.env.CASH_ACCOUNT_NAME || 'Caja principal'

const response = await fetch(process.env.GOOGLE_SHEET_CSV_URL, { cache: 'no-store' })
if (!response.ok) throw new Error(`Google Sheets respondió ${response.status}.`)
const parsed = parseCashCsv(await response.text())
if (!parsed.length) throw new Error('No se encontraron movimientos válidos en el CSV.')

const { data: organization, error: organizationError } = await client
  .from('organizations')
  .select('id')
  .eq('slug', organizationSlug)
  .single()
if (organizationError) throw organizationError

const { data: account, error: accountError } = await client
  .from('cash_accounts')
  .select('id')
  .eq('organization_id', organization.id)
  .eq('name', cashAccountName)
  .single()
if (accountError) throw accountError

const references = parsed.map((movement) => `google-sheets:${movement.id}`)
const { data: existing, error: existingError } = await client
  .from('cash_movements')
  .select('source_reference')
  .eq('organization_id', organization.id)
  .in('source_reference', references)
if (existingError) throw existingError
const existingReferences = new Set(existing.map((movement) => movement.source_reference))

const rows = buildHistoricalRows({
  movements: parsed,
  organizationId: organization.id,
  accountId: account.id,
  existingReferences,
})

if (rows.length) {
  const { error: insertError } = await client.from('cash_movements').insert(rows)
  if (insertError) throw insertError
}

console.log(`Importación terminada: ${rows.length} nuevos, ${parsed.length - rows.length} ya existentes.`)
