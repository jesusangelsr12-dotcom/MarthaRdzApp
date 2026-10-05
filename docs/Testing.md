# Pruebas · Martha Rdz Hair Artist

**Última revisión:** 2026-10-05 · **Estado actual:** 47 pruebas, 47 en verde (`npm test`)

## 1. Cómo correrlas

```bash
npm test          # node --test: corre todo lo que está en test/
```

No necesita base de datos ni variables de entorno. Las pruebas de
integración levantan Postgres dentro del proceso con
[PGlite](https://pglite.dev) (dependencia de desarrollo), le aplican todas
las migraciones (`000` a `008`) y corren los handlers de `api/` de verdad.
El ayudante vive en `test/helpers/db.js`.

## 2. Qué se prueba hoy

| Archivo | Cubre | Por qué es crítico |
|---|---|---|
| `test/auth.test.js` | Crear y verificar tokens, rol de trabajadora, tokens legacy sin `role`, firma alterada, token de otro salón, expiración, entradas basura, hash de PIN con pepper | Un error aquí abre el acceso a todos los salones |
| `test/validate.test.js` | Fechas, números con rango, strings, métodos de pago, PIN, teléfono, uuid | Es la única barrera contra datos con forma inválida |
| `test/normalize-parity.test.js` | Que `normalizeNombre` dé lo mismo en frontend y backend | Si difieren, una misma clienta se parte en dos |
| `test/api.test.js` | Handlers contra Postgres real: cita con comisiones, comisión solo a sí misma, PIN repetido, Face ID revocado, limpieza del cron, login por rol, trabajadora sin teléfonos ni notas fijas (aunque tenga guardado el permiso viejo), permisos desconocidos, catálogo que conserva el PIN. **Anticipo (v50):** va dentro del total (2500 con 500 cuenta 2500 en el Dashboard y la comisión sale de 2500), nunca mayor que el total (API y base), aplicar un anticipo de la Agenda lo mueve al día de la cita sin contarlo doble, no se aplica dos veces, monto/salón/tipo deben coincidir, todo o nada si algo falla, eliminar la cita lo regresa a pendiente y "Deshacer" no lo cuenta doble. **Corregir precios:** recalcula total y comisión (mismo %) y se ve en el Dashboard, conserva el anticipo si no se manda, no cambia servicios ni deja el anticipo arriba del total (sin tocar nada si falla), el anticipo de la Agenda no cambia de monto, la fila de solo-anticipo no se corrige, el cobro viejo de la Agenda conserva su descuento, solo la dueña y 404 | Aquí vive el dinero y los permisos. Cubre los cabos sueltos de backend que siguen vigentes |

## 3. Qué NO se prueba todavía

| Área | Riesgo | Cómo probarla |
|---|---|---|
| Handlers sin prueba todavía | `comisiones`, `gastos`, `push-subscribe` (`dashboard` y `clientas` solo en lo que toca a anticipos y permisos) | Agregarlas a `test/api.test.js` con el mismo ayudante |
| Reglas de dinero del frontend | Cálculo de la comisión y "Resta por cobrar" en `cita.js` | Extraer los cálculos de `cita.js` a funciones puras y probarlas |
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
2. PIN de trabajadora → inicio con 1 tarjeta (Registrar Cita). Escribir `#registros` en la URL → regresa a inicio. Escribir `#agenda` → regresa a inicio (con cualquier rol).
3. PIN incorrecto 5 veces → sexto intento dice "Demasiados intentos".
4. Activar Face ID en Configuración → cerrar sesión → entrar con Face ID.

### Dinero
5. Registrar cita de $2,500 con anticipo de $500 y 10 % de comisión → el resumen dice Total $2,500, Anticipo $500, Resta por cobrar $2,000. Registros: $2,500 con "Incluye anticipo de $500". Comisión $250.
6. Anticipo mayor que el total → "El anticipo no puede ser mayor que el total". "Sin anticipo" → el resumen dice "Sin anticipo".
7. Clienta con anticipo de la Agenda → al escribir su nombre aparece "Ya tiene anticipo"; en el paso de anticipo, tocar su tarjeta y registrar → el anticipo desaparece del día en que se pagó y la cita cuenta el total completo.
8. Intentar aplicar ese mismo anticipo otra vez desde otro dispositivo → "Ese anticipo ya se aplicó a otra cita".
9. Borrar esa cita en Registros → el anticipo regresa a su día y sus comisiones desaparecen. "Deshacer" lo vuelve a aplicar.
10. Dashboard del mes: ganancia neta = ingresos − gastos − comisiones.
11. En Registros, "Corregir precios" de una cita con comisión: cambiar $2,500 → $2,800 → el total en vivo y la tarjeta dicen el nuevo total, y en Comisiones la comisión cambia con el mismo %. Anticipo mayor que el total → aviso y no se guarda.

### Trabajadora
12. Registrar cita con comisión y anticipo → solo se puede elegir a sí misma; ve el paso de anticipo igual que la dueña. A la dueña le llega el push.
13. Configuración de la dueña ya no muestra "Puede usar" en las trabajadoras.

### Actualización
14. Con la app abierta a media captura, publicar un deploy → la app no se recarga hasta cambiar de pantalla.

## 6. Datos de prueba

- Usa un salón de prueba creado con `npm run crear-salon -- --nombre "Pruebas" --pin <PIN único>`.
- Nunca pruebes en el salón real de un cliente.
- Para pruebas de integración, crea un branch de Neon desde producción y apunta `DATABASE_URL` a él.
