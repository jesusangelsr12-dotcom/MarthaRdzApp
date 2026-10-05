# Design System · Martha Rdz Hair Artist

**Última revisión:** 2026-10-05 · **Fuente de verdad:** `public/css/styles.css` (Design System v4)

La identidad sale del brand board de Martha Rdz Hair Artist: **Negro
Elegancia** `#111111`, **Verde Menta** `#88D8C0`, **Blanco Humo** `#F4F4F4`
y **Gris Plata** `#E2E2E2`. Todo lo demás se deriva de esos cuatro colores
con la regla 60-30-10 y con contraste WCAG AA verificado en cada combinación
que usa la app.

## 1. Principios

1. **Minimalista.** Una acción principal por pantalla. Lo que se usa poco se esconde (bloque "Más", secciones colapsables).
2. **Un pulgar.** Botones de 56 px, teclado numérico propio, avanzar solo al elegir (método de pago, tarjeta de cita agendada).
3. **Nada se pierde.** Todo borrado pide confirmación o da "Deshacer" (idealmente ambos).
4. **Pequeños momentos de logro.** Check animado en el toast de éxito, rebote corto al tocar.
5. **Hecho para iPhone instalado.** Respeta notch, Dynamic Island y barra de gestos.

## 2. Color

### 2.1 Tokens

| Token | Valor | Uso |
|---|---|---|
| `--color-bg` | `#F4F4F4` | Fondo de toda la app (60 %). Blanco Humo |
| `--color-surface` | `#FFFFFF` | Tarjetas, inputs, modales |
| `--color-ink` | `#111111` | Texto y encabezados (30 %). Negro Elegancia, 17:1 sobre el fondo |
| `--color-ink-light` | `#3D3D3D` | Estado activo de botón oscuro |
| `--color-ink-muted` | `#595959` | Texto secundario |
| `--color-accent-vivid` | `#88D8C0` | Verde Menta de la marca. **Solo fondo** de botón primario (10 %) |
| `--color-accent-vivid-active` | `#6BC9AC` | Botón primario presionado |
| `--color-accent` | `#13705F` | Menta profundo para **texto, íconos y bordes** (5.4:1 sobre el fondo) |
| `--color-accent-active` | `#0D5A4C` | Acento presionado |
| `--color-accent-bg` | `#E2F4EE` | Fondo de elemento seleccionado, badge "pendiente" |
| `--color-slate` | `#4F6660` | Segundo tono de marca (ícono de Agenda, servicios, comisiones, avatares) |
| `--color-slate-light` | `#E7EDEB` | Fondo del tono slate |
| `--color-gray-100` … `500` | `#F7F7F7` `#E2E2E2` `#D4D4D4` `#A8A8A8` `#636363` | Neutros. El 200 es Gris Plata (bordes y detalles) |
| `--color-green` / `-light` | `#2B7330` / `#E5F1E3` | Ingresos, éxito, "completada". Verde clásico, lejos del menta |
| `--color-error` / `-light` | `#BE3A3A` / `#FCE5E3` | Gastos, errores, borrar, "no asistió" |

### 2.2 Reglas de color

- **El Verde Menta nunca va como texto sobre fondo claro** (1.6:1, no se lee). Para texto usa `--color-accent`.
- **Sobre el botón menta, el texto va en negro** (`--color-ink`, 11.4:1). Blanco no pasa.
- **El verde de dinero no es el menta.** `--color-green` (matiz 124°) está lejos del menta (162°) para que "Completada" no se confunda con "Pendiente".
- Verde y rojo son funcionales, no de marca: dinero que entra y dinero que sale.
- Nunca escribas un hex directo en un componente. Si falta un color, créalo como token con su nota de contraste.

### 2.3 Colores semánticos por dominio

| Concepto | Color |
|---|---|
| Ingreso, monto a favor | `--color-green` |
| Gasto, monto en contra | `--color-error` (con signo `-`) |
| Comisión | `--color-ink` (neutral) |
| Cita pendiente | accent-bg / accent |
| Cita completada | green-light / green |
| No asistió | error-light / error |
| Cancelada | gray-200 / gray-500 |
| Día con ausencia (calendario) | `--color-slate-light` de fondo |

