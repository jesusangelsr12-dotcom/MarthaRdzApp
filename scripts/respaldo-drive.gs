/**
 * Martha Rdz Hair Artist · receptor del respaldo diario en Google Drive
 * (Google Apps Script).
 *
 * Vive en script.google.com, en la cuenta dueña de la carpeta
 * «Martha Rdz - Base de Datos», y corre como esa cuenta: por eso puede
 * guardar en su Drive personal (una cuenta de servicio no tiene espacio ahí).
 *
 *  - doPost: la app (lib/respaldo.js) manda cada noche el .json.gz con la
 *    base completa. Revisa la clave y la huella (SHA-256), lo guarda en la
 *    carpeta (si ya hay uno con el mismo nombre, lo reemplaza) y borra los
 *    viejos: se quedan los últimos DIAS_CONSERVAR días y, para siempre, el
 *    del día 1 de cada mes. Nunca toca archivos que no sean respaldos.
 *  - revisarRespaldo: vigilante diario (7:00 en Monterrey). Si hoy no llegó
 *    el respaldo, manda un correo a esta cuenta. Así te enteras aunque la
 *    app ni siquiera haya podido llamar al script.
 *  - instalar: se corre UNA vez desde el editor. Pide los permisos y crea
 *    el vigilante.
 *
 * Pasos completos en docs/Deployment.md §8. CLAVE debe ser idéntica a
 * RESPALDO_DRIVE_CLAVE en Vercel; nunca la subas al repositorio con valor.
 */

const CLAVE = 'PEGA_AQUI_LA_CLAVE';
const CARPETA_ID = 'PEGA_AQUI_EL_ID_DE_LA_CARPETA';
const DIAS_CONSERVAR = 30;
const ZONA = 'America/Monterrey';
const PREFIJO = 'marthardz-respaldo-';
const NOMBRE_VALIDO = /^marthardz-respaldo-\d{4}-\d{2}-\d{2}(-\d{4})?\.json\.gz$/;

function doPost(e) {
  try {
    const p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!p.clave || p.clave !== CLAVE) return responder({ ok: false, error: 'Clave incorrecta: revisa RESPALDO_DRIVE_CLAVE' });
    if (!NOMBRE_VALIDO.test(String(p.nombre || ''))) return responder({ ok: false, error: 'Nombre de archivo inválido' });
    const bytes = Utilities.base64Decode(String(p.contenido || ''));
    if (!bytes.length || bytes.length !== p.bytes) return responder({ ok: false, error: 'El archivo llegó incompleto' });
    if (hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)) !== p.sha256) {
      return responder({ ok: false, error: 'El archivo llegó dañado (la huella no coincide)' });
    }

    const carpeta = DriveApp.getFolderById(CARPETA_ID);
    const mismos = carpeta.getFilesByName(p.nombre);
    while (mismos.hasNext()) mismos.next().setTrashed(true);
    const archivo = carpeta.createFile(Utilities.newBlob(bytes, 'application/gzip', p.nombre));
    archivo.setDescription('Respaldo completo de la base de Martha Rdz Hair Artist. Para regresarlo: docs/Deployment.md §8.');

    return responder({ ok: true, id: archivo.getId(), url: archivo.getUrl(), carpeta_url: carpeta.getUrl(), borrados: limpiar(carpeta) });
  } catch (err) {
    return responder({ ok: false, error: 'Error en el Apps Script: ' + (err && err.message ? err.message : err) });
  }
}

/** Manda a la papelera los respaldos de más de DIAS_CONSERVAR días, menos los del día 1. */
function limpiar(carpeta) {
  const limite = Utilities.formatDate(new Date(Date.now() - DIAS_CONSERVAR * 864e5), ZONA, 'yyyy-MM-dd');
  let borrados = 0;
  const archivos = carpeta.getFiles();
  while (archivos.hasNext()) {
    const f = archivos.next();
    const nombre = f.getName();
    if (!NOMBRE_VALIDO.test(nombre)) continue;
    const fecha = nombre.slice(PREFIJO.length, PREFIJO.length + 10);
    if (fecha < limite && fecha.slice(8) !== '01') {
      f.setTrashed(true);
      borrados += 1;
    }
  }
  return borrados;
}

/** Vigilante: correo si hoy no llegó el respaldo de la noche. */
function revisarRespaldo() {
  const hoy = Utilities.formatDate(new Date(), ZONA, 'yyyy-MM-dd');
  const carpeta = DriveApp.getFolderById(CARPETA_ID);
  const archivos = carpeta.getFiles();
  while (archivos.hasNext()) {
    if (archivos.next().getName().indexOf(PREFIJO + hoy) === 0) return;
  }
  MailApp.sendEmail(
    Session.getEffectiveUser().getEmail(),
    'Martha Rdz · No llegó el respaldo de hoy',
    'Hoy (' + hoy + ') no llegó a la carpeta «' + carpeta.getName() + '» el respaldo de la base de Martha Rdz Hair Artist.\n\n'
      + 'Qué revisar:\n'
      + '1. En la app, como dueña: Configuración → Respaldo dice el último error.\n'
      + '2. En Vercel: las variables RESPALDO_DRIVE_URL y RESPALDO_DRIVE_CLAVE de Production.\n'
      + '3. En Vercel → Logs: la ruta /api/cron/limpieza?tarea=respaldo.\n\n'
      + 'Carpeta: ' + carpeta.getUrl(),
  );
}

/** Correr UNA vez desde el editor (botón ▶ Ejecutar con «instalar» elegido). */
function instalar() {
  const carpeta = DriveApp.getFolderById(CARPETA_ID);
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'revisarRespaldo')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('revisarRespaldo').timeBased().everyDays(1).atHour(7).inTimezone(ZONA).create();
  // Lo pide aquí para que el vigilante tenga permiso de mandar correo.
  MailApp.getRemainingDailyQuota();
  Logger.log('Listo. Carpeta: ' + carpeta.getName() + ' · vigilante diario a las 7:00 (' + ZONA + ').');
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function hex(bytes) {
  return bytes.map((b) => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}
