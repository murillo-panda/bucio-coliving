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
} from './lib/cash.js'
import { fetchCashCsv } from './lib/csv.js'
import brandLogo from './assets/bucio-coliving-logo.png'
import brandMark from './assets/bucio-coliving-mark.png'
import styles from './App.module.css'

const API_BASE = '/api'
const DATA_SOURCE = import.meta.env.VITE_DATA_SOURCE || 'google-sheets-api'
const USE_DEMO_AUTH = import.meta.env.VITE_AUTH_MODE === 'demo'

function toLocalIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function currentMonthRange() {
  const today = new Date()
  return {
    from: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
    to: toLocalIsoDate(today),
  }
}

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
        <img className={styles.loginLogo} src={brandLogo} alt="Bucio Coliving" />
        <p className={styles.eyebrow}>Módulo de caja</p>
        <h1 id="login-title">Acceder</h1>
        <p className={styles.loginIntro}>Consulta los ingresos, egresos y saldos de Bucio Coliving.</p>

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
        <NavLink className={styles.brand} to="/" aria-label="Bucio Coliving, módulo de caja, inicio">
          <img className={styles.brandImage} src={brandMark} alt="" />
          <span>
            <strong>Bucio Coliving</strong>
            <small>Módulo de caja</small>
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
  const [dateRange, setDateRange] = useState(currentMonthRange)
  const config = {
    daily: { eyebrow: 'Detalle diario', title: 'Reporte diario', description: 'Ingresos, egresos y saldo por fecha.', rows: snapshot.daily },
    monthly: { eyebrow: 'Consolidado mensual', title: 'Reporte mensual', description: 'Resultado acumulado de cada mes.', rows: snapshot.monthly },
    annual: { eyebrow: 'Consolidado anual', title: 'Reporte anual', description: 'Resultado acumulado de cada año.', rows: snapshot.annual },
  }[type]
  const invalidRange = type === 'daily'
    && dateRange.from
    && dateRange.to
    && dateRange.from > dateRange.to
  const visibleRows = type === 'daily' && !invalidRange
    ? filterRowsByDateRange(config.rows, dateRange.from, dateRange.to)
    : config.rows

  function showAllDates() {
    setDateRange({
      from: snapshot.daily.at(0)?.key || '',
      to: snapshot.daily.at(-1)?.key || '',
    })
  }

  return (
    <>
      <PageHeading eyebrow={config.eyebrow} title={config.title} description={config.description} />
      {type === 'daily' ? (
        <DateRangeFilter
          dateRange={dateRange}
          invalidRange={invalidRange}
          resultCount={visibleRows.length}
          onChange={setDateRange}
          onCurrentMonth={() => setDateRange(currentMonthRange())}
          onShowAll={showAllDates}
          onClear={() => setDateRange({ from: '', to: '' })}
        />
      ) : null}
      <section className={styles.panel}>
        {invalidRange ? (
          <EmptyReportState text="La fecha inicial no puede ser posterior a la fecha final." />
        ) : visibleRows.length ? (
          <ReportTable rows={visibleRows} type={type} movements={snapshot.movements} />
        ) : (
          <EmptyReportState text="No hay movimientos en el rango seleccionado." />
        )}
      </section>
    </>
  )
}

