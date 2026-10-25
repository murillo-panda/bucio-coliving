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
  formatCurrency,
  formatDate,
  formatPeriod,
} from './lib/cash.js'
import { fetchCashCsv } from './lib/csv.js'
import styles from './App.module.css'

const API_BASE = '/api'
const DATA_SOURCE = import.meta.env.VITE_DATA_SOURCE || 'google-sheets-api'
const USE_DEMO_AUTH = import.meta.env.VITE_AUTH_MODE === 'demo'

async function requestJson(path, options) {
  const response = await fetch(`${API_BASE}/${path}`, {
    cache: 'no-store',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error || 'No se pudo completar la solicitud.')
    error.status = response.status
    throw error
  }
  return payload
}

function useSession() {
  const [status, setStatus] = useState(() => (
    USE_DEMO_AUTH
      ? (sessionStorage.getItem('demo-session') ? 'authenticated' : 'guest')
      : 'checking'
  ))

  useEffect(() => {
    if (USE_DEMO_AUTH) return

    requestJson('session')
      .then((payload) => setStatus(payload.authenticated ? 'authenticated' : 'guest'))
      .catch(() => setStatus('guest'))
  }, [])

  const login = useCallback(async (username, password) => {
    if (USE_DEMO_AUTH) {
      if (username !== 'demo' || password !== 'demo') {
        throw new Error('Usuario o contraseña incorrectos.')
      }
      sessionStorage.setItem('demo-session', 'true')
      setStatus('authenticated')
      return
    }

    await requestJson('login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })
    setStatus('authenticated')
  }, [])

  const logout = useCallback(async () => {
    if (USE_DEMO_AUTH) {
      sessionStorage.removeItem('demo-session')
    } else {
      await requestJson('logout', { method: 'POST' }).catch(() => {})
    }
    setStatus('guest')
  }, [])

  return { status, login, logout }
}

function LoginPage({ onLogin }) {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await onLogin(username.trim(), password)
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
        <div className={styles.brandMark} aria-hidden="true">RC</div>
        <p className={styles.eyebrow}>Control de caja</p>
        <h1 id="login-title">Acceder</h1>
        <p className={styles.loginIntro}>Consulta los ingresos, egresos y saldos del hostel.</p>

        <form className={styles.loginForm} onSubmit={handleSubmit}>
          <label>
            Usuario
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
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

        {USE_DEMO_AUTH ? (
          <p className={styles.demoHint}>Vista local: usuario <strong>demo</strong>, contraseña <strong>demo</strong>.</p>
        ) : null}
      </section>
    </main>
  )
}

function ProtectedRoute({ status }) {
  const location = useLocation()
  if (status === 'checking') return <FullPageStatus text="Comprobando acceso…" />
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

function useCashData(onUnauthorized) {
  const [state, setState] = useState({ status: 'loading', movements: [], updatedAt: null, error: '' })

  const load = useCallback(async () => {
    await Promise.resolve()
    setState((current) => ({ ...current, status: 'loading', error: '' }))
    try {
      let payload
      if (DATA_SOURCE === 'demo') {
        const { demoMovements } = await import('./data/demoMovements.js')
        payload = { movements: demoMovements, updatedAt: new Date().toISOString() }
      } else if (DATA_SOURCE === 'public-csv') {
        const movements = await fetchCashCsv(import.meta.env.VITE_GOOGLE_SHEETS_CSV_URL)
        payload = { movements, updatedAt: new Date().toISOString() }
      } else {
        payload = await requestJson('cash-data')
      }
      setState({ status: 'success', movements: payload.movements, updatedAt: payload.updatedAt, error: '' })
    } catch (error) {
      if (error.status === 401) onUnauthorized()
      setState((current) => ({ ...current, status: 'error', error: error.message }))
    }
  }, [onUnauthorized])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => load(), 0)
    return () => window.clearTimeout(timeoutId)
  }, [load])

  return { ...state, reload: load }
}

