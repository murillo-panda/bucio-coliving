import { appConfig } from '../config/app.js'
import { createClientId } from './ids.js'
import { requireSupabase } from './supabase.js'

const typeFromDatabase = {
  opening: 'Apertura',
  income: 'Ingreso',
  expense: 'Egreso',
}

const typeToDatabase = {
  Apertura: 'opening',
  Ingreso: 'income',
  Egreso: 'expense',
}

function throwIfError(error) {
  if (error) throw new Error(error.message)
}

function throwIfReceiptUploadError(error) {
  if (!error) return
  if (/maximum allowed size|exceeded.*size|too large/i.test(error.message || '')) {
    throw new Error('La imagen supera el tamaño permitido. Prueba a seleccionarla nuevamente para volver a comprimirla.')
  }
  throwIfError(error)
}

function firstRelatedRecord(value) {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

export function mapMovement(row) {
  const creator = Array.isArray(row.creator) ? row.creator[0] : row.creator
  const receipt = firstRelatedRecord(row.receipts)
  const visibility = firstRelatedRecord(row.visibility)

  return {
    id: row.id,
    date: row.occurred_at.slice(0, 10),
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    concept: row.concept,
    type: typeFromDatabase[row.movement_type] || row.movement_type,
    amount: Number(row.amount),
    createdBy: row.created_by,
    createdByLabel: creator?.display_name || creator?.email || row.created_by_label || 'Migración inicial',
    reversalOf: row.reversal_of,
    reversalReason: row.reversal_reason,
    receipt,
    isHidden: Boolean(visibility?.is_hidden),
    visibilityReason: visibility?.reason || '',
    visibilityUpdatedAt: visibility?.updated_at || null,
  }
}

export async function loadWorkspace(userId) {
  const client = requireSupabase()
  const organizationResult = await client
    .from('organizations')
    .select('id, name, slug')
    .eq('slug', appConfig.organizationSlug)
    .single()
  throwIfError(organizationResult.error)

  const organization = organizationResult.data
  const [membershipResult, accountResult] = await Promise.all([
    client
      .from('organization_members')
      .select('role, is_active')
      .eq('organization_id', organization.id)
      .eq('user_id', userId)
      .single(),
    client
      .from('cash_accounts')
      .select('id, name, currency')
      .eq('organization_id', organization.id)
      .eq('is_active', true)
      .order('created_at')
      .limit(1)
      .single(),
  ])
  throwIfError(membershipResult.error)
  throwIfError(accountResult.error)

  if (!membershipResult.data.is_active) {
    throw new Error('Tu acceso a esta organización está desactivado.')
  }

  return {
    organization,
    account: accountResult.data,
    role: membershipResult.data.role,
  }
}

export async function listMovements(accountId) {
  const client = requireSupabase()
  const result = await client
    .from('cash_movements')
    .select(`
      id, occurred_at, created_at, concept, movement_type, amount,
      created_by, created_by_label, reversal_of, reversal_reason,
      creator:profiles!cash_movements_created_by_fkey(display_name, email),
      receipts:movement_receipts(id, storage_path, original_name, content_type, size_bytes),
      visibility:cash_movement_visibility(is_hidden, reason, updated_at)
    `)
    .eq('cash_account_id', accountId)
    .order('occurred_at', { ascending: true })
    .order('created_at', { ascending: true })
  throwIfError(result.error)
  return result.data.map(mapMovement)
}

export async function createMovement({ workspace, type, concept, amount, occurredAt, receipt }) {
  const client = requireSupabase()
  const movementResult = await client
    .from('cash_movements')
    .insert({
      organization_id: workspace.organization.id,
      cash_account_id: workspace.account.id,
      movement_type: typeToDatabase[type],
      concept: concept.trim(),
      amount: Number(amount),
      occurred_at: new Date(occurredAt).toISOString(),
      source: 'app',
    })
    .select('id')
    .single()
  throwIfError(movementResult.error)

  if (receipt) {
    await attachMovementReceipt({ workspace, movementId: movementResult.data.id, receipt })
  }

  return movementResult.data.id
}

export async function attachMovementReceipt({ workspace, movementId, receipt }) {
  const client = requireSupabase()
  const now = new Date()
  const year = String(now.getUTCFullYear())
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const extension = receipt.type === 'image/webp' ? 'webp' : 'jpg'
  const storagePath = `${workspace.organization.id}/${year}/${month}/${movementId}-${createClientId()}.${extension}`
  const uploadResult = await client.storage
    .from('receipts')
    .upload(storagePath, receipt, { contentType: receipt.type, upsert: false })
  throwIfReceiptUploadError(uploadResult.error)

  const receiptResult = await client.from('movement_receipts').insert({
    organization_id: workspace.organization.id,
    movement_id: movementId,
    storage_path: storagePath,
    original_name: receipt.name || 'comprobante.webp',
    content_type: receipt.type,
    size_bytes: receipt.size,
  })
  throwIfError(receiptResult.error)
  return receiptResult.data
}

export async function reverseMovement(movementId, reason) {
  const client = requireSupabase()
  const result = await client.rpc('reverse_cash_movement', {
    target_movement_id: movementId,
    reason: reason.trim(),
  })
  throwIfError(result.error)
  return result.data
}

export async function setMovementVisibility(movementId, hidden, reason) {
  const client = requireSupabase()
  const result = await client.rpc('set_cash_movement_visibility', {
    target_movement_id: movementId,
    should_hide: hidden,
    reason: reason.trim(),
  })
  throwIfError(result.error)
  return result.data
}

export async function createReceiptSignedUrl(storagePath) {
  const client = requireSupabase()
  const result = await client.storage.from('receipts').createSignedUrl(storagePath, 60)
  throwIfError(result.error)
  return result.data.signedUrl
}

export async function requestAdminUsers(accessToken, options = {}) {
  const response = await fetch('/api/admin-users', {
    ...options,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || 'No se pudo completar la gestión de usuarios.')
  return payload
}
