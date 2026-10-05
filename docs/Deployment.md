# Deployment · Martha Rdz Hair Artist

**Última revisión:** 2026-10-05 · **Plataforma:** Vercel (Hobby) + Neon

## 1. Ambientes

| Ambiente | Cómo se crea | Base de datos | Uso |
|---|---|---|---|
| **Local** | `npm run dev` (`vercel dev`) | La de `.env` (idealmente un branch de Neon) | Desarrollo |
| **Preview** | Cada push a una rama que no es `main` | La que tenga configurada el ambiente Preview en Vercel | Revisar un cambio en el celular antes de publicarlo |
| **Producción** | Merge a `main` | Neon, branch principal | Salones reales |

> Face ID queda atado al dominio exacto. Una credencial creada en un Preview
> no sirve en Producción, y viceversa.

> Si Preview apunta a la base de producción, lo que registres ahí es real.
> Usa un salón de prueba.

## 2. Variables de entorno

Se configuran en Vercel → Project → Settings → Environment Variables, por ambiente.

| Variable | Obligatoria | Cómo generarla | Para qué |
|---|:---:|---|---|
| `DATABASE_URL` | ✅ | Neon → Connection string (con `sslmode=require`) | Conexión a Postgres |
| `SESSION_SECRET` | ✅ | `openssl rand -hex 32` | Firma tokens de sesión y challenges de WebAuthn |
| `PIN_PEPPER` | ✅ | `openssl rand -hex 32` (distinto al anterior) | Hash de PINs |
| `VAPID_PUBLIC_KEY` | Para push | `npx web-push generate-vapid-keys` | Suscripción en el navegador |
| `VAPID_PRIVATE_KEY` | Para push | (mismo comando) | Firmar los push |
| `VAPID_SUBJECT` | Para push | `mailto:<correo de contacto>` | Lo exige el estándar Web Push: Apple y Google lo usan solo si necesitan avisar de un problema con las notificaciones. Nadie más lo ve y no se envían correos |
| `CRON_SECRET` | Recomendada | `openssl rand -hex 32` | Vercel la manda al cron; sin ella, cualquiera puede disparar la limpieza diaria |

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
2. Aplica la migración a producción **antes** del deploy:
   ```bash
   psql "$DATABASE_URL" -f scripts/migrations/NNN_nombre.sql
   ```
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
| `outputDirectory` | `public` | Solo `public/` se sirve como estático |

## 6. Operaciones frecuentes

### Primera instalación (base nueva)

Esta app tiene su propia base de datos en Neon, separada de cualquier otra.
Para levantarla desde cero:

1. Neon → **New project** → copia la connection string (con `sslmode=require`).
2. Aplica todas las migraciones en orden (crean todas las tablas):
   ```bash
   for f in scripts/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
   ```
3. Genera `SESSION_SECRET`, `PIN_PEPPER` y `CRON_SECRET` nuevos (nunca reutilices los de otra app) y las llaves VAPID.
4. Vercel → **Add New Project** → importa este repo → carga las variables de la sección 2 → Deploy.
5. Da de alta el salón con `crear-salon` (abajo) usando el mismo `PIN_PEPPER` que cargaste en Vercel.
6. Entra con el PIN desde el celular, carga servicios, productos y trabajadoras en Configuración, e instala la app en el inicio.

**Estado de la base de producción (2026-10-05):** el proyecto de Neon
"Martha Rdz App" ya tiene el esquema completo (000 a 008; la 008 se aplicó
el 2026-10-05, antes de publicar la v50) y el salón
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
| Serverless functions por deploy (Hobby) | 12 | **11 usadas** |
| Frecuencia de cron (Hobby) | Máximo una vez al día | La limpieza corre 1 vez al día |
| Push en iOS | Solo PWA instalada, iOS 16.4+ | |
| Face ID | Solo HTTPS y en el dominio donde se registró | |