function AppShell({ onLogout }) {
  const cashData = useCashData(onLogout)
  const snapshot = useMemo(
    () => buildCashSnapshot(cashData.movements),
    [cashData.movements],
  )

  return (
    <div className={styles.appShell}>
      <header className={styles.topbar}>
        <NavLink className={styles.brand} to="/" aria-label="Control de caja, inicio">
          <span className={styles.brandMark} aria-hidden="true">RC</span>
          <span>
            <strong>Control de caja</strong>
            <small>Hostel</small>
          </span>
        </NavLink>
        <div className={styles.topbarActions}>
          <button className={styles.secondaryButton} onClick={cashData.reload} type="button">
            Actualizar
          </button>
          <button className={styles.textButton} onClick={onLogout} type="button">
            Salir
          </button>
        </div>
      </header>

      <nav className={styles.navigation} aria-label="Navegación principal">
        <NavItem to="/" end>Home</NavItem>
        <NavItem to="/diario">Diario</NavItem>
        <NavItem to="/mensual">Mensual</NavItem>
        <NavItem to="/anual">Anual</NavItem>
      </nav>

      <main className={styles.mainContent}>
        {cashData.status === 'loading' && !cashData.movements.length ? (
          <ContentStatus title="Cargando información" text="Estamos consultando la hoja de caja." />
        ) : null}
        {cashData.status === 'error' ? (
          <ContentStatus
            title="No se pudieron cargar los datos"
            text={cashData.error}
            action={<button className={styles.primaryButton} onClick={cashData.reload} type="button">Reintentar</button>}
          />
        ) : null}
        {cashData.status !== 'error' && cashData.movements.length ? (
          <>
            {DATA_SOURCE === 'demo' ? (
              <p className={styles.sourceNotice} role="status">
                Estás viendo datos ficticios. La versión publicada consultará Google Sheets después de cada login y recarga.
              </p>
            ) : null}
            <Outlet context={{ snapshot, updatedAt: cashData.updatedAt }} />
          </>
        ) : null}
        {cashData.status === 'success' && !cashData.movements.length ? (
          <ContentStatus title="Todavía no hay movimientos" text="Añade registros en la pestaña Caja de Google Sheets." />
        ) : null}
      </main>
    </div>
  )
}

