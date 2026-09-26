# Design System · Martha Rdz Hairartist

**Última revisión:** 2026-09-26 · **Fuente de verdad:** `public/css/styles.css` (Design System v3)

La identidad de Martha Rdz Hairartist: **negro** y **rosa**.
Todo lo demás se deriva de esos dos colores con la regla 60-30-10 y con
contraste WCAG AA verificado en cada combinación que usa la app.

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
| `--color-bg` | `#FDF9FA` | Fondo de toda la app (60 %). Blanco con un toque de rosa |
| `--color-surface` | `#FFFFFF` | Tarjetas, inputs, modales |
| `--color-ink` | `#171417` | Texto y encabezados (30 %). 18:1 sobre el fondo |
| `--color-ink-light` | `#454345` | Estado activo de botón oscuro |
| `--color-ink-muted` | `#5C5459` | Texto secundario |
| `--color-pink-vivid` | `#FF39B2` | Rosa de la marca. **Solo fondo** de botón primario (10 %) |
| `--color-pink-vivid-active` | `#D12F92` | Botón primario presionado |
| `--color-pink` | `#C41478` | Rosa para **texto, íconos y bordes** (pasa AA) |
| `--color-pink-active` | `#A11062` | Rosa presionado |
| `--color-pink-bg` | `#F8E3EF` | Fondo de elemento seleccionado, badge "pendiente" |
| `--color-rose` | `#96526B` | Segundo tono de marca (ícono de Agenda, avatares) |
| `--color-rose-light` | `#F0E7EA` | Fondo del tono rose |
| `--color-gray-100` … `500` | `#FAF6F7` `#F0EAEC` `#DDD2D6` `#B0A2A7` `#7A6C71` | Neutros cálidos (mismo matiz que el fondo) |
| `--color-green` / `-light` | `#1E6E44` / `#E0F3E7` | Ingresos, éxito, "completada" |
| `--color-error` / `-light` | `#BE3A3A` / `#FCE5E3` | Gastos, errores, borrar, "no asistió" |

### 2.2 Reglas de color

- **El rosa del logo nunca va como texto sobre fondo claro** (3.2:1, no pasa AA). Para texto usa `--color-pink`.
- **Sobre el botón rosa, el texto va en negro** (`--color-ink`, 5.6:1). Blanco no pasa.
- Verde y rojo son funcionales, no de marca: dinero que entra y dinero que sale.
- Nunca escribas un hex directo en un componente. Si falta un color, créalo como token con su nota de contraste.

### 2.3 Colores semánticos por dominio

| Concepto | Color |
|---|---|
| Ingreso, monto a favor | `--color-green` |
| Gasto, monto en contra | `--color-error` (con signo `-`) |
| Comisión | `--color-ink` (neutral) |
| Cita pendiente | pink-bg / pink |
| Cita completada | green-light / green |
| No asistió | error-light / error |
| Cancelada | gray-200 / gray-500 |
| Día con ausencia (calendario) | `--color-rose-light` de fondo |

## 3. Tipografía

**Familia:** Inter (400, 500, 600, 700) desde Google Fonts, con respaldo del sistema
(`-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`). Tamaño base: 16 px.

