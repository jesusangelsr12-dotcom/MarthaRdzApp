# Manejo de errores · Martha Rdz Hair Artist

**Última revisión:** 2026-10-05

## 1. Principios

1. **La usuaria nunca ve un error técnico.** Ve una frase corta en español y, si aplica, qué hacer ("Reintentar", "usa tu PIN").
2. **El detalle técnico va al log del servidor**, no a la pantalla.
3. **Un efecto secundario no tumba la operación principal.** Si falla el push o guardar el teléfono, la cita igual queda registrada.
4. **Lo que no es esencial falla en silencio.** Autocompletado, teléfonos y estado de push: si no cargan, la pantalla funciona igual.
5. **Nada se pierde por un error.** Doble tap bloqueado, candados en el servidor y borrado lógico.

## 2. Recorrido de un error

```
Handler (api/*.js)
 ├─ Entrada inválida ........ 400 { error: "Faltan datos requeridos o son inválidos" }
 ├─ Sin sesión / expirada ... 401 { error: "Sesión inválida o expirada" }   (lib/auth.js)
 ├─ Rol sin permiso ......... 403 { error: "Esta cuenta no tiene acceso a esto" }
 ├─ Excepción inesperada .... console.error('Error en <recurso>:', error)
 │                            500 { error: "Error al procesar <recurso>" }
 ▼
Service Worker (sw.js)
 └─ Sin red en /api/* ....... 503 { error: "Sin conexión a internet" }
 ▼
fetchAPI (public/js/api.js)
 ├─ Lee texto, intenta JSON .. si no es JSON (502 en HTML), mensaje según el código
 ├─ 401 con token ........... logout() + toast "Tu sesión expiró" + #login
 └─ !response.ok ............ throw new Error(data.error)
 ▼
Vista (public/js/views/*.js)
 ├─ Acción de la usuaria .... hideLoader() + showToast(mensaje, 'error') + reactivar botón
 ├─ Carga de pantalla ....... mensaje en rojo + botón "Reintentar"
 └─ Carga secundaria ........ catch vacío con comentario /* silencioso */
```

## 3. Backend

### Patrón obligatorio

```js
module.exports = async function handler(req, res) {
  const salonId = requireSession(req, res);
  if (!salonId) return;                       // 401/403 ya respondido

  try {
    // validar → 400 con mensaje claro
    // ejecutar
  } catch (error) {
    console.error('Error en citas:', error);   // detalle completo, solo en logs
    res.status(500).json({ error: 'Error al procesar citas' });
  }
};
```

### Reglas
- Valida **antes** de tocar la base. Un 400 dice qué falta en palabras de la usuaria ("El teléfono debe tener 10 dígitos").
- Un 404 al editar o restaurar dice por qué ("Cita no encontrada o ya no se puede restaurar").
- Nunca devuelvas `error.message` de una excepción de base de datos al cliente.
- Efectos secundarios en su propio `try/catch`:

```js
if (role === 'trabajadora') {
  try {
    await enviarPushSalon(sql, salonId, { … });
  } catch (error) {
    console.error('Error mandando push de cita nueva:', error.message);
  }
}
```

- Push a un dispositivo que ya no existe (404/410): se borra la suscripción, no se registra como error.
- Falta de configuración (secretos, VAPID): `500` con "Error de configuración del servidor" o "Notificaciones push no configuradas en el servidor".

## 4. Frontend

### Acciones (guardar, borrar, cobrar)

```js
async function submitCita() {
  if (enviandoCita) return;          // bloquea doble tap
  enviandoCita = true;
  btn.disabled = true;
  try {
    showLoader();
    await createCita(…);
    hideLoader();
    showToast('Cita registrada correctamente', 'success');
    navigateTo('home');
  } catch (error) {
    hideLoader();
    showToast(error.message || 'Error al registrar la cita', 'error');
    enviandoCita = false;            // permite reintentar
    btn.disabled = false;
  }
}
```

### Cargas de pantalla
Si falla la carga principal, reemplaza el contenido por el mensaje y un botón "Reintentar" que vuelve a llamar la misma función.

### Errores con trato especial

| Dónde | Error | Qué pasa |
|---|---|---|
| Login | "PIN incorrecto" | Puntos en rojo con sacudida y se limpian en 600 ms |
| Login | "Demasiados intentos" | Toast con el mensaje del servidor |
| Login | Otro | "Error de conexión. Intenta de nuevo." |
| Face ID | La usuaria canceló | Nada (se queda en login) |
| Face ID | Credencial desconocida | Borra la bandera local, oculta el botón, toast "usa tu PIN" |
| Push | Permiso negado | Toast con instrucción de ir a ajustes del dispositivo |
| Compartir | Usuaria cierra la hoja | No es error, no se muestra nada |
| Recibo en desktop sin teléfono | No hay cómo compartir | Toast: agrega el teléfono en Clientas |
| Registros · corregir cobro | Tocar el monto de una fila de anticipo | No abre editor. Toast: "El anticipo se corrige desde la Agenda…" |
| Registros desde la Agenda | El cobro no está en ese día | Toast "No se encontró el cobro de esa cita en este día"; la pantalla queda en ese día |
| Editar anticipo / corregir cobro | Monto vacío, en cero o sin método | Toast antes de llamar al servidor; el editor sigue abierto con lo escrito |

### Validación en el cliente
Se valida antes de llamar al servidor para dar respuesta inmediata
(nombre vacío, teléfono incompleto, costo en cero, rango de fechas invertido,
anticipo con monto pero sin método de pago).
**El servidor valida de nuevo.** El cliente nunca es la única barrera.

## 5. Registro (logging)

| Dónde | Qué se registra | Dónde verlo |
|---|---|---|
| Serverless functions | `console.error('Error en <recurso>:', error)` | Vercel → Project → Logs (o Runtime Logs del deployment) |
| Service Worker | `console.warn('SW registration failed:', err)` | Consola del navegador |
| Base de datos | Intentos de login (`login_attempts`), borrados (`deleted_at`) | SQL en Neon |

**Nunca se registra:** PINs, tokens, secretos, teléfonos ni el body completo de un request.

No hay monitoreo externo (Sentry o similar). Un error de frontend que no
llega al servidor hoy solo lo ve la usuaria.

## 6. Huecos

| # | Hueco | Estado |
|---|---|---|
| E1 | `fetchAPI` no trataba el 401 y guardar Configuración alargaba la sesión local | ✅ Resuelto en v46 (C4): 401 → Login con aviso; la expiración local sale del token |
| E2 | `fetchAPI` asumía que toda respuesta era JSON | ✅ Resuelto en v46 (C9) |
| E3 | El cobro de una cita agendada no era atómico | ✅ Resuelto en v46 (C3): una sola sentencia |
| E4 | Sin monitoreo de errores de frontend | Abierto. Errores de JavaScript en el celular pasan desapercibidos |

## 7. Cómo diagnosticar un reporte

1. Pide la pantalla, la hora aproximada y el mensaje exacto que vio.
2. Busca en los logs de Vercel `Error en <recurso>` alrededor de esa hora.
3. Si es de datos, revisa la fila en Neon (incluye `deleted_at`).
4. Si es de versión vieja, pide que abra Configuración (o su inicio) y lea "Versión N". Compara con `CACHE_NAME`.
5. Reproduce con un salón de prueba antes de tocar datos reales.
