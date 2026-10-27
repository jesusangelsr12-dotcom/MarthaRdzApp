# Deployment · Martha Rdz Hair Artist

**Última revisión:** 2026-10-27 · **Plataforma:** Vercel (Hobby) + Neon

## 1. Ambientes

| Ambiente | Cómo se crea | Base de datos | Uso |
|---|---|---|---|
| **Local** | `npm run dev` (`vercel dev`) | La de `.env` (idealmente un branch de Neon) | Desarrollo |
| **Preview** | Cada push a una rama que no es `main` | Su propio branch de Neon (`preview/<rama>`), copia de `main` que crea la integración Neon ↔ Vercel | Revisar un cambio en el celular antes de publicarlo |
| **Producción** | Merge a `main` | Neon, branch principal | Salones reales |

> Face ID queda atado al dominio exacto. Una credencial creada en un Preview
> no sirve en Producción, y viceversa.

> Si Preview apunta a la base de producción, lo que registres ahí es real.
> Usa un salón de prueba.

## 2. Variables de entorno

Se configuran en Vercel → Project → Settings → Environment Variables, por ambiente.

| Variable | Obligatoria | Cómo generarla | Para qué |
|---|:---:|---|---|
| `DATABASE_URL` | ✅ | La pone sola la integración Neon ↔ Vercel (en Preview, la de su branch). No se edita a mano | Conexión con el rol dueño. La app solo toma de aquí host y base (`lib/db.js`) |
| `APP_DB_PASSWORD` | ✅ Production y Preview | `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '=\n'` (§9) | Contraseña del rol `app_runtime`, con el que entra la app. Sin ella, en Production y Preview la app no se conecta |
| `DATABASE_URL_MIGRATIONS` | Solo en tu `.env` | Neon → Connect → rol `neondb_owner` | Migraciones y `restaurar-respaldo.js`. **Nunca en Vercel** |
| `SESSION_SECRET` | ✅ | `openssl rand -hex 32` | Firma tokens de sesión y challenges de WebAuthn |
| `PIN_PEPPER` | ✅ | `openssl rand -hex 32` (distinto al anterior) | Hash de PINs |
| `VAPID_PUBLIC_KEY` | Para push | `npx web-push generate-vapid-keys` | Suscripción en el navegador |
| `VAPID_PRIVATE_KEY` | Para push | (mismo comando) | Firmar los push |
| `VAPID_SUBJECT` | Para push | `mailto:<correo de contacto>` | Lo exige el estándar Web Push: Apple y Google lo usan solo si necesitan avisar de un problema con las notificaciones. Nadie más lo ve y no se envían correos |
| `CRON_SECRET` | ✅ para el respaldo | `openssl rand -hex 32` | Vercel la manda al cron. Sin ella, cualquiera puede disparar la limpieza diaria y el respaldo nocturno no corre (responde 503) |
| `RESPALDO_DRIVE_URL` | Para el respaldo | La URL `/exec` del Apps Script (§8) | A dónde se manda el respaldo diario. **Solo en Production** |
| `RESPALDO_DRIVE_CLAVE` | Para el respaldo | `openssl rand -hex 32` | La misma que `CLAVE` en el Apps Script. **Solo en Production** |