| Rol | Tamaño | Peso | Dónde |
|---|---|---|---|
| Display de monto | `2.75rem`, `letter-spacing: -1px` | 700 | Teclado de precio / anticipo / gasto |
| h1 | `1.5rem` | 700 | Poco usado |
| h2 | `1.25rem` | 600 | |
| Título de pantalla | `1.15rem` | 700 | `.screen-title` |
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
| `--shadow-lg` | `0 8px 32px rgba(23,20,23,.10)` | Toast, modales |

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
| Botón primario | `.btn .btn-primary` | Rosa vivo, texto negro, 56 px de alto, ancho completo. **Uno por pantalla** |
| Botón oscuro | `.btn .btn-gold` | Negro con texto blanco. Acciones secundarias sólidas ("Agregar"). El nombre es histórico |
| Botón contorno | `.btn .btn-outline` | Alternativa o "saltar" ("Sin servicios", "Cancelar") |
| Link | `.btn-link` | Acciones discretas ("Actualizar app", "Cambiar PIN") |
| Ícono chico | `.btn-icon-sm` | Editar ✎, compartir |
| Input | `.input`, `.textarea`, `.date-picker-input` | 52 px, borde gris, foco en rosa |
| Etiqueta | `.input-label` | Mayúsculas, gris, arriba del campo |
| Teclado numérico | `.keypad` + `.keypad-key` (`--delete`, `--confirm`, `--empty`) | 3×4, teclas de 58 px |
| Puntos de PIN | `.pin-dots` / `.pin-dot.filled` / `.error` | 6 puntos, sacuden en error |
| Indicador de pasos | `.step-indicator` / `.step-dot.active` | El paso activo se alarga a 24 px |
| Tarjeta seleccionable | `.service-card`, `.payment-card` (`.selected`) | Borde y fondo rosa claro al elegir |
| Resumen | `.summary`, `.summary-row`, `--total`, `.summary-section-title` | Paso "Confirmar" de cada wizard |
| Tarjeta de acción | `.home-action-card` (`--sm`), `.home-action-icon--*` | Inicio |
| Registro | `.record-item`, `.record-amount--income/--expense` | Registros del día |
| Badge de estado | `.agenda-estado-badge--{estado}` | Ver colores en 2.3 |
| Modal / hoja de acciones | `.delete-modal`, `.action-sheet-content` | Fondo difuminado. Confirmación con botón rojo |
| Botón de acción principal en hoja | `.action-sheet-btn--cobrar` | Rosa claro con texto rosa. "Registrar cobro" |
| Nota en hoja de acciones | `.multi-select-hint.action-sheet-nota` | Explica por qué falta una acción (ej. cita ya cobrada) |
| Fila con fecha | `.agenda-row-fecha` | Fecha corta bajo el nombre, en "Sin cerrar" |
| Toast | `#toast`, `.toast-success`, `.toast-error`, `.toast-action` | Abajo al centro. 3 s (5 s si trae "Deshacer") |
| Loader global | `#loader` | Bloquea la pantalla mientras hay una llamada |
| Carga en línea | `loadingHTML(texto)` | Spinner chico + texto, no bloquea |
| Estado vacío | `.empty-state` + emoji + texto | Siempre con salida si aplica ("Agendar cita") |
| Banner de nota fija | `.nota-fija-banner` | Alergias y preferencias. Siempre visible antes de escribir la fórmula |

## 8. Reglas de UX

**Captura**
- Montos con el teclado numérico propio, no con el teclado del sistema. Máximo 7 dígitos.
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
- `public/img/logo.png` (logo completo), `public/img/icon-mark.png` (monograma "MR"). Hoy son un logo provisional de texto (Playfair Display + Inter): al llegar el logo final se reemplazan estos dos PNG y se corren los `generate.py`.
- Íconos PWA en `public/icons/` y splash de iOS en `public/img/splash/` (generados con los `generate.py` de cada carpeta).

## 10. Deuda de diseño conocida

| Qué | Dónde | Arreglo sugerido |
|---|---|---|
| Sombra de foco del input usa un dorado viejo `rgba(196,149,106,.12)` | `.input:focus` (línea ~354) | Pasar a un token rosa |
| Fondo del loader usa un crema viejo `rgba(250,247,242,.88)` | `.loader` | Derivar de `--color-bg` |
| Fondo de modal y 2 sombras usan un café viejo `rgba(44,24,16,…)` | `.delete-modal-backdrop` y 2 tarjetas | Usar el tinte de `--color-ink` |
| Rojo presionado directo `#A23131` | `.delete-modal-btn--confirm:active` | Token `--color-error-active` |
| `.btn-gold` ya no es dorado | Botones "Agregar" | Renombrar a `.btn-dark` |
| Estilos en línea en varias vistas (`style="color: …"`) | login, config, agenda | Mover a clases |
| Sin `:focus-visible` en botones | Todo el CSS | Anillo de foco para teclado |
| Sin `prefers-reduced-motion` | Animaciones | Desactivar rebote y shake |
