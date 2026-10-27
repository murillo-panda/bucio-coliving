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

La implementación deja el esquema listo para más organizaciones, pero la interfaz selecciona una organización por `VITE_ORGANIZATION_SLUG`. Esto mantiene simple la primera versión sin cerrar la posibilidad de crecer.