## 3. Tipografía

Dos familias, como pide el brand board:

- **Títulos:** la letra del logo, DejaVu Serif Bold (`--font-title`, nombre
  interno `'Martha Serif'`). Va dentro de la app en
  `public/fonts/dejavu-serif-bold.woff2` (subconjunto Latin + español, 19 KB,
  precargado en `index.html` y guardado por el Service Worker), así que
  funciona sin conexión. Respaldo: Georgia, serif. Licencia en
  `public/fonts/LICENSE-DejaVu.txt`.
- **Todo lo demás:** Inter (400, 500, 600, 700) desde Google Fonts, con
  respaldo del sistema (`-apple-system, BlinkMacSystemFont, 'Segoe UI',
  sans-serif`). Tamaño base: 16 px.

La serif va **solo** en títulos de pantalla y de avisos. Etiquetas en
MAYÚSCULAS, montos, botones y texto de tarjetas siguen en Inter: a tamaño
chico se leen mejor.

| Rol | Tamaño | Peso | Dónde |
|---|---|---|---|
| Display de monto | `2.75rem`, `letter-spacing: -1px` | 700 | Teclado de precio / anticipo / gasto |
| h1 | `1.5rem` | 700 | Poco usado |
| h2 | `1.25rem` | 600 | |
| Título de pantalla | `1.2rem`, serif del logo | 700 | `.screen-title` |
| Título de aviso | `1.15rem`, serif del logo | 700 | `.delete-modal-title` |
| Cuerpo | `0.95rem` | 400–600 | Párrafos, nombres en tarjetas |
| Secundario | `0.85–0.9rem` | 500 | Subtítulos, metadatos |
| Etiqueta de campo | `0.82rem` MAYÚSCULAS, `letter-spacing: .5px` | 600 | `.input-label` |
| Micro | `0.62–0.75rem` | 600–700 | Badges, etiquetas de gráfica |

**Reglas:** los inputs llevan `font-size: 1rem` mínimo (evita el zoom automático
de iOS). Nunca pongas texto funcional por debajo de `0.62rem`.

## 4. Espaciado, radios y sombras

**Escala de espacio (px):** 4 · 8 · 12 · 16 · 20 · 24 · 32. El 8 y el 12 son los más usados.
Clases utilitarias: `.mt-8`, `.mt-16`, `.mt-24`, `.mt-32`, `.mb-16`, `.mb-24`,
`.gap-12`, `.gap-16`.

| Token | Valor | Uso |
|---|---|---|
| `--radius-sm` | 12 px | Elementos chicos |
| `--radius-md` | 16 px | Inputs, teclas |
| `--radius-lg` | 20 px | Botones, tarjetas |
| `--radius-xl` | 28 px | Modales |
| `--radius-full` | 9999 px | Toast, badges, puntos |
| `--shadow-sm` | `0 1px 4px rgba(23,20,23,.05)` | Tarjetas en reposo |
| `--shadow-md` | `0 4px 16px rgba(23,20,23,.07)` | Tarjeta seleccionada |
| `--shadow-lg` | `0 8px 32px rgba(17,17,17,.10)` | Toast, modales |

## 5. Movimiento

| Token | Valor | Uso |
|---|---|---|
| `--transition` | `220ms ease` | Cambios de color, borde, opacidad |
| `--bounce` | `140ms cubic-bezier(.34,1.56,.64,1)` | `transform` al tocar (`scale(.95–.97)`) |

Animaciones con nombre: `spin` (loaders), `shake` (PIN incorrecto), `toast-check-pop` (éxito).

## 6. Layout

| Contexto | Ancho máximo de `#app` |
|---|---|
| Celular (default) | 430 px |
| ≥ 700 px, pantallas normales | 640 px |
| ≥ 700 px, wizards (`app--angosta`: login, cita, gasto, agendar) | 430 px |
| ≥ 700 px, dos columnas (`app--dos-columnas`: home de la dueña, agenda) | 920 px |

`.screen` usa `max(24px, safe-area)` arriba y abajo y `max(20px, safe-area)`
a los lados. Altura mínima `100dvh`. `touch-action: manipulation` en `html`
evita el zoom por doble tap al teclear el PIN.

