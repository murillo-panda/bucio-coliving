# Guía breve de personalización

Toda la identidad funcional está centralizada en `src/config/app.js` y se completa con variables `VITE_*`.

| Variable | Ejemplo | Uso |
| --- | --- | --- |
| `VITE_APP_NAME` | Bucio Coliving | Nombre visible |
| `VITE_MODULE_NAME` | Módulo de caja | Subtítulo |
| `VITE_ORGANIZATION_SLUG` | bucio-coliving | Organización consultada |
| `VITE_CASH_ACCOUNT_NAME` | Caja principal | Caja creada por bootstrap |
| `VITE_CURRENCY` | EUR | Formato y moneda |
| `VITE_LOCALE` | es-ES | Formato de números y fechas |
| `VITE_TIME_ZONE` | Atlantic/Canary | Hora mostrada |

Para un nuevo despliegue usa una base Supabase separada. Así no se mezclan usuarios, comprobantes ni movimientos entre clientes, aunque todos partan del mismo código fuente.

Cada instalación debe configurar `BOOTSTRAP_OWNER_EMAIL` con el correo de su propietario. Ese usuario recibe el rol interno `owner`, visible como **Superusuario**, y es el único que puede ocultar o restaurar movimientos de prueba. La exclusividad se valida con el UUID de Supabase y no depende del nombre visible.

Antes de aplicar migraciones a una instalación real, ejecútalas en el Supabase local definido en `supabase/config.toml`. El modo demo solo valida la interfaz: no reemplaza las pruebas de relaciones, RLS, Storage ni RPC contra Supabase.

La implementación deja el esquema listo para más organizaciones, pero la interfaz selecciona una organización por `VITE_ORGANIZATION_SLUG`. Esto mantiene simple la primera versión sin cerrar la posibilidad de crecer.