Ver [Security.md §6](Security.md#6-secretos) para qué pasa si se filtra o se rota cada una.

## 3. Publicar un cambio

### Antes del merge
1. `npm test` en verde.
2. Sube `CACHE_NAME` en `public/sw.js` (`jr-salones-vN` → `vN+1`). Sin esto, los celulares siguen con la versión vieja.
3. JS nuevo agregado a `STATIC_ASSETS`.
4. Revisa el límite de **12 serverless functions** si agregaste un archivo en `api/`.
5. Prueba en el Preview desde un celular (dueña y trabajadora).
6. Actualiza CHANGELOG y los docs que toca el cambio.

### Si hay migración
1. Crea un branch de Neon como respaldo (Neon → Branches → Create branch desde `main`).
2. Aplica la migración a producción **antes** del deploy, con el rol dueño:
   ```bash
   psql "$DATABASE_URL_MIGRATIONS" -v ON_ERROR_STOP=1 -f scripts/migrations/NNN_nombre.sql
   ```
   Con el rol dueño las tablas nuevas quedan de `neondb_owner` y
   `app_runtime` las puede usar sin otro `grant`.
3. Verifica que las tablas o columnas existen.
4. Ahora sí, haz merge.

### Deploy
Merge a `main` → Vercel construye y publica solo. No hay paso de build
(`npm run build` solo imprime un mensaje). `outputDirectory` es `public/`.

### Después del deploy
1. Abre la app instalada. Cambia de pantalla una vez: debe recargarse sola.
2. Revisa la versión en Configuración (dueña) o al pie del inicio (trabajadora).
3. Revisa los logs de Vercel los primeros minutos.

## 4. Revertir

| Situación | Qué hacer |
|---|---|
| El código nuevo falla | Vercel → Deployments → el anterior → **Promote to Production** (instantáneo). Luego revertir el commit en `main` |
| Los celulares siguen con código roto en caché | Publica un deploy con `CACHE_NAME` nuevo. El Service Worker trae el JS fresco |
| La app dice «Error del servidor» en todo y el log de Vercel dice «Falta APP_DB_PASSWORD» o `password authentication failed for user "app_runtime"` | Falta `APP_DB_PASSWORD` en ese ambiente, no coincide con la del rol, o ese branch de Neon se creó antes de la 010. Ver §9 |
| Una migración salió mal | Las migraciones son aditivas: casi nunca hace falta revertirlas. Si se dañaron datos, restaura desde el branch de respaldo de Neon |
| Se borró algo por error | Todo borrado es lógico: `update <tabla> set deleted_at = null where …` |

## 5. Configuración de Vercel (`vercel.json`)

| Clave | Valor | Por qué |
|---|---|---|
| `rewrites` | Todo lo que no es `/api/` → `/index.html` | SPA |
| `headers` | CSP, HSTS, etc. | Ver [Security.md §5](Security.md#5-encabezados-http-verceljson) |
| `Cache-Control` en `/css` y `/js` | `max-age=0, must-revalidate` | Que siempre revaliden. El cache `immutable` causó errores con código viejo (commit `a2707e4`) |
| `Cache-Control` en `/icons` | 1 año, `immutable` | Cambian muy poco. Se versionan con `?v=N` en el HTML |
| `crons` | `/api/cron/limpieza` a las `0 0 * * *` | 00:00 UTC = 18:00 en Ciudad de México. Borra intentos de login de más de 30 días |
| `crons` | `/api/cron/limpieza?tarea=respaldo` a las `0 9 * * *` | 09:00 UTC = 3:00 en Ciudad de México. Respaldo diario en Google Drive (§8). En Hobby, Vercel lo dispara en algún momento de esa hora (3:00–3:59) |
| `functions` | `maxDuration: 60` en `api/cron/limpieza.js` y `api/config.js` | El respaldo exporta la base y espera a Google Drive hasta 40 s; el límite por defecto se quedaba corto |
| `outputDirectory` | `public` | Solo `public/` se sirve como estático |

## 6. Operaciones frecuentes

### Primera instalación (base nueva)

Esta app tiene su propia base de datos en Neon, separada de cualquier otra.
Para levantarla desde cero:

1. Neon → **New project** → copia la connection string (con `sslmode=require`).
2. Aplica todas las migraciones en orden (crean todas las tablas y, con la
   010, el rol `app_runtime`). `DATABASE_URL_MIGRATIONS` es la connection
   string de `neondb_owner`:
   ```bash
   export APP_RUNTIME_PWD="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
   for f in scripts/migrations/*.sql; do psql "$DATABASE_URL_MIGRATIONS" -v ON_ERROR_STOP=1 -f "$f" || break; done
   ```
   Guarda `APP_RUNTIME_PWD` en tu gestor de contraseñas: va en
   `APP_DB_PASSWORD` de Vercel.
3. Genera `SESSION_SECRET`, `PIN_PEPPER` y `CRON_SECRET` nuevos (nunca reutilices los de otra app) y las llaves VAPID.
4. Vercel → **Add New Project** → importa este repo → conecta la integración de Neon (pone `DATABASE_URL`) → carga las demás variables de la sección 2, con `APP_DB_PASSWORD` en Production y Preview → Deploy.
5. Da de alta el salón con `crear-salon` (abajo) usando el mismo `PIN_PEPPER` que cargaste en Vercel.
6. Entra con el PIN desde el celular, carga servicios, productos y trabajadoras en Configuración, e instala la app en el inicio.

**Estado de la base de producción (2026-10-24):** el proyecto de Neon
"Martha Rdz App" (`broad-darkness-60286616`, branch `main`) ya tiene el
esquema completo (000 a 009; la 009 se aplicó el 2026-10-24, antes de
publicar la v51; la 010 se aplicó el 2026-10-27, antes de publicar la v52, ver §9) y el salón
`salon_002` "Martha Rodriguez Hair Artist" con su catálogo e historial, así
que los pasos 2 y 5 ya no hacen falta. La dueña entra con su PIN de siempre:
su hash es del formato anterior (sin pepper) y en el primer login se guarda
solo con el `PIN_PEPPER` nuevo. Las trabajadoras no traen PIN: la dueña les
da acceso desde Configuración.

### Dar de alta un salón

```bash
npm run crear-salon -- --nombre "Nuevo Salón" --pin 123456
npm run crear-salon -- --nombre "Nuevo Salón" --pin 123456 --plantilla salon_002
```

Necesita `DATABASE_URL` y el **mismo** `PIN_PEPPER` de producción en `.env`.

`--plantilla` copia servicios, productos y el **nombre** de cada trabajadora,
nunca su PIN: después hay que darles acceso desde Configuración. El script
rechaza un `--pin` que ya use otra dueña o trabajadora.

### Cambiar el PIN de una dueña

No hay pantalla ni script para esto. Calcula el hash con el pepper de producción:

```bash
PIN_PEPPER='<pepper de producción>' node -e \
  "console.log(require('./lib/auth').pepperedPinHash('654321'))"
```

Y actualízalo en Neon (verifica antes que ningún otro salón o trabajadora use ese hash):

```sql
update salones set pin_hash_v2 = '<hash>', pin_hash = '' where salon_id = 'salon_002';
```

### Cambiar o quitar el PIN de una trabajadora
Desde la app: Configuración → la trabajadora → "Cambiar PIN" o "Quitar acceso".

### Activar notificaciones push por primera vez
1. Genera llaves VAPID y cárgalas en Vercel (las 3 variables).
2. Redeploy.
3. En el iPhone de la dueña: app instalada en inicio → Configuración → Notificaciones → Activar.

## 7. Límites de la plataforma

| Límite | Valor | Estado |
|---|---|---|
| Serverless functions por deploy (Hobby) | 12 | **11 usadas** (el respaldo vive dentro de `cron/limpieza` y `config`) |
| Frecuencia de cron (Hobby) | Máximo una vez al día, dentro de la hora indicada | Limpieza y respaldo, 1 vez al día cada uno |
| Apps Script (cuenta gratuita) | 6 min por ejecución, 50 MB por POST | El respaldo pesa decenas de KB |
| Push en iOS | Solo PWA instalada, iOS 16.4+ | |
| Face ID | Solo HTTPS y en el dominio donde se registró | |

## 8. Respaldo diario en Google Drive

Neon (plan gratuito) solo guarda **6 horas** de historia. Por eso, cada noche
a las **3:00** (cron `/api/cron/limpieza?tarea=respaldo`) la app exporta la
base completa a un archivo `marthardz-respaldo-AAAA-MM-DD.json.gz` y lo
guarda en la carpeta **«Martha Rdz - Base de Datos»** de Google Drive (cuenta
`jesusangelsr12@gmail.com`, carpeta `1JOSyY3J2QV-WSL2j2qeZGvzyL1krvLbJ`). Se
quedan los últimos **30 días** y, para siempre, el del **día 1** de cada mes.

| Pieza | Qué hace |
|---|---|
| `lib/respaldo.js` | Exporta todas las tablas (menos `login_attempts` y `respaldos`) con `to_jsonb`, comprime con gzip, calcula la huella SHA-256 y lo manda al Apps Script. Cada intento, bueno o malo, queda en la tabla `respaldos` |
| `scripts/respaldo-drive.gs` | **Google Apps Script** en la cuenta dueña de la carpeta: revisa clave, nombre, tamaño y huella, guarda el archivo (reemplaza el del mismo día), borra los viejos y, a las 7:00, manda un correo si ese día no llegó nada |
| Configuración → Respaldo | La dueña ve si el último salió, cuándo, el tamaño, los registros y los últimos 10 intentos, y puede tocar **Respaldar ahora** |
| `scripts/restaurar-respaldo.js` | Revisa un archivo y lo carga en una base vacía |

> **¿Por qué un Apps Script y no una cuenta de servicio?** En un Drive
> personal (Gmail) una cuenta de servicio no tiene espacio propio: Google
> rechaza lo que sube («Service Accounts do not have storage quota»). El
> script corre como la dueña de la carpeta y usa su espacio. No hay tokens
> que venzan.

> El archivo trae los datos de las clientas (nombres, teléfonos, notas
> fijas, fórmulas) y los hashes de los PINs (inútiles sin `PIN_PEPPER`, que
> no va en el respaldo). La carpeta no se comparte con nadie.

### Conectarlo (una vez, ~10 min)

1. **Clave.** `openssl rand -hex 32`. Es la misma en el script y en Vercel.
2. **Apps Script.** Con la cuenta dueña de la carpeta, abre
   [script.new](https://script.new). Nómbralo «Martha Rdz · Respaldo», borra
   lo que trae y pega `scripts/respaldo-drive.gs`. Pon la clave en `CLAVE` y
   el ID de la carpeta en `CARPETA_ID` (lo que sigue de `folders/` en su
   link). Guarda (⌘S / Ctrl+S).
3. **Permisos y vigilante.** Arriba elige la función `instalar` y toca
   **▶ Ejecutar**. Google pide permiso (Drive y Gmail): «Revisar permisos» →
   tu cuenta → «Configuración avanzada» → «Ir a Martha Rdz · Respaldo (no
   seguro)» → Permitir. Es tu propio script; el aviso sale porque Google no
   lo revisó. El registro dice «Listo. Carpeta: Martha Rdz - Base de Datos…».
4. **Publicarlo.** Implementar → **Nueva implementación** → tipo
   **Aplicación web** · Ejecutar como **Yo** · Quién tiene acceso
   **Cualquier usuario** → Implementar. Copia la URL (termina en `/exec`).
   «Cualquier usuario» solo significa que la URL responde; sin la clave no
   guarda nada.
5. **Vercel.** Settings → Environment Variables, solo **Production**:
   `RESPALDO_DRIVE_URL` (la URL) y `RESPALDO_DRIVE_CLAVE` (la clave). Haz un
   **Redeploy** para que las tome. `CRON_SECRET` ya debe existir.
6. **Probar.** En la app, como dueña: Configuración → Respaldo en Google
   Drive → **Respaldar ahora**. Debe decir «Respaldo guardado en Google
   Drive» y el archivo (con la hora en el nombre) aparece en la carpeta.

Si después cambias el código del script, hay que publicar una versión nueva:
Implementar → Gestionar implementaciones → editar → Versión: **Nueva
versión**. La URL no cambia.

### Si algo falla

| Error en Configuración → Respaldo | Qué revisar |
|---|---|
| «Clave incorrecta» | `RESPALDO_DRIVE_CLAVE` en Vercel ≠ `CLAVE` en el script |
| «El Apps Script no respondió como se esperaba» | La implementación no es «Aplicación web» o el acceso no es «Cualquier usuario» |
| «Google Drive respondió 404» | La URL está mal o esa implementación se archivó |
| «Google Drive no respondió a tiempo» | Google tardó más de 40 s. Si se repite, revisa el estado de Google y el tamaño del archivo |
| «Error en el Apps Script: …» | La carpeta se borró o cambió de dueño (revisa `CARPETA_ID`) |
| «Atrasado» sin error | El cron no corrió: Vercel → Settings → Cron Jobs y que exista `CRON_SECRET` |
| «Sin conectar» | Faltan `RESPALDO_DRIVE_URL` o `RESPALDO_DRIVE_CLAVE` en Production (o no se hizo Redeploy) |

### Regresar un respaldo

1. Descarga el archivo de Drive (`marthardz-respaldo-AAAA-MM-DD.json.gz`).
2. Revísalo: `node scripts/restaurar-respaldo.js marthardz-respaldo-AAAA-MM-DD.json.gz`
   (dice la fecha, la migración y cuántos registros trae cada tabla).
3. En Neon crea un branch nuevo (ej. `restaurado-AAAA-MM-DD`) con la opción
   **Schema only** (copia las tablas sin datos y el rol `app_runtime`), o usa
   una base vacía con las migraciones `000`–`010` aplicadas. Si el respaldo es de una migración
   anterior a la del branch, no pasa nada: las columnas nuevas quedan con su
   valor por defecto.
4. Cárgalo con el rol dueño (al final ajusta las secuencias con `setval`,
   que `app_runtime` no puede):
   `DATABASE_URL_MIGRATIONS="<conexión de neondb_owner al branch nuevo>" node scripts/restaurar-respaldo.js archivo.json.gz --restaurar`.
   Todo entra en una transacción; si alguna tabla ya tiene datos no hace
   nada. El ciclo `citas.agenda_id` ↔ `citas_agendadas.deposito_cita_id` y
   la referencia de `citas.anticipo_origen_id` a su propia tabla se cargan
   en dos pasos (primero vacías, al final con un `update`).
5. Revisa ese branch (un Preview apuntando a él, o la consola de Neon).
   Cuando esté bien, en Neon → Integrations → Vercel → **Production
   branch** elige ese branch y haz un redeploy. Antes revisa que tenga
   `app_runtime` con la contraseña de `APP_DB_PASSWORD` (en una base vacía,
   la que le diste al aplicar la 010).

Lo que no viene en el respaldo: los intentos de login (se borran solos) y la
bitácora de respaldos. Los dispositivos con Face ID y las suscripciones de
push sí vienen y siguen sirviendo si `PIN_PEPPER` y el dominio son los
mismos.

## 9. Rol de la app en la base (`app_runtime`)

Desde la v52 la app no entra a Neon como `neondb_owner` (dueño de todo y
miembro de `neon_superuser`), sino como `app_runtime`, que solo lee y
escribe filas ([Database.md §8](Database.md#8-roles)).

**Cómo se conecta.** La integración Neon ↔ Vercel sigue poniendo
`DATABASE_URL` con el rol dueño; en cada Preview pone la de su propio
branch al momento del deploy (no se ve en Settings). `lib/db.js` toma de ahí
el host y la base, cambia usuario y contraseña por `app_runtime` +
`APP_DB_PASSWORD`, usa el host `-pooler` y exige
`sslmode=require&channel_binding=require`. Como cada branch nuevo copia el
rol con su contraseña, la misma `APP_DB_PASSWORD` sirve en Production y en
todos los Preview. En local (`vercel dev`), sin `APP_DB_PASSWORD`, usa la
`DATABASE_URL` de `.env` tal cual.

### Publicar la v52 (una sola vez, en este orden)

1. **Branch de respaldo** en Neon desde `main` (§3, «Si hay migración»).
2. **Crear el rol en `main`** desde tu terminal (psql 15 o más nuevo; la
   contraseña no se imprime ni queda en el historial):
   ```bash
   export APP_RUNTIME_PWD="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
   psql "$DATABASE_URL_MIGRATIONS" -v ON_ERROR_STOP=1 -f scripts/migrations/010_rol_app_runtime.sql
   ```
   Debe terminar con `CREATE ROLE`, cuatro `GRANT` y dos
   `ALTER DEFAULT PRIVILEGES`. Si ya existía el rol, no lo toca.
3. **Revisar el rol** con la consulta de [Database.md §8](Database.md#8-roles):
   todo en `f`.
4. **Vercel → Settings → Environment Variables → Add:** `APP_DB_PASSWORD`
   con el valor de `APP_RUNTIME_PWD` (cópialo con
   `printf %s "$APP_RUNTIME_PWD" | pbcopy` en Mac), marcada **Sensitive**,
   en **Production y Preview**. No toques `DATABASE_URL`.
5. **Preview.** Haz push de la rama: Vercel crea un branch de Neon nuevo
   (ya trae el rol). Un Preview cuyo branch se creó antes del paso 2 no lo
   tiene: bórralo en Neon y vuelve a desplegar.
6. **Probar en el Preview** (dueña y trabajadora): entrar con PIN, registrar
   una cita, editar su nota, un gasto. En el log de la función no debe haber
   `permission denied`.
7. **Merge a `main`.** En Production repite la prueba y además
   Configuración → Respaldo → **Respaldar ahora** (solo Production tiene
   Drive).
8. **Confirmar que entra como `app_runtime`** en Neon → SQL Editor:
   ```sql
   select usename, count(*) from pg_stat_activity
   where datname = 'neondb' group by usename;
   ```
   Con la app en uso aparece `app_runtime`.

Si algo falla en el paso 7: Vercel → el deploy anterior → **Promote to
Production** (§4). El rol puede quedarse: no estorba.

### Probar el rol a mano

```bash
PGPASSWORD="$APP_RUNTIME_PWD" psql "host=<host>-pooler.<region>.aws.neon.tech dbname=neondb user=app_runtime sslmode=require channel_binding=require" <<'SQL'
select current_user;          -- app_runtime
create role prueba;           -- ERROR: permission denied to create role
drop table citas;             -- ERROR: must be owner of table citas
create table x (id int);      -- ERROR: permission denied for schema public
SQL
```

Cambiar la contraseña o quitar el rol: [Security.md §6](Security.md#6-secretos).