## 7. Componentes

| Componente | Clase(s) | Reglas |
|---|---|---|
| Botón primario | `.btn .btn-primary` | Verde Menta, texto negro, 56 px de alto, ancho completo. **Uno por pantalla** |
| Botón oscuro | `.btn .btn-gold` | Negro con texto blanco. Acciones secundarias sólidas ("Agregar"). El nombre es histórico |
| Botón contorno | `.btn .btn-outline` | Alternativa o "saltar" ("Sin servicios", "Cancelar") |
| Link | `.btn-link` | Acciones discretas ("Actualizar app", "Cambiar PIN") |
| Ícono chico | `.btn-icon-sm` | Editar ✎, compartir |
| Input | `.input`, `.textarea`, `.date-picker-input` | 52 px, borde gris, foco en menta profundo |
| Etiqueta | `.input-label` | Mayúsculas, gris, arriba del campo |
| Teclado numérico | `.keypad` + `.keypad-key` (`--delete`, `--confirm`, `--empty`) | 3×4, teclas de 58 px |
| Puntos de PIN | `.pin-dots` / `.pin-dot.filled` / `.error` | 6 puntos, sacuden en error |
| Indicador de pasos | `.step-indicator` / `.step-dot.active` | El paso activo se alarga a 24 px |
| Tarjeta seleccionable | `.service-card`, `.payment-card` (`.selected`) | Borde menta profundo y fondo menta claro al elegir |
| Resumen | `.summary`, `.summary-row`, `--total`, `.summary-section-title` | Paso "Confirmar" de cada wizard |
| Tarjeta de acción | `.home-action-card` (`--sm`), `.home-action-icon--*` | Inicio |
| Registro | `.record-item`, `.record-amount--income/--expense` | Registros del día |
| Monto que se corrige | `.record-amount-btn` + `.record-amount-edit` (✎ gris) | El monto de un cobro es el botón para corregirlo: sin botón extra en la tarjeta |
| Registro resaltado | `.record-item--foco` | Anillo menta 2.5 s en el cobro al que llevó la Agenda |
| Campo de dinero | `.money-input` > `.input` | "$" fijo adelante. Solo en editores de corrección dentro de una hoja (ver 8) |
| Línea de cuenta | `.cobro-linea` (`--anticipo`, `--total`), `.cobro-total-value` | Anticipo aplicado y total en vivo del editor de cobro |
| Badge de estado | `.agenda-estado-badge--{estado}` | Ver colores en 2.3 |
| Modal / hoja de acciones | `.delete-modal`, `.action-sheet-content` | Fondo difuminado. Confirmación con botón rojo. Alto máximo de la pantalla con scroll interno; "Cancelar"/"Guardar" con relleno lateral de 12 px para caber en 320 px |
| Botón de acción principal en hoja | `.action-sheet-btn--cobrar` | Menta claro con texto menta profundo. "Registrar cobro" |
| Nota en hoja de acciones | `.multi-select-hint.action-sheet-nota` | Explica por qué falta una acción (ej. cita ya cobrada) |
| Opción con consecuencia | `.action-sheet-btn` + `.action-sheet-btn-sub` | Segunda línea gris que dice qué pasa al elegirla (ej. "Solo el cobro" / "Cobro y anticipo") |
| Fila con fecha | `.agenda-row-fecha` | Fecha corta bajo el nombre, en "Sin cerrar" |
| Toast | `#toast`, `.toast-success`, `.toast-error`, `.toast-action` | Abajo al centro, del ancho de su texto (`max-content`, tope de pantalla − 40 px). 3 s (5 s si trae "Deshacer"). `z-index` 1002: encima de modales y menús |
| Interruptor | `.config-permiso` + `input.config-permiso-input` (`role="switch"`) | Permisos de una trabajadora. Apagado: Gris Plata con borde gris 500 (3:1). Encendido: `--color-accent`. Se guarda al tocarlo |
| Loader global | `#loader` | Bloquea la pantalla mientras hay una llamada |
| Carga en línea | `loadingHTML(texto)` | Spinner chico + texto, no bloquea |
| Estado vacío | `.empty-state` + emoji + texto | Siempre con salida si aplica ("Agendar cita") |
| Banner de nota fija | `.nota-fija-banner` | Alergias y preferencias. Siempre visible antes de escribir la fórmula |

