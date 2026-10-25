const validTypes = new Set(['Ingreso', 'Egreso', 'Apertura'])

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function normalizeType(type, concept) {
  const normalized = String(type || '').trim().toLocaleLowerCase('es')
  const normalizedConcept = String(concept || '').trim().toLocaleLowerCase('es')

  if (normalized === 'apertura' || normalizedConcept.includes('saldo inicial')) return 'Apertura'
  if (normalized === 'ingreso') return 'Ingreso'
  if (normalized === 'egreso' || normalized === 'gasto') return 'Egreso'
  return ''
}

function normalizeMovements(source) {
  return source
    .map((movement, index) => {
      const type = normalizeType(movement.type, movement.concept)
      const amount = Math.abs(Number(movement.amount))

      return {
        id: movement.id || `movement-${index}`,
        date: String(movement.date || '').slice(0, 10),
        concept: String(movement.concept || '').trim(),
        type,
        amount: roundMoney(amount),
        sourceIndex: index,
      }
    })
    .filter((movement) => (
      /^\d{4}-\d{2}-\d{2}$/.test(movement.date)
      && movement.concept
      && validTypes.has(movement.type)
      && Number.isFinite(movement.amount)
    ))
    .sort((left, right) => (
      left.date.localeCompare(right.date) || left.sourceIndex - right.sourceIndex
    ))
}

function addBalances(movements) {
  let balance = 0

  return movements.map(({ sourceIndex: _sourceIndex, ...movement }) => {
    const balanceBefore = balance
    if (movement.type === 'Egreso') balance -= movement.amount
    else balance += movement.amount
    balance = roundMoney(balance)

    return { ...movement, balanceBefore, balance }
  })
}

function summarize(movements, keyForMovement) {
  const groups = new Map()

  movements.forEach((movement) => {
    const key = keyForMovement(movement)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(movement)
  })

  return [...groups.entries()].map(([key, rows]) => {
    const openingMovements = rows.filter((row) => row.type === 'Apertura')
    const income = rows
      .filter((row) => row.type === 'Ingreso')
      .reduce((total, row) => total + row.amount, 0)
    const expense = rows
      .filter((row) => row.type === 'Egreso')
      .reduce((total, row) => total + row.amount, 0)
    const opening = rows[0].balanceBefore
      + openingMovements.reduce((total, row) => total + row.amount, 0)
    const net = income - expense

    return {
      key,
      opening: roundMoney(opening),
      income: roundMoney(income),
      expense: roundMoney(expense),
      net: roundMoney(net),
      closing: roundMoney(opening + net),
    }
  })
}

export function buildCashSnapshot(source = []) {
  const movements = addBalances(normalizeMovements(source))

  return {
    movements,
    currentBalance: movements.at(-1)?.balance || 0,
    daily: summarize(movements, (movement) => movement.date),
    monthly: summarize(movements, (movement) => movement.date.slice(0, 7)),
    annual: summarize(movements, (movement) => movement.date.slice(0, 4)),
  }
}

export function formatCurrency(value) {
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
  }).format(value || 0)
}

export function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('es-ES').format(new Date(`${value}T12:00:00`))
}

export function formatPeriod(key, type) {
  if (type === 'annual') return key
  if (type === 'monthly') {
    const [year, month] = key.split('-').map(Number)
    const label = new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' })
      .format(new Date(year, month - 1, 1))
    return label.charAt(0).toUpperCase() + label.slice(1)
  }
  return formatDate(key)
}
