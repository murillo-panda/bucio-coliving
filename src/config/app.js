const environment = import.meta.env

export const appConfig = Object.freeze({
  appName: environment.VITE_APP_NAME || 'Bucio Coliving',
  moduleName: environment.VITE_MODULE_NAME || 'Módulo de caja',
  organizationName: environment.VITE_ORGANIZATION_NAME || 'Bucio Coliving',
  organizationSlug: environment.VITE_ORGANIZATION_SLUG || 'bucio-coliving',
  cashAccountName: environment.VITE_CASH_ACCOUNT_NAME || 'Caja principal',
  currency: environment.VITE_CURRENCY || 'EUR',
  locale: environment.VITE_LOCALE || 'es-ES',
  timeZone: environment.VITE_TIME_ZONE || 'Atlantic/Canary',
  authMode: environment.VITE_AUTH_MODE || 'supabase',
  dataSource: environment.VITE_DATA_SOURCE || 'supabase',
  supabaseUrl: environment.VITE_SUPABASE_URL || '',
  supabaseAnonKey: environment.VITE_SUPABASE_ANON_KEY || '',
})

export const isDemoMode = appConfig.authMode === 'demo' || appConfig.dataSource === 'demo'

export function isSupabaseConfigured() {
  return Boolean(appConfig.supabaseUrl && appConfig.supabaseAnonKey)
}