## 8. Reglas de UX

**Captura**
- Montos con el teclado numérico propio, no con el teclado del sistema. Máximo 7 dígitos.
  **Excepción:** corregir un monto ya capturado (anticipo en la Agenda, precios de un cobro) usa `.money-input` con el teclado decimal del sistema, porque son varios campos a la vez dentro de una hoja. Solo acepta dígitos y hasta 2 decimales.
- En una hoja de acciones, el método de pago es un `<select class="input">`: tres pestañas con "Transferencia" no caben en un celular de 375 px.
- No agregar un botón a un menú si la acción cabe en uno que ya existe (ej. "Editar anticipo y nota").
- Si elegir una opción ya decide el paso (método de pago), avanza solo.
- Pasos opcionales con botón "Sin …" (sin servicios, sin notas, sin comisiones).
- Fechas y horas se muestran en lenguaje natural ("Viernes, 9 de octubre", "4:30 PM"). Se guardan en ISO y 24 h.

**Confirmación y deshacer**
- Todo wizard termina en un resumen antes de guardar.
- Borrar pide confirmación **y** ofrece "Deshacer" en el toast (5 s).
- Cancelar o "No asistió" también piden confirmación y se pueden revertir.

**Feedback**
- Botón de confirmar se desactiva al tocarlo (evita el doble registro).
- Éxito: toast verde con check y regreso a la pantalla anterior.
- **Pantallas de ajustes se guardan solas** (Configuración): sin botón "Guardar". Cada cambio se guarda al momento, avisa con un toast corto y, si falla, recarga lo que de verdad está guardado. El texto "Los cambios se guardan solos" (`.config-autosave-hint`) lo dice al final de la pantalla.
- Error: toast rojo con un mensaje entendible. Nunca un stack ni un código.
- Carga fallida de una pantalla: mensaje + botón "Reintentar".
- Cargas secundarias (autocompletado, teléfonos) fallan en silencio; la pantalla sigue funcionando.

**Texto**
- Español de México, tuteo, frases cortas. "Cita registrada correctamente", no "La operación se completó con éxito".
- Botones con verbo: "Confirmar y Registrar", "Sí, eliminar", "No, volver".

**Accesibilidad**
- Contraste AA en toda combinación de texto (ver notas en los tokens).
- `aria-label` en botones de solo ícono (✕, ✎, compartir).
- `aria-expanded` / `aria-controls` en lo que se colapsa ("Más", Servicios, Productos).
- Todo texto libre se inyecta con `escapeHTML()`.

## 9. Íconos e imágenes

- Íconos SVG en línea, trazo de 2 px, `stroke="currentColor"`, estilo Feather. Sin librería externa (el CSP no permite CDNs de scripts).
- Emojis solo como apoyo visual en estados vacíos y métodos de pago (💵 💳 📱).
- `public/img/logo.png`: el logo real ("MARTHA RDZ." + "HAIR ARTIST"), PNG transparente tal como lo entregó la marca. Tipografía: DejaVu Serif Bold y DejaVu Sans espaciada, en Negro y Verde Menta.
- `public/img/icon-mark.png`: monograma cuadrado "MR." de 1024 px con la misma tipografía del logo, sobre Blanco Humo. De él salen los íconos PWA y el de iOS (`public/icons/generate.py`).
- Splash de iOS en `public/img/splash/`: el logo sobre Blanco Humo, nunca más grande que el PNG original (`public/img/splash/generate.py`).

## 10. Deuda de diseño conocida

| Qué | Dónde | Arreglo sugerido |
|---|---|---|
| Rojo presionado directo `#A23131` | `.delete-modal-btn--confirm:active` | Token `--color-error-active` |
| `.btn-gold` ya no es dorado | Botones "Agregar" | Renombrar a `.btn-dark` |
| Estilos en línea en varias vistas (`style="color: …"`) | login, config, agenda | Mover a clases |
| Sin `:focus-visible` en botones | Todo el CSS | Anillo de foco para teclado |
| Sin `prefers-reduced-motion` | Animaciones | Desactivar rebote y shake |
