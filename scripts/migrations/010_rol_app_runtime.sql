-- Rol de mínimo privilegio para la app — aplicar UNA VEZ en el branch
-- principal de Neon antes de desplegar el código que lo usa (lib/db.js).
-- Idempotente: si el rol ya existe no lo toca y solo repite los GRANT.
--
-- Es un script de psql (usa \getenv y \gexec): no se pega en la consola de
-- Neon. Se crea por SQL y no desde la consola porque los roles de la
-- consola entran a neon_superuser (BYPASSRLS, CREATEROLE, leer y escribir
-- todo). Este solo lee y escribe filas: no crea, altera ni borra tablas,
-- roles ni bases.
--
-- La contraseña nunca va en este archivo ni en la línea de comandos: se
-- lee de la variable de entorno APP_RUNTIME_PWD. base64url para que no
-- lleve + / = y no haya que escaparla en la URL de conexión.
--
--   export APP_RUNTIME_PWD="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')"
--   psql "$DATABASE_URL_MIGRATIONS" -v ON_ERROR_STOP=1 -f scripts/migrations/010_rol_app_runtime.sql
--
-- El mismo valor va en APP_DB_PASSWORD de Vercel (Production y Preview).
-- Los branches de Neon que se creen después copian el rol con su
-- contraseña; los que ya existían no lo tienen.

\set ON_ERROR_STOP on
\set ECHO none
\getenv pwd APP_RUNTIME_PWD

select not exists (select 1 from pg_roles where rolname = 'app_runtime') as crear_rol \gset

\if :crear_rol
  \if :{?pwd}
    -- %L escapa el valor; \gexec ejecuta el CREATE sin imprimirlo.
    select format(
      'create role app_runtime login password %L nosuperuser nocreatedb nocreaterole noreplication nobypassrls',
      :'pwd'
    ) \gexec
  \else
    do $$ begin raise exception 'Falta APP_RUNTIME_PWD: exporta la contraseña antes de correr esta migración'; end $$;
  \endif
\endif

\unset pwd

grant connect on database :"DBNAME" to app_runtime;
grant usage on schema public to app_runtime;
grant select, insert, update, delete on all tables in schema public to app_runtime;
grant usage, select on all sequences in schema public to app_runtime;

-- Lo que creen las migraciones futuras (corren como neondb_owner) también.
alter default privileges for role neondb_owner in schema public
  grant select, insert, update, delete on tables to app_runtime;
alter default privileges for role neondb_owner in schema public
  grant usage, select on sequences to app_runtime;
