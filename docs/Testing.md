# Pruebas · Martha Rdz Hairartist

**Última revisión:** 2026-09-26 · **Estado actual:** 38 pruebas, 38 en verde (`npm test`)

## 1. Cómo correrlas

```bash
npm test          # node --test: corre todo lo que está en test/
```

No necesita base de datos ni variables de entorno. Las pruebas de
integración levantan Postgres dentro del proceso con
[PGlite](https://pglite.dev) (dependencia de desarrollo), le aplican todas
las migraciones (`000` a `007`) y corren los handlers de `api/` de verdad.
El ayudante vive en `test/helpers/db.js`.

## 2. Qué se prueba hoy

| Archivo | Cubre | Por qué es crítico |
|---|---|---|
| `test/auth.test.js` | Crear y verificar tokens, rol de trabajadora, tokens legacy sin `role`, firma alterada, token de otro salón, expiración, entradas basura, hash de PIN con pepper | Un error aquí abre el acceso a todos los salones |
| `test/validate.test.js` | Fechas, números con rango, strings, métodos de pago, horas, estados de agenda, PIN, teléfono | Es la única barrera contra datos con forma inválida |
| `test/normalize-parity.test.js` | Que `normalizeNombre` dé lo mismo en frontend y backend | Si difieren, una misma clienta se parte en dos |
| `test/api.test.js` | Handlers contra Postgres real: cobro atómico y sin duplicar, cita cobrada que no se borra, anticipo con fecha de México, pendientes pasadas, PIN repetido, Face ID revocado, limpieza del cron, login por rol, permisos de trabajadora | Aquí vive el dinero y los permisos. Cubre los cabos sueltos C1 a C14 que son de backend |

## 3. Qué NO se prueba todavía

| Área | Riesgo | Cómo probarla |
|---|---|---|
| Handlers sin prueba todavía | `dashboard`, `comisiones`, `gastos`, `clientas`, `push-subscribe` | Agregarlas a `test/api.test.js` con el mismo ayudante |
| Reglas de dinero | Anticipo aplicado, comisión sobre precio completo, ganancia neta | Extraer los cálculos de `cita.js` y `dashboard.js` a funciones puras y probarlas |
| Frontend | Wizards, router, guardas de rol | Hoy se prueba a mano o con un navegador automatizado contra la app local. Falta dejarlo como suite en el repo |
| Service Worker | Actualización sin perder captura | Prueba manual (ver §5) |
| WebAuthn y push | Dependen del dispositivo real | Prueba manual en iPhone |

## 4. Definición de "terminado"

Un cambio está terminado cuando cumple **todo** esto:

**Código**
- [ ] `npm test` en verde.
- [ ] Si toca `lib/`, agregué o actualicé su prueba.
- [ ] Si agregué un validador, tiene su prueba en `validate.test.js`.
- [ ] Revisé el diff completo buscando qué podría romperse.

**Comportamiento**
- [ ] Probé el flujo feliz en celular (o en el emulador de iPhone del navegador).
- [ ] Probé el error principal: sin conexión, dato inválido, doble tap.
- [ ] Probé con sesión de **dueña** y con sesión de **trabajadora**.
- [ ] Si borra algo: confirmación + "Deshacer" funcionan.
- [ ] Si toca dinero: el total cuadra en Registros, Home y Dashboard.

**Entrega**
- [ ] Subí `CACHE_NAME` en `public/sw.js`. JS nuevo en `STATIC_ASSETS`.
- [ ] Migración aplicada en la base **antes** del deploy.
- [ ] Docs y CHANGELOG actualizados.
- [ ] Después del deploy: abrí la app instalada y vi la versión nueva en Configuración o en el inicio de la trabajadora.

## 5. Pruebas manuales de regresión

Correr antes de un cambio grande o de tocar dinero, permisos o el Service Worker.

### Acceso
1. PIN de dueña → inicio completo con resumen semanal.
2. PIN de trabajadora → inicio con 2 tarjetas. Escribir `#registros` en la URL → regresa a inicio.
3. PIN incorrecto 5 veces → sexto intento dice "Demasiados intentos".
4. Activar Face ID en Configuración → cerrar sesión → entrar con Face ID.

### Dinero
5. Agendar cita con anticipo de $200 → aparece como ingreso de hoy en Registros.
6. Cobrar esa cita desde el recuadro de Registrar Cita con servicio de $800 → "A cobrar hoy $600". Registros muestra "Anticipo aplicado".
7. Intentar cobrarla otra vez desde otro dispositivo → error "ya fue registrada".
8. Borrar la cita cobrada en Registros → sus comisiones desaparecen de Comisiones. "Deshacer" las regresa.
9. Dashboard del mes: ganancia neta = ingresos − gastos − comisiones.

### Agenda
10. Cancelar una cita con anticipo → el anticipo sigue en ingresos. "Volver a pendiente" funciona.
11. Eliminar una cita pendiente con anticipo → el anticipo desaparece de ingresos. "Deshacer" lo regresa.
12. Confirmar por WhatsApp → abre el chat con el primer nombre de la clienta.
13. Marcar vacaciones de una trabajadora → se ven en la lista y en el calendario del mes.

### Trabajadora
14. Registrar cita con comisión → solo se puede elegir a sí misma. A la dueña le llega el push.
15. En Agenda no ve teléfono ni botones de editar. En Agendar no ve el campo de teléfono.

### Actualización
16. Con la app abierta a media captura, publicar un deploy → la app no se recarga hasta cambiar de pantalla.

## 6. Datos de prueba

- Usa un salón de prueba creado con `npm run crear-salon -- --nombre "Pruebas" --pin <PIN único>`.
- Nunca pruebes en el salón real de un cliente.
- Para pruebas de integración, crea un branch de Neon desde producción y apunta `DATABASE_URL` a él.
