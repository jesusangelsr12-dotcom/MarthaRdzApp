# Estilo de código · Martha Rdz Hair Artist

**Última revisión:** 2026-10-05

Estas reglas salen del código que ya existe. Si algo nuevo se ve distinto a
lo de alrededor, el código nuevo es el que se ajusta.

## 1. Idioma

- **Dominio en español:** `clienta`, `cita`, `gasto`, `anticipo`, `trabajadora`, `comision`, `cobrar`.
- **Plumbing en inglés cuando ya es convención:** `render`, `init`, `fetchAPI`, `showToast`, `handler`, `req`, `res`.
- Comentarios, mensajes de error y textos de UI: español de México.
- Sin mezclar en una misma palabra (`getClientas` sí, `obtenerClients` no).

## 2. Formato

- 2 espacios. Punto y coma siempre. Comillas simples. Template literals para HTML y SQL.
- Coma final en objetos y arreglos multilínea.
- Una línea en blanco entre funciones.
- Sin linter ni formatter configurado todavía. Imita el archivo que estás editando.

## 3. Nombres

| Qué | Estilo | Ejemplo |
|---|---|---|
| Variables y funciones | camelCase | `anticiposPendientes`, `renderStepPago` |
| Constantes de módulo | UPPER_SNAKE | `MAX_INTENTOS_FALLIDOS`, `RUTAS_TRABAJADORA` |
| Archivos | kebab-case | `trabajador-pin.js`, `install-banner.js` |
| Campos de API y columnas | snake_case | `metodo_pago`, `anticipo_origen_id` |
| Clases CSS | BEM ligero | `.home-action-card--sm`, `.anticipo-previo-card-monto` |
| Booleans | pregunta | `esSoloAnticipo`, `tieneAnticipo`, `isTrabajadora()` |
| Funciones de API cliente | verbo + recurso | `getCitas`, `createGasto`, `restoreCita` |

## 4. Frontend

### Módulos
- ESM puro (`import` / `export`). Rutas relativas con `.js`.
- **Nunca** importes `app.js` con query string (`?v=…`). Carga la app dos veces.
- Todo JS nuevo en `public/js/` se agrega a `STATIC_ASSETS` de `public/sw.js`.

### Vistas
```js
let session = null;
let estadoLocal = …;        // se reinicia en init()

export function render(s) { session = s; return `…`; }
export function init(s)   { session = s; estadoLocal = …; /* listeners */ }
```
- `render` solo arma HTML. `init` engancha eventos y carga datos.
- **Reinicia todo el estado en `init()`.** El módulo vive entre visitas.
- Wizards: arreglo `STEPS` + `activeSteps()` + `goNext()` / `goBack()`. No numeres pasos a mano.
- Guarda contra doble envío: bandera `enviandoX` + `btn.disabled = true`.

### HTML dinámico
- **Todo texto que venga de datos pasa por `escapeHTML()`.** Nombres, notas, descripciones, mensajes de error.
- Para asignar un texto suelto usa `el.textContent`.
- Listas con muchos botones: delegación de eventos en el contenedor, no un listener por botón.
- Si re-renderizas un contenedor varias veces, registra el listener delegado **una sola vez** en `init()` (ver `config.js`).

### Rol de trabajadora
- Cada cambio se revisa también para ella (regla en `CLAUDE.md`).
- Oculta en el frontend lo que no puede hacer **y** bloquéalo en el backend. Nunca solo uno de los dos.

### Utilidades existentes (úsalas, no las dupliques)
`formatMXN`, `todayISO`, `nowTimestamp`,
`formatRangoFecha`, `currentWeekRange`, `normalizeNombre`, `escapeHTML`,
`showToast`, `showLoader` / `hideLoader`, `loadingHTML`, `METODOS_PAGO`,
`abrirWhatsApp`, `compartirTexto`.

## 5. Backend

- CommonJS (`require` / `module.exports`). Un handler por archivo en `api/`.
- **Primera línea útil:** `requireSession` o `requireOwnerSession`, y `if (!salonId) return;`.
- Si el servidor necesita "hoy", usa `fechaMexico()` de `lib/fecha.js`. **Nunca** `new Date().toISOString().slice(0, 10)`: es la fecha UTC y después de las 6 pm ya es mañana.
- Varios writes que deben ir juntos: una sola sentencia con CTEs (ver `POST /api/citas`), no `await`s seguidos.
- Todo endpoint nuevo o cambiado lleva su prueba en `test/api.test.js`.
- El `salon_id` sale del token. Nunca de `req.query` ni `req.body`.
- **Valida toda entrada** con `lib/validate.js` antes de tocar la base. Si falta un validador, agrégalo ahí con su prueba.
- SQL siempre con el tagged template: `sql\`… where id = ${id}\``. Nunca concatenes strings.
- Convierte `numeric` a número al responder (`Number(row.total)`).
- Operaciones que deben ir juntas: una sola sentencia (CTE) o un candado con `where estado = …`.
- Efectos secundarios que no deben tumbar la operación principal (push) van en su propio `try/catch`.
- Un bloque `try/catch` por handler con `console.error('Error en <recurso>:', error)` y un 500 con mensaje genérico.

## 6. Comentarios

El código de este repo explica el **por qué**, no el qué. Mantén ese nivel:

```js
// Bien: explica una decisión que no se ve en el código
// Sin esto, un doble tap por lag de red registraba la cita dos veces.
if (enviandoCita) return;

// Mal: repite lo que el código ya dice
// Si enviandoCita es true, regresa
```

- Bloque JSDoc al inicio de cada archivo de `api/` con métodos, formas de entrada y salida, y quién puede usarlo.
- Si una regla vive duplicada en dos lugares (ej. `normalizeNombre`), dilo en ambos comentarios.

## 7. CSS

- Solo tokens de `:root` para color, radio, sombra y transición. Nada de hex nuevos en componentes.
- Mobile first. Un único breakpoint: `@media (min-width: 700px)`.
- Evita `style="…"` en el HTML de las vistas; crea una clase.
- Ver [Design-System.md](Design-System.md).

## 8. Git

- Rama por cambio. Nunca directo a `main`.
- Mensaje de commit en español, en imperativo, que diga el resultado para la usuaria:
  - "Registrar Cita: paso de anticipo dentro del total"
  - "Corregir que la trabajadora veía toda la app"
- Prefijo con la pantalla o área cuando ayuda (`Registrar Cita:`, `Configuración:`, `WhatsApp:`).
- Cuerpo del commit: el problema, la causa y por qué esta solución.
- Cada commit que cambia la app sube `CACHE_NAME` y actualiza el [CHANGELOG](../CHANGELOG.md).

## 9. Checklist antes de hacer commit

- [ ] `npm test` en verde.
- [ ] Revisé el cambio con sesión de dueña **y** de trabajadora.
- [ ] Todo texto dinámico pasa por `escapeHTML`.
- [ ] Endpoint nuevo o modificado: valida entrada y rol en el servidor.
- [ ] Subí `CACHE_NAME`. Si hay JS nuevo, lo agregué a `STATIC_ASSETS`.
- [ ] Migración nueva: aditiva, idempotente y documentada.
- [ ] Actualicé los docs que toca el cambio y el CHANGELOG.
