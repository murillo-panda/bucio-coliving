# Boilerplate de gestión de caja

Aplicación React + Vite preparada para reutilizarse en distintos negocios cambiando solamente variables de entorno y los dos archivos de marca. Incluye Supabase Auth, PostgreSQL, Storage privado, Netlify Functions, tres roles, auditoría e importación desde Google Sheets.

## Funcionalidad incluida

- login por correo y contraseña;
- roles `admin`, `operator` y `viewer`;
- una caja por organización en esta primera versión;
- ingresos y egresos con fecha/hora efectiva elegible;
- fecha/hora real de creación y usuario responsable;
- un comprobante opcional por movimiento, convertido a WebP y comprimido en el navegador;
- movimientos inmutables: no se editan ni eliminan;
- anulación exclusiva de administradores mediante contramovimiento y motivo obligatorio;
- reportes diario, mensual y anual;
- exportación manual en CSV;
- invitaciones y gestión de usuarios;
- importador idempotente del histórico publicado en Google Sheets.

## Probar sin servicios externos

```bash
yarn install
yarn dev
```

Abre la URL de Vite e inicia sesión con `demo` / `demo`. Los cambios del modo demo viven en memoria y se borran al recargar.

## Crear el proyecto Supabase

1. Crea un proyecto gratuito en Supabase.
2. Abre **SQL Editor**, copia y ejecuta `supabase/migrations/202610270001_initial_schema.sql`.
3. En **Authentication > URL Configuration**, añade como URL del sitio tu dominio Netlify y permite `https://TU-SITIO.netlify.app/set-password` como redirect URL.
4. Copia `.env.example` como `.env` y coloca la URL, `anon key` y `secret key` del proyecto. La clave `service_role` antigua también es compatible. `.env` está ignorado por Git.
5. Prepara el primer administrador:

```bash
yarn bootstrap:admin
```

El correo recibirá una invitación para establecer su propia contraseña.

## Importar Google Sheets

Publica la pestaña de caja como CSV con las columnas `Fecha`, `Concepto`, `Tipo` e `Importe`, configura `GOOGLE_SHEET_CSV_URL` y ejecuta:

```bash
yarn import:sheets
```

La importación se puede repetir: las filas ya importadas se omiten. Los movimientos históricos quedan con:

- `occurred_at`: la fecha del registro original;
- `created_at`: esa misma fecha, como se acordó;
- usuario visible: `Migración inicial`;
- `created_by`: vacío porque el usuario histórico no existe.

## Variables de Netlify

Configura en **Site configuration > Environment variables**:

- todas las variables `VITE_*` de `.env.example`;
- `SUPABASE_URL`;
- `SUPABASE_SECRET_KEY`;
- `ORGANIZATION_SLUG`;
- `SITE_URL`.

La `secret key` solo se usa dentro de la función protegida de administración de usuarios. Nunca debe tener el prefijo `VITE_`.

Netlify debe publicar el repositorio completo, no solo `dist`. `netlify.toml` ya define `yarn build`, `dist`, las Functions y el fallback de React Router.

## Reutilizar para otro cliente

1. Copia el repositorio.
2. Cambia las variables de marca/organización en `.env` y Netlify.
3. Reemplaza `src/assets/brand-logo.png` y `src/assets/brand-mark.png`, conservando esos nombres.
4. Crea un proyecto Supabase nuevo y ejecuta la misma migración.
5. Ejecuta `yarn bootstrap:admin` con el correo del nuevo administrador.

No hace falta modificar componentes, rutas, tablas ni reglas de permisos para cambiar el nombre del producto.

## Seguridad y auditoría

- Row Level Security limita cada consulta a miembros activos de la organización.
- La interfaz pública usa solo la `anon key`.
- Los comprobantes se guardan en el bucket privado `receipts`; se visualizan con enlaces firmados de 60 segundos.
- No existen permisos SQL de actualización o borrado sobre movimientos.
- Las anulaciones son transacciones nuevas que referencian el original.
- El backend impide desactivar al último administrador activo.

## Comprobaciones

```bash
yarn lint
yarn test
yarn build
```