function NavItem({ children, ...props }) {
  return (
    <NavLink
      {...props}
      className={({ isActive }) => `${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
    >
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
        description={updatedAt ? `Datos consultados ${new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(updatedAt))}` : ''}
      />
      <section className={styles.metricsGrid} aria-label="Indicadores de caja">
        <MetricCard label="Saldo actual" value={formatCurrency(snapshot.currentBalance)} tone="primary" />
        <MetricCard label="Ingresos del último mes" value={formatCurrency(latestMonth?.income || 0)} tone="positive" />
        <MetricCard label="Egresos del último mes" value={formatCurrency(latestMonth?.expense || 0)} tone="negative" />
        <MetricCard label="Flujo neto del último mes" value={formatCurrency(latestMonth?.net || 0)} />
      </section>
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.eyebrow}>Actividad reciente</p>
            <h2>Últimos movimientos</h2>
          </div>
          <span className={styles.recordCount}>{snapshot.movements.length} registros</span>
        </div>
        <MovementsTable rows={recent} />
      </section>
    </>
  )
}

function ReportPage({ type }) {
  const { snapshot } = useOutletContext()
  const config = {
    daily: { eyebrow: 'Detalle diario', title: 'Reporte diario', description: 'Ingresos, egresos y saldo por fecha.', rows: snapshot.daily },
    monthly: { eyebrow: 'Consolidado mensual', title: 'Reporte mensual', description: 'Resultado acumulado de cada mes.', rows: snapshot.monthly },
    annual: { eyebrow: 'Consolidado anual', title: 'Reporte anual', description: 'Resultado acumulado de cada año.', rows: snapshot.annual },
  }[type]

  return (
    <>
      <PageHeading eyebrow={config.eyebrow} title={config.title} description={config.description} />
      <section className={styles.panel}>
        <ReportTable rows={config.rows} type={type} movements={snapshot.movements} />
      </section>
    </>
  )
}

function PageHeading({ eyebrow, title, description }) {
  return (
    <header className={styles.pageHeading}>
      <p className={styles.eyebrow}>{eyebrow}</p>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </header>
  )
}

function MetricCard({ label, value, tone = 'neutral' }) {
  return (
    <article className={`${styles.metricCard} ${styles[`metric_${tone}`]}`}>
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  )
}

function MovementsTable({ rows }) {
  return (
    <div className={styles.tableScroller}>
      <table>
        <thead>
          <tr><th>Fecha</th><th>Concepto</th><th>Tipo</th><th className={styles.numeric}>Importe</th><th className={styles.numeric}>Saldo</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{formatDate(row.date)}</td>
              <td>{row.concept}</td>
              <td><TypeBadge type={row.type} /></td>
              <td className={styles.numeric}>{formatCurrency(row.amount)}</td>
              <td className={styles.numeric}>{formatCurrency(row.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReportTable({ rows, type, movements }) {
  const movementsByDay = type === 'daily'
    ? movements.reduce((groups, movement) => {
      const dailyMovements = groups.get(movement.date) || []
      dailyMovements.push(movement)
      groups.set(movement.date, dailyMovements)
      return groups
    }, new Map())
    : new Map()

  return (
    <div className={styles.tableScroller}>
      <table>
        <thead>
          <tr>
            <th>Periodo</th>
            {type === 'daily' ? <th>Detalle del día</th> : null}
            <th className={styles.numeric}>Saldo inicial</th>
            <th className={styles.numeric}>Ingresos</th>
            <th className={styles.numeric}>Egresos</th>
            <th className={styles.numeric}>Flujo neto</th>
            <th className={styles.numeric}>Saldo final</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className={styles.periodCell}>{formatPeriod(row.key, type)}</td>
              {type === 'daily' ? (
                <td className={styles.detailsCell}>
                  <ul className={styles.dailyDetailList}>
                    {(movementsByDay.get(row.key) || []).map((movement) => (
                      <li className={styles.dailyDetailItem} key={movement.id}>
                        <span className={styles.dailyDetailConcept}>{movement.concept}</span>
                        <TypeBadge type={movement.type} />
                        <span className={styles.dailyDetailAmount}>{formatCurrency(movement.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </td>
              ) : null}
              <td className={styles.numeric}>{formatCurrency(row.opening)}</td>
              <td className={`${styles.numeric} ${styles.positiveText}`}>{formatCurrency(row.income)}</td>
              <td className={styles.numeric}>{formatCurrency(row.expense)}</td>
              <td className={`${styles.numeric} ${row.net < 0 ? styles.negativeText : ''}`}>{formatCurrency(row.net)}</td>
              <td className={`${styles.numeric} ${styles.balanceCell}`}>{formatCurrency(row.closing)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TypeBadge({ type }) {
  const tone = type === 'Ingreso' ? styles.badgeIncome : type === 'Egreso' ? styles.badgeExpense : styles.badgeOpening
  return <span className={`${styles.badge} ${tone}`}>{type}</span>
}

function ContentStatus({ title, text, action }) {
  return <section className={styles.contentStatus}><h1>{title}</h1><p>{text}</p>{action}</section>
}

function FullPageStatus({ text }) {
  return <main className={styles.fullPageStatus}><p>{text}</p></main>
}

function App() {
  const session = useSession()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={session.status === 'authenticated' ? <Navigate to="/" replace /> : <LoginPage onLogin={session.login} />} />
        <Route element={<ProtectedRoute status={session.status} />}>
          <Route path="/" element={<AppShell onLogout={session.logout} />}>
            <Route index element={<HomePage />} />
            <Route path="diario" element={<ReportPage type="daily" />} />
            <Route path="mensual" element={<ReportPage type="monthly" />} />
            <Route path="anual" element={<ReportPage type="annual" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
