import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useOutletContext,
} from 'react-router-dom'
import {
  buildCashSnapshot,
  filterRowsByDateRange,
  formatCurrency,
  formatDate,
  formatPeriod,
  sortRowsNewestFirst,
} from './lib/cash.js'
import {
  createMovement,
  createReceiptSignedUrl,
  listMovements,
  loadWorkspace,
  requestAdminUsers,
  reverseMovement,
} from './lib/cashRepository.js'
import { downloadMovementsCsv } from './lib/export.js'
import { compressReceipt, formatFileSize } from './lib/images.js'
import { requireSupabase, supabase } from './lib/supabase.js'
import { appConfig, isDemoMode } from './config/app.js'
import brandLogo from './assets/brand-logo.png'
import brandMark from './assets/brand-mark.png'
import styles from './App.module.css'

const roleLabels = {
  admin: 'Administrador',
  operator: 'Operador',
  viewer: 'Consulta',
}

function toLocalIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function toLocalDateTimeInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function currentMonthRange() {
  const today = new Date()
  return {
    from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
    to: toLocalIsoDate(today),
  }
}

function formatDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(appConfig.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: appConfig.timeZone,
  }).format(new Date(value))
}

function useSession() {
  const [state, setState] = useState(() => ({
    status: isDemoMode
      ? (sessionStorage.getItem('demo-session') ? 'authenticated' : 'guest')
      : (supabase ? 'checking' : 'guest'),
    session: isDemoMode && sessionStorage.getItem('demo-session')
      ? { user: { id: 'demo-user', email: 'demo' }, access_token: 'demo' }
      : null,
  }))

  useEffect(() => {
    if (isDemoMode) return undefined
    if (!supabase) return undefined

    requireSupabase().auth.getSession().then(({ data }) => {
      setState({ status: data.session ? 'authenticated' : 'guest', session: data.session })
    })
    const { data: listener } = requireSupabase().auth.onAuthStateChange((_event, nextSession) => {
      setState({ status: nextSession ? 'authenticated' : 'guest', session: nextSession })
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const login = useCallback(async (email, password) => {
    if (isDemoMode) {
      if (email !== 'demo' || password !== 'demo') throw new Error('Usuario o contraseña incorrectos.')
      sessionStorage.setItem('demo-session', 'true')
      setState({
        status: 'authenticated',
        session: { user: { id: 'demo-user', email: 'demo' }, access_token: 'demo' },
      })
      return
    }

    const result = await requireSupabase().auth.signInWithPassword({ email, password })
    if (result.error) throw new Error(result.error.message)
    setState({ status: 'authenticated', session: result.data.session })
  }, [])

  const logout = useCallback(async () => {
    if (isDemoMode) {
      sessionStorage.removeItem('demo-session')
    } else if (supabase) {
      await supabase.auth.signOut()
    }
    setState({ status: 'guest', session: null })
  }, [])

  return { ...state, login, logout }
}

function LoginPage({ onLogin }) {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await onLogin(email.trim(), password)
      navigate('/', { replace: true })
    } catch (loginError) {
      setError(loginError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className={styles.loginPage}>
      <section className={styles.loginCard} aria-labelledby="login-title">
        <img className={styles.loginLogo} src={brandLogo} alt={appConfig.appName} />
        <p className={styles.eyebrow}>{appConfig.moduleName}</p>
        <h1 id="login-title">Acceder</h1>
        <p className={styles.loginIntro}>Gestiona los ingresos, egresos y saldos de {appConfig.organizationName}.</p>
        <form className={styles.loginForm} onSubmit={handleSubmit}>
          <label>
            Correo electrónico
            <input
              autoComplete="email"
              inputMode="email"
              type={isDemoMode ? 'text' : 'email'}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            Contraseña
            <input
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
          <button className={styles.primaryButton} disabled={submitting} type="submit">
            {submitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
        {isDemoMode ? (
          <p className={styles.demoHint}>Vista local: usuario <strong>demo</strong>, contraseña <strong>demo</strong>.</p>
        ) : !supabase ? (
          <p className={styles.formError} role="alert">Falta configurar la conexión con Supabase.</p>
        ) : null}
      </section>
    </main>
  )
}

function SetPasswordPage({ sessionState }) {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (sessionState.status === 'checking') return <FullPageStatus text="Validando invitación…" />
  if (sessionState.status !== 'authenticated') return <Navigate to="/login" replace />

  async function handleSubmit(event) {
    event.preventDefault()
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres.')
      return
    }
    if (password !== confirmation) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setSubmitting(true)
    setError('')
    const result = await requireSupabase().auth.updateUser({ password })
    setSubmitting(false)
    if (result.error) {
      setError(result.error.message)
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <main className={styles.loginPage}>
      <section className={styles.loginCard} aria-labelledby="password-title">
        <img className={styles.loginLogo} src={brandLogo} alt={appConfig.appName} />
        <p className={styles.eyebrow}>Invitación aceptada</p>
        <h1 id="password-title">Crea tu contraseña</h1>
        <p className={styles.loginIntro}>Usarás esta contraseña junto con tu correo electrónico.</p>
        <form className={styles.loginForm} onSubmit={handleSubmit}>
          <label>Nueva contraseña<input autoComplete="new-password" minLength="8" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <label>Repetir contraseña<input autoComplete="new-password" minLength="8" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
          {error ? <p className={styles.formError} role="alert">{error}</p> : null}
          <button className={styles.primaryButton} disabled={submitting} type="submit">{submitting ? 'Guardando…' : 'Guardar contraseña'}</button>
        </form>
      </section>
    </main>
  )
}

function ProtectedRoute({ status }) {
  const location = useLocation()
  if (status === 'checking') return <FullPageStatus text="Comprobando acceso…" />
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

function enrichDemoMovements(movements) {
  return movements.map((movement) => ({
    ...movement,
    occurredAt: `${movement.date}T12:00:00.000Z`,
    createdAt: `${movement.date}T12:00:00.000Z`,
    createdBy: 'demo-user',
    createdByLabel: movement.id === 'demo-1' ? 'Migración inicial' : 'Usuario Demo',
    reversalOf: null,
    reversalReason: null,
    receipt: null,
  }))
}

function useCashData(session, onUnauthorized) {
  const [state, setState] = useState({
    status: 'loading',
    movements: [],
    workspace: null,
    updatedAt: null,
    error: '',
  })

  const load = useCallback(async () => {
    setState((current) => ({ ...current, status: 'loading', error: '' }))
    try {
      if (isDemoMode) {
        const { demoMovements } = await import('./data/demoMovements.js')
        setState({
          status: 'success',
          movements: enrichDemoMovements(demoMovements),
          workspace: {
            organization: { id: 'demo-org', name: appConfig.organizationName, slug: appConfig.organizationSlug },
            account: { id: 'demo-cash', name: appConfig.cashAccountName, currency: appConfig.currency },
            role: 'admin',
          },
          updatedAt: new Date().toISOString(),
          error: '',
        })
        return
      }

      const workspace = await loadWorkspace(session.user.id)
      const movements = await listMovements(workspace.account.id)
      setState({ status: 'success', movements, workspace, updatedAt: new Date().toISOString(), error: '' })
    } catch (error) {
      if (/jwt|session|auth/i.test(error.message)) onUnauthorized()
      setState((current) => ({ ...current, status: 'error', error: error.message }))
    }
  }, [onUnauthorized, session.user.id])

  useEffect(() => {
    const timeoutId = window.setTimeout(load, 0)
    return () => window.clearTimeout(timeoutId)
  }, [load])

  const addMovement = useCallback(async (input) => {
    if (isDemoMode) {
      const occurredAt = new Date(input.occurredAt).toISOString()
      const movement = {
        id: `demo-${crypto.randomUUID()}`,
        date: occurredAt.slice(0, 10),
        occurredAt,
        createdAt: new Date().toISOString(),
        concept: input.concept.trim(),
        type: input.type,
        amount: Number(input.amount),
        createdBy: 'demo-user',
        createdByLabel: 'Usuario Demo',
        reversalOf: null,
        reversalReason: null,
        receipt: input.receipt ? { id: 'demo-receipt', original_name: input.receipt.name, size_bytes: input.receipt.size } : null,
      }
      setState((current) => ({ ...current, movements: [...current.movements, movement], updatedAt: new Date().toISOString() }))
      return
    }
    await createMovement({ workspace: state.workspace, ...input })
    await load()
  }, [load, state.workspace])

  const annulMovement = useCallback(async (movementId, reason) => {
    if (isDemoMode) {
      setState((current) => {
        const original = current.movements.find((movement) => movement.id === movementId)
        if (!original) return current
        const now = new Date().toISOString()
        const reversal = {
          ...original,
          id: `demo-${crypto.randomUUID()}`,
          date: now.slice(0, 10),
          occurredAt: now,
          createdAt: now,
          concept: `Anulación: ${original.concept}`,
          type: original.type === 'Ingreso' ? 'Egreso' : 'Ingreso',
          createdByLabel: 'Usuario Demo',
          reversalOf: original.id,
          reversalReason: reason,
          receipt: null,
        }
        return { ...current, movements: [...current.movements, reversal], updatedAt: now }
      })
      return
    }
    await reverseMovement(movementId, reason)
    await load()
  }, [load])

  return { ...state, reload: load, addMovement, annulMovement }
}

function AppShell({ session, onLogout }) {
  const cashData = useCashData(session, onLogout)
  const snapshot = useMemo(() => buildCashSnapshot(cashData.movements), [cashData.movements])
  const role = cashData.workspace?.role

  return (
    <div className={styles.appShell}>
      <header className={styles.topbar}>
        <NavLink className={styles.brand} to="/" aria-label={`${appConfig.appName}, ${appConfig.moduleName}, inicio`}>
          <img className={styles.brandImage} src={brandMark} alt="" />
          <span>
            <strong>{appConfig.appName}</strong>
            <small>{appConfig.moduleName}</small>
          </span>
        </NavLink>
        <div className={styles.topbarActions}>
          <span className={styles.userIdentity}>{session.user.email}</span>
          <button className={styles.secondaryButton} onClick={cashData.reload} type="button">Actualizar</button>
          <button className={styles.textButton} onClick={onLogout} type="button">Salir</button>
        </div>
      </header>
      <nav className={styles.navigation} aria-label="Navegación principal">
        <NavItem to="/" end>Home</NavItem>
        <NavItem to="/movimientos">Movimientos</NavItem>
        <NavItem to="/diario">Diario</NavItem>
        <NavItem to="/mensual">Mensual</NavItem>
        <NavItem to="/anual">Anual</NavItem>
        {role === 'admin' ? <NavItem to="/admin/usuarios">Usuarios</NavItem> : null}
      </nav>
      <main className={styles.mainContent}>
        {cashData.status === 'loading' && !cashData.workspace ? (
          <ContentStatus title="Cargando información" text="Estamos consultando la caja." />
        ) : null}
        {cashData.status === 'error' ? (
          <ContentStatus
            title="No se pudieron cargar los datos"
            text={cashData.error}
            action={<button className={styles.primaryButton} onClick={cashData.reload} type="button">Reintentar</button>}
          />
        ) : null}
        {cashData.status !== 'error' && cashData.workspace ? (
          <>
            {isDemoMode ? <p className={styles.sourceNotice}>Modo demo: los cambios se borran al recargar.</p> : null}
            <Outlet context={{ ...cashData, snapshot, session }} />
          </>
        ) : null}
      </main>
    </div>
  )
}

function NavItem({ children, ...props }) {
  return (
    <NavLink {...props} className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}>
      {children}
    </NavLink>
  )
}

function HomePage() {
  const { snapshot, updatedAt } = useOutletContext()
  const latestMonth = snapshot.monthly.at(-1)
  const recent = [...snapshot.movements].reverse().slice(0, 8)

  return (
    <>
      <PageHeading
        eyebrow="Resumen"
        title="Estado actual de la caja"
        description={updatedAt ? `Datos consultados ${formatDateTime(updatedAt)}` : ''}
      />
      <section className={styles.metricsGrid} aria-label="Indicadores de caja">
        <MetricCard label="Saldo actual" value={formatCurrency(snapshot.currentBalance)} tone="primary" />
        <MetricCard label="Ingresos del último mes" value={formatCurrency(latestMonth?.income || 0)} tone="positive" />
        <MetricCard label="Egresos del último mes" value={formatCurrency(latestMonth?.expense || 0)} tone="negative" />
        <MetricCard label="Flujo neto del último mes" value={formatCurrency(latestMonth?.net || 0)} />
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><p className={styles.eyebrow}>Actividad reciente</p><h2>Últimos movimientos</h2></div>
          <span className={styles.recordCount}>{snapshot.movements.length} registros</span>
        </div>
        {recent.length ? <MovementsTable rows={recent} /> : <EmptyReportState text="Todavía no hay movimientos." />}
      </section>
    </>
  )
}

function MovementPage() {
  const { snapshot, workspace, addMovement, annulMovement } = useOutletContext()
  const canWrite = workspace.role === 'admin' || workspace.role === 'operator'
  const [form, setForm] = useState({ type: 'Ingreso', concept: '', amount: '', occurredAt: toLocalDateTimeInput() })
  const [receipt, setReceipt] = useState(null)
  const [message, setMessage] = useState({ tone: '', text: '' })
  const [submitting, setSubmitting] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [annulling, setAnnulling] = useState(null)
  const [annulReason, setAnnulReason] = useState('')
  const rows = [...snapshot.movements].reverse()

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const formElement = event.currentTarget
    setSubmitting(true)
    setMessage({ tone: '', text: '' })
    try {
      const compressedReceipt = receipt ? await compressReceipt(receipt) : null
      await addMovement({ ...form, receipt: compressedReceipt })
      setForm({ type: form.type, concept: '', amount: '', occurredAt: toLocalDateTimeInput() })
      setReceipt(null)
      formElement.reset()
      setFormOpen(false)
      setMessage({
        tone: 'success',
        text: compressedReceipt
          ? `Movimiento guardado. Comprobante comprimido a ${formatFileSize(compressedReceipt.size)}.`
          : 'Movimiento guardado correctamente.',
      })
    } catch (error) {
      setMessage({ tone: 'error', text: error.message })
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmAnnulment(event) {
    event.preventDefault()
    if (!annulling || !annulReason.trim()) return
    setSubmitting(true)
    try {
      await annulMovement(annulling.id, annulReason)
      setAnnulling(null)
      setAnnulReason('')
      setMessage({ tone: 'success', text: 'Movimiento anulado mediante un contramovimiento auditable.' })
    } catch (error) {
      setMessage({ tone: 'error', text: error.message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <PageHeading
        eyebrow="Operaciones"
        title="Movimientos de caja"
        description="Registra ingresos y egresos. Los movimientos no se editan ni se eliminan."
        balance={snapshot.currentBalance}
      />
      {canWrite ? (
        <details
          className={`${styles.panel} ${styles.formPanel} ${styles.movementDisclosure}`}
          open={formOpen}
          onToggle={(event) => setFormOpen(event.currentTarget.open)}
        >
          <summary className={styles.movementSummary}>
            <span>
              <span className={styles.eyebrow}>Nuevo registro</span>
              <strong>Agregar movimiento</strong>
            </span>
            <span className={styles.movementSummaryHint}>{formOpen ? 'Ocultar' : 'Abrir formulario'}</span>
            <span className={styles.filterChevron} aria-hidden="true" />
          </summary>
          <form className={styles.movementForm} onSubmit={handleSubmit}>
            <label><span>Tipo</span><select value={form.type} onChange={(event) => updateField('type', event.target.value)}><option>Ingreso</option><option>Egreso</option></select></label>
            <label className={styles.fieldWide}><span>Concepto</span><input value={form.concept} onChange={(event) => updateField('concept', event.target.value)} maxLength="180" required /></label>
            <label><span>Importe</span><input inputMode="decimal" min="0.01" step="0.01" type="number" value={form.amount} onChange={(event) => updateField('amount', event.target.value)} required /></label>
            <label><span>Fecha y hora efectiva</span><input type="datetime-local" value={form.occurredAt} onChange={(event) => updateField('occurredAt', event.target.value)} required /></label>
            <label className={styles.fieldWide}><span>Comprobante opcional</span><input accept="image/*" capture="environment" type="file" onChange={(event) => setReceipt(event.target.files?.[0] || null)} /><small>Se convierte a WebP y se intenta reducir a un máximo aproximado de 350 KB antes de subirlo.</small></label>
            <div className={`${styles.formActions} ${styles.fieldWide}`}>
              <button className={styles.primaryButton} disabled={submitting} type="submit">{submitting ? 'Guardando…' : 'Guardar movimiento'}</button>
            </div>
          </form>
        </details>
      ) : <p className={styles.sourceNotice}>Tu rol es de consulta. Puedes ver y exportar, pero no crear movimientos.</p>}
      {message.text ? <p className={message.tone === 'error' ? styles.formError : styles.successMessage} role="status">{message.text}</p> : null}
      {annulling ? (
        <section className={`${styles.panel} ${styles.annulPanel}`} aria-labelledby="annul-title">
          <form onSubmit={confirmAnnulment}>
            <h2 id="annul-title">Anular “{annulling.concept}”</h2>
            <p>Se creará un movimiento contrario por {formatCurrency(annulling.amount)}. El registro original permanecerá visible.</p>
            <label><span>Motivo obligatorio</span><textarea value={annulReason} onChange={(event) => setAnnulReason(event.target.value)} minLength="5" required /></label>
            <div className={styles.formActions}><button className={styles.dangerButton} disabled={submitting} type="submit">Confirmar anulación</button><button className={styles.filterButton} onClick={() => setAnnulling(null)} type="button">Cancelar</button></div>
          </form>
        </section>
      ) : null}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div><p className={styles.eyebrow}>Historial auditable</p><h2>Todos los movimientos</h2></div>
          <button className={styles.filterButton} onClick={() => downloadMovementsCsv(rows)} type="button">Descargar CSV</button>
        </div>
        {rows.length ? <AuditMovementsTable rows={rows} role={workspace.role} onAnnul={setAnnulling} /> : <EmptyReportState text="Todavía no hay movimientos." />}
      </section>
    </>
  )
}

function AuditMovementsTable({ rows, role, onAnnul }) {
  const reversedIds = new Set(rows.map((row) => row.reversalOf).filter(Boolean))

  async function openReceipt(receipt) {
    if (!receipt?.storage_path || isDemoMode) return
    const url = await createReceiptSignedUrl(receipt.storage_path)
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className={styles.auditList}>
      {rows.map((row) => {
        const isReversed = reversedIds.has(row.id)
        return (
          <article className={styles.auditCard} key={row.id}>
            <div className={styles.auditMain}>
              <div><TypeBadge type={row.type} />{row.reversalOf ? <span className={styles.auditFlag}>Contramovimiento</span> : null}{isReversed ? <span className={styles.auditFlag}>Anulado</span> : null}</div>
              <h3>{row.concept}</h3>
              <p>Efectivo: {formatDateTime(row.occurredAt)} · Registrado: {formatDateTime(row.createdAt)}</p>
              <p>Usuario: {row.createdByLabel}</p>
              {row.reversalReason ? <p>Motivo: {row.reversalReason}</p> : null}
            </div>
            <div className={styles.auditAside}>
              <strong className={row.type === 'Egreso' ? styles.negativeText : styles.positiveText}>{formatCurrency(row.amount)}</strong>
              {row.receipt ? <button className={styles.inlineButton} onClick={() => openReceipt(row.receipt)} type="button">Ver comprobante</button> : null}
              {role === 'admin' && row.type !== 'Apertura' && !row.reversalOf && !isReversed ? <button className={styles.inlineDangerButton} onClick={() => onAnnul(row)} type="button">Anular</button> : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function AdminUsersPage() {
  const context = useOutletContext()
  const { workspace, session } = context
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({ email: '', displayName: '', role: 'operator' })
  const [state, setState] = useState({ loading: true, error: '', success: '' })

  const loadUsers = useCallback(async () => {
    if (isDemoMode) {
      setUsers([{ userId: 'demo-user', email: 'demo@local.test', displayName: 'Usuario Demo', role: 'admin', isActive: true }])
      setState({ loading: false, error: '', success: '' })
      return
    }
    try {
      const payload = await requestAdminUsers(session.access_token)
      setUsers(payload.users)
      setState((current) => ({ ...current, loading: false, error: '' }))
    } catch (error) {
      setState({ loading: false, error: error.message, success: '' })
    }
  }, [session.access_token])

  useEffect(() => {
    const timeoutId = window.setTimeout(loadUsers, 0)
    return () => window.clearTimeout(timeoutId)
  }, [loadUsers])

  if (workspace.role !== 'admin') return <Navigate to="/" replace />

  async function inviteUser(event) {
    event.preventDefault()
    if (isDemoMode) {
      setState({ loading: false, error: 'Las invitaciones están desactivadas en modo demo.', success: '' })
      return
    }
    setState({ loading: true, error: '', success: '' })
    try {
      await requestAdminUsers(session.access_token, { method: 'POST', body: JSON.stringify(form) })
      setForm({ email: '', displayName: '', role: 'operator' })
      await loadUsers()
      setState({ loading: false, error: '', success: 'Invitación enviada correctamente.' })
    } catch (error) {
      setState({ loading: false, error: error.message, success: '' })
    }
  }

  async function updateUser(userId, changes) {
    if (isDemoMode) return
    setState({ loading: true, error: '', success: '' })
    try {
      await requestAdminUsers(session.access_token, { method: 'PATCH', body: JSON.stringify({ userId, ...changes }) })
      await loadUsers()
      setState({ loading: false, error: '', success: 'Usuario actualizado.' })
    } catch (error) {
      setState({ loading: false, error: error.message, success: '' })
    }
  }

  return (
    <>
      <PageHeading eyebrow="Administración" title="Usuarios" description="Invita personas, asigna roles y desactiva accesos sin borrar su historial." />
      <section className={`${styles.panel} ${styles.formPanel}`}>
        <div className={styles.panelHeader}><div><p className={styles.eyebrow}>Nuevo acceso</p><h2>Invitar usuario</h2></div></div>
        <form className={styles.userForm} onSubmit={inviteUser}>
          <label><span>Nombre</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required /></label>
          <label><span>Correo</span><input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>
          <label><span>Rol</span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="operator">Operador</option><option value="viewer">Consulta</option><option value="admin">Administrador</option></select></label>
          <button className={styles.primaryButton} disabled={state.loading} type="submit">Enviar invitación</button>
        </form>
      </section>
      {state.error ? <p className={styles.formError} role="alert">{state.error}</p> : null}
      {state.success ? <p className={styles.successMessage} role="status">{state.success}</p> : null}
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div><p className={styles.eyebrow}>Accesos actuales</p><h2>Equipo</h2></div></div>
        <div className={styles.userList}>
          {users.map((user) => (
            <article className={styles.userCard} key={user.userId}>
              <div><h3>{user.displayName || user.email}</h3><p>{user.email}</p></div>
              <label><span>Rol</span><select value={user.role} disabled={isDemoMode || state.loading} onChange={(event) => updateUser(user.userId, { role: event.target.value })}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className={styles.toggleLabel}><input type="checkbox" checked={user.isActive} disabled={isDemoMode || state.loading} onChange={(event) => updateUser(user.userId, { isActive: event.target.checked })} /> Activo</label>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}

function ReportPage({ type }) {
  const { snapshot } = useOutletContext()
  const [dateRange, setDateRange] = useState(currentMonthRange)
  const config = {
    daily: { eyebrow: 'Detalle diario', title: 'Reporte diario', description: 'Ingresos, egresos y saldo por fecha.', rows: snapshot.daily },
    monthly: { eyebrow: 'Consolidado mensual', title: 'Reporte mensual', description: 'Resultado acumulado de cada mes.', rows: snapshot.monthly },
    annual: { eyebrow: 'Consolidado anual', title: 'Reporte anual', description: 'Resultado acumulado de cada año.', rows: snapshot.annual },
  }[type]
  const invalidRange = type === 'daily' && dateRange.from && dateRange.to && dateRange.from > dateRange.to
  const visibleRows = type === 'daily' && !invalidRange
    ? sortRowsNewestFirst(filterRowsByDateRange(config.rows, dateRange.from, dateRange.to))
    : config.rows

  function showAllDates() {
    setDateRange({ from: snapshot.daily.at(0)?.key || '', to: snapshot.daily.at(-1)?.key || '' })
  }

  return (
    <>
      <PageHeading eyebrow={config.eyebrow} title={config.title} description={config.description} balance={type === 'daily' ? snapshot.currentBalance : null} />
      {type === 'daily' ? <DateRangeFilter dateRange={dateRange} invalidRange={invalidRange} resultCount={visibleRows.length} onChange={setDateRange} onCurrentMonth={() => setDateRange(currentMonthRange())} onShowAll={showAllDates} onClear={() => setDateRange({ from: '', to: '' })} /> : null}
      <section className={styles.panel}>
        {invalidRange ? <EmptyReportState text="La fecha inicial no puede ser posterior a la fecha final." /> : visibleRows.length ? <ReportTable rows={visibleRows} type={type} movements={snapshot.movements} /> : <EmptyReportState text="No hay movimientos en el rango seleccionado." />}
      </section>
    </>
  )
}

function DateRangeFilter({ dateRange, invalidRange, resultCount, onChange, onCurrentMonth, onShowAll, onClear }) {
  function updateField(field, value) { onChange((current) => ({ ...current, [field]: value })) }
  const rangeLabel = dateRange.from && dateRange.to ? `${formatDate(dateRange.from)} – ${formatDate(dateRange.to)}` : dateRange.from ? `Desde ${formatDate(dateRange.from)}` : dateRange.to ? `Hasta ${formatDate(dateRange.to)}` : 'Todas las fechas'
  return (
    <details className={styles.dateFilter}>
      <summary className={styles.dateFilterSummary}>
        <span className={styles.filterSummaryCopy}><strong>Filtrar por fechas</strong><small>{rangeLabel}</small></span>
        <span className={`${styles.filterStatus} ${invalidRange ? styles.filterError : ''}`} aria-live="polite">{invalidRange ? 'Revisa las fechas' : `${resultCount} ${resultCount === 1 ? 'día' : 'días'}`}</span>
        <span className={styles.filterChevron} aria-hidden="true" />
      </summary>
      <div className={styles.dateFilterBody}>
        <div className={styles.dateFilterControls}>
          <div className={styles.dateFields}>
            <label className={styles.dateField}><span>Desde</span><input type="date" value={dateRange.from} onChange={(event) => updateField('from', event.target.value)} /></label>
            <label className={styles.dateField}><span>Hasta</span><input type="date" value={dateRange.to} onChange={(event) => updateField('to', event.target.value)} /></label>
          </div>
          <div className={styles.dateFilterActions}>
            <button className={`${styles.filterButton} ${styles.filterButtonPrimary}`} onClick={onCurrentMonth} type="button">Este mes</button>
            <button className={styles.filterButton} onClick={onShowAll} type="button">Todo</button>
            <button className={styles.filterButton} onClick={onClear} type="button">Limpiar</button>
          </div>
        </div>
        {invalidRange ? <p className={styles.filterValidation} role="alert">La fecha inicial no puede ser posterior a la fecha final.</p> : null}
      </div>
    </details>
  )
}

function PageHeading({ eyebrow, title, description, balance = null }) {
  return (
    <header className={`${styles.pageHeading} ${balance !== null ? styles.pageHeadingWithBalance : ''}`}>
      <div className={styles.pageHeadingCopy}><p className={styles.eyebrow}>{eyebrow}</p><h1>{title}</h1>{description ? <p>{description}</p> : null}</div>
      {balance !== null ? <aside className={styles.compactBalance} aria-label={`Saldo disponible: ${formatCurrency(balance)}`}><span>Saldo disponible</span><strong>{formatCurrency(balance)}</strong></aside> : null}
    </header>
  )
}

function MetricCard({ label, value, tone = 'neutral' }) {
  return <article className={`${styles.metricCard} ${styles[`metric_${tone}`]}`}><p>{label}</p><strong>{value}</strong></article>
}

function MovementsTable({ rows }) {
  return (
    <>
      <div className={styles.desktopTable}><div className={styles.tableScroller}><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th>Usuario</th><th className={styles.numeric}>Importe</th><th className={styles.numeric}>Saldo</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatDate(row.date)}</td><td>{row.concept}</td><td><TypeBadge type={row.type} /></td><td>{row.createdByLabel || '—'}</td><td className={styles.numeric}>{formatCurrency(row.amount)}</td><td className={styles.numeric}>{formatCurrency(row.balance)}</td></tr>)}</tbody></table></div></div>
      <div className={styles.mobileCards} aria-label="Últimos movimientos">{rows.map((row) => <article className={styles.movementCard} key={row.id}><header className={styles.mobileCardHeader}><div><time dateTime={row.date}>{formatDate(row.date)}</time><h3>{row.concept}</h3><small>{row.createdByLabel}</small></div><TypeBadge type={row.type} /></header><dl className={styles.cardMetrics}><CardMetric label="Importe" value={formatCurrency(row.amount)} tone={row.type === 'Ingreso' ? 'positive' : row.type === 'Egreso' ? 'negative' : 'neutral'} /><CardMetric label="Saldo" value={formatCurrency(row.balance)} emphasized /></dl></article>)}</div>
    </>
  )
}

function ReportTable({ rows, type, movements }) {
  const movementsByDay = type === 'daily' ? movements.reduce((groups, movement) => { const daily = groups.get(movement.date) || []; daily.push(movement); groups.set(movement.date, daily); return groups }, new Map()) : new Map()
  return (
    <>
      <div className={styles.desktopTable}><div className={styles.tableScroller}><table><thead><tr><th>Periodo</th>{type === 'daily' ? <th>Detalle del día</th> : null}<th className={styles.numeric}>Saldo inicial</th><th className={styles.numeric}>Ingresos</th><th className={styles.numeric}>Egresos</th><th className={styles.numeric}>Flujo neto</th><th className={styles.numeric}>Saldo final</th></tr></thead><tbody>{rows.map((row) => <tr key={row.key}><td className={styles.periodCell}>{formatPeriod(row.key, type)}</td>{type === 'daily' ? <td className={styles.detailsCell}><DailyMovementList movements={movementsByDay.get(row.key) || []} /></td> : null}<td className={styles.numeric}>{formatCurrency(row.opening)}</td><td className={`${styles.numeric} ${styles.positiveText}`}>{formatCurrency(row.income)}</td><td className={styles.numeric}>{formatCurrency(row.expense)}</td><td className={`${styles.numeric} ${row.net < 0 ? styles.negativeText : ''}`}>{formatCurrency(row.net)}</td><td className={`${styles.numeric} ${styles.balanceCell}`}>{formatCurrency(row.closing)}</td></tr>)}</tbody></table></div></div>
      <div className={styles.mobileCards} aria-label={`Reporte ${type}`}>{rows.map((row) => <article className={styles.reportCard} key={row.key}><header className={styles.reportCardHeader}><p>{type === 'daily' ? 'Día' : type === 'monthly' ? 'Mes' : 'Año'}</p><h3>{formatPeriod(row.key, type)}</h3></header>{type === 'daily' ? <section className={styles.mobileDetail}><h4>Detalle del día</h4><DailyMovementList movements={movementsByDay.get(row.key) || []} /></section> : null}<dl className={styles.cardMetrics}><CardMetric label="Saldo inicial" value={formatCurrency(row.opening)} /><CardMetric label="Ingresos" value={formatCurrency(row.income)} tone="positive" /><CardMetric label="Egresos" value={formatCurrency(row.expense)} tone="negative" /><CardMetric label="Flujo neto" value={formatCurrency(row.net)} tone={row.net < 0 ? 'negative' : 'neutral'} /><CardMetric label="Saldo final" value={formatCurrency(row.closing)} emphasized wide /></dl></article>)}</div>
    </>
  )
}

function DailyMovementList({ movements }) {
  return <ul className={styles.dailyDetailList}>{movements.map((movement) => <li className={styles.dailyDetailItem} key={movement.id}><span className={styles.dailyDetailConcept}>{movement.concept}</span><TypeBadge type={movement.type} /><span className={styles.dailyDetailAmount}>{formatCurrency(movement.amount)}</span></li>)}</ul>
}

function CardMetric({ label, value, tone = 'neutral', emphasized = false, wide = false }) {
  const toneClass = tone === 'positive' ? styles.positiveText : tone === 'negative' ? styles.negativeText : ''
  return <div className={`${styles.cardMetric} ${wide ? styles.cardMetricWide : ''}`}><dt>{label}</dt><dd className={`${toneClass} ${emphasized ? styles.cardMetricEmphasized : ''}`}>{value}</dd></div>
}

function EmptyReportState({ text }) { return <div className={styles.emptyReport} role="status"><h2>Sin resultados</h2><p>{text}</p></div> }

function TypeBadge({ type }) {
  const tone = type === 'Ingreso' ? styles.badgeIncome : type === 'Egreso' ? styles.badgeExpense : styles.badgeOpening
  return <span className={`${styles.badge} ${tone}`}>{type}</span>
}

function ContentStatus({ title, text, action }) { return <section className={styles.contentStatus}><h1>{title}</h1><p>{text}</p>{action}</section> }
function FullPageStatus({ text }) { return <main className={styles.fullPageStatus}><p>{text}</p></main> }

function App() {
  const session = useSession()
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={session.status === 'authenticated' ? <Navigate to="/" replace /> : <LoginPage onLogin={session.login} />} />
        <Route path="/set-password" element={<SetPasswordPage sessionState={session} />} />
        <Route element={<ProtectedRoute status={session.status} />}>
          <Route path="/" element={<AppShell session={session.session} onLogout={session.logout} />}>
            <Route index element={<HomePage />} />
            <Route path="movimientos" element={<MovementPage />} />
            <Route path="diario" element={<ReportPage type="daily" />} />
            <Route path="mensual" element={<ReportPage type="monthly" />} />
            <Route path="anual" element={<ReportPage type="annual" />} />
            <Route path="admin/usuarios" element={<AdminUsersPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
