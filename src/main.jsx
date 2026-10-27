import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { appConfig } from './config/app.js'

document.title = `${appConfig.appName} | ${appConfig.moduleName}`
document.querySelector('meta[name="description"]')?.setAttribute(
  'content',
  `${appConfig.moduleName} de ${appConfig.organizationName}: ingresos, egresos y saldos.`,
)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
