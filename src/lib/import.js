const movementTypes = { Apertura: 'opening', Ingreso: 'income', Egreso: 'expense' }

export function buildHistoricalRows({ movements, organizationId, accountId, existingReferences = new Set() }) {
  return movements.flatMap((movement, index) => {
    const sourceReference = `google-sheets:${movement.id}`
    if (existingReferences.has(sourceReference)) return []

    const historicalTimestamp = new Date(`${movement.date}T12:00:00.000Z`)
    historicalTimestamp.setUTCSeconds(index)
    return [{
      organization_id: organizationId,
      cash_account_id: accountId,
      movement_type: movementTypes[movement.type],
      concept: movement.concept,
      amount: movement.amount,
      occurred_at: historicalTimestamp.toISOString(),
      created_at: historicalTimestamp.toISOString(),
      created_by: null,
      created_by_label: 'Migración inicial',
      source: 'google_sheets_import',
      source_reference: sourceReference,
      source_sequence: index,
    }]
  })
}
