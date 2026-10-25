# Control de caja del hostel

Aplicación React para consultar el saldo y los reportes diario, mensual y anual de una caja alojada en Google Sheets. Está preparada para publicarse en Netlify y leer una pestaña publicada como CSV.

## Probar en local

```bash
npm install
npm run dev
```

La vista local usa el CSV real configurado en `.env`. Usuario: `demo`. Contraseña: `demo`.

Para probar las pantallas con datos ficticios se puede ejecutar `npm run dev:demo`. La compilación publicada consulta `/api/cash-data`, que descarga el CSV actualizado desde una función de Netlify.

## Formato de Google Sheets

Importa el Excel en Google Sheets y conserva una pestaña llamada `Caja` con estas cuatro columnas:

| Fecha | Concepto | Tipo | Importe |
| --- | --- | --- | ---: |
| 01/01/2026 | Saldo Inicial | Apertura | 310,00 |
| 02/01/2026 | Reserva | Ingreso | 100,00 |
| 03/01/2026 | Compra | Egreso | 40,00 |

`Saldo Inicial` se reconoce siempre como apertura y no se suma a los ingresos del periodo. Los tipos permitidos son `Apertura`, `Ingreso` y `Egreso`.

## Conectar Google Sheets mediante CSV

1. En Google Sheets, usa **Archivo > Compartir > Publicar en la web**.
2. Selecciona la pestaña `Caja` y el formato **Valores separados por comas (.csv)**.
3. Guarda la URL en `VITE_GOOGLE_SHEETS_CSV_URL` para la vista local y en `GOOGLE_SHEET_CSV_URL` para Netlify.
4. Añade `APP_USERNAME`, `APP_PASSWORD` y un `SESSION_SECRET` largo en **Netlify > Site configuration > Environment variables**.

Publicar como CSV hace que los datos sean accesibles para cualquiera que conozca la URL. El login protege la aplicación, pero no convierte el CSV publicado en privado. Para datos privados, el proyecto conserva como alternativa la conexión mediante Google Sheets API y cuenta de servicio.

## Publicar en Netlify

Sube esta carpeta a un repositorio Git y crea un sitio desde ese repositorio en Netlify. `netlify.toml` ya configura:

- compilación con `npm run build`;
- publicación desde `dist`;
- funciones privadas para login y lectura de Google Sheets;
- rutas de React compatibles con recargas directas.

La aplicación consulta Google Sheets automáticamente después de iniciar sesión y cada vez que se recarga la página. Después de cambiar la hoja mientras la web ya está abierta, pulsa **Actualizar** para consultar los datos de nuevo sin recargar toda la página. Todas las respuestas se solicitan sin caché.

## Comprobaciones

```bash
npm run lint
npm test
npm run build
```