function DateRangeFilter({ dateRange, invalidRange, resultCount, onChange, onCurrentMonth, onShowAll, onClear }) {
  function updateField(field, value) {
    onChange((current) => ({ ...current, [field]: value }))
  }

  return (
    <section className={styles.dateFilter} aria-labelledby="date-filter-title">
      <div className={styles.dateFilterHeading}>
        <div>
          <p className={styles.eyebrow}>Filtrar movimientos</p>
          <h2 id="date-filter-title">Rango de fechas</h2>
        </div>
        <p className={`${styles.filterStatus} ${invalidRange ? styles.filterError : ''}`} aria-live="polite">
          {invalidRange ? 'Revisa las fechas seleccionadas' : `${resultCount} ${resultCount === 1 ? 'día encontrado' : 'días encontrados'}`}
        </p>
      </div>
      <div className={styles.dateFilterControls}>
        <div className={styles.dateFields}>
          <label className={styles.dateField}>
            <span>Desde</span>
            <input
              type="date"
              value={dateRange.from}
              onChange={(event) => updateField('from', event.target.value)}
            />
          </label>
          <label className={styles.dateField}>
            <span>Hasta</span>
            <input
              type="date"
              value={dateRange.to}
              onChange={(event) => updateField('to', event.target.value)}
            />
          </label>
        </div>
        <div className={styles.dateFilterActions}>
          <button className={`${styles.filterButton} ${styles.filterButtonPrimary}`} onClick={onCurrentMonth} type="button">Este mes</button>
          <button className={styles.filterButton} onClick={onShowAll} type="button">Todo</button>
          <button className={styles.filterButton} onClick={onClear} type="button">Limpiar</button>
        </div>
      </div>
    </section>
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
    <>
      <div className={styles.desktopTable}>
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
      </div>
      <div className={styles.mobileCards} aria-label="Últimos movimientos">
        {rows.map((row) => (
          <article className={styles.movementCard} key={row.id}>
            <header className={styles.mobileCardHeader}>
              <div>
                <time dateTime={row.date}>{formatDate(row.date)}</time>
                <h3>{row.concept}</h3>
              </div>
              <TypeBadge type={row.type} />
            </header>
            <dl className={styles.cardMetrics}>
              <CardMetric label="Importe" value={formatCurrency(row.amount)} tone={row.type === 'Ingreso' ? 'positive' : row.type === 'Egreso' ? 'negative' : 'neutral'} />
              <CardMetric label="Saldo" value={formatCurrency(row.balance)} emphasized />
            </dl>
          </article>
        ))}
      </div>
    </>
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
    <>
      <div className={styles.desktopTable}>
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
                      <DailyMovementList movements={movementsByDay.get(row.key) || []} />
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
      </div>
      <div className={styles.mobileCards} aria-label={`Reporte ${type === 'daily' ? 'diario' : type === 'monthly' ? 'mensual' : 'anual'}`}>
        {rows.map((row) => (
          <article className={styles.reportCard} key={row.key}>
            <header className={styles.reportCardHeader}>
              <p>{type === 'daily' ? 'Día' : type === 'monthly' ? 'Mes' : 'Año'}</p>
              <h3>{formatPeriod(row.key, type)}</h3>
            </header>
            {type === 'daily' ? (
              <section className={styles.mobileDetail} aria-label={`Movimientos del ${formatPeriod(row.key, type)}`}>
                <h4>Detalle del día</h4>
                <DailyMovementList movements={movementsByDay.get(row.key) || []} />
              </section>
            ) : null}
            <dl className={styles.cardMetrics}>
              <CardMetric label="Saldo inicial" value={formatCurrency(row.opening)} />
              <CardMetric label="Ingresos" value={formatCurrency(row.income)} tone="positive" />
              <CardMetric label="Egresos" value={formatCurrency(row.expense)} tone="negative" />
              <CardMetric label="Flujo neto" value={formatCurrency(row.net)} tone={row.net < 0 ? 'negative' : 'neutral'} />
              <CardMetric label="Saldo final" value={formatCurrency(row.closing)} emphasized wide />
            </dl>
          </article>
        ))}
      </div>
    </>
  )
}

function DailyMovementList({ movements }) {
  return (
    <ul className={styles.dailyDetailList}>
      {movements.map((movement) => (
        <li className={styles.dailyDetailItem} key={movement.id}>
          <span className={styles.dailyDetailConcept}>{movement.concept}</span>
          <TypeBadge type={movement.type} />
          <span className={styles.dailyDetailAmount}>{formatCurrency(movement.amount)}</span>
        </li>
      ))}
    </ul>
  )
}

function CardMetric({ label, value, tone = 'neutral', emphasized = false, wide = false }) {
  const toneClass = tone === 'positive' ? styles.positiveText : tone === 'negative' ? styles.negativeText : ''
  return (
    <div className={`${styles.cardMetric} ${wide ? styles.cardMetricWide : ''}`}>
      <dt>{label}</dt>
      <dd className={`${toneClass} ${emphasized ? styles.cardMetricEmphasized : ''}`}>{value}</dd>
    </div>
  )
}

function EmptyReportState({ text }) {
  return (
    <div className={styles.emptyReport} role="status">
      <h2>Sin resultados</h2>
      <p>{text}</p>
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
