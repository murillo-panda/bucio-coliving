import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { handler as adminUsersHandler } from './netlify/functions/admin-users.mjs'
import { createAdminUsersApiPlugin } from './vite.admin-users-plugin.js'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'ORGANIZATION_SLUG', 'SITE_URL']) {
    if (env[key]) process.env[key] = env[key]
  }

  return {
    plugins: [react(), createAdminUsersApiPlugin(adminUsersHandler)],
  }
})
