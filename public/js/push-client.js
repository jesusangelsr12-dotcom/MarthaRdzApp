/**
 * Notificaciones push — activar/desactivar desde Configuración.
 *
 * iOS solo las soporta en la app instalada a pantalla de inicio (16.4+),
 * no dentro de Safari normal — de ahí `isPushSupported()`, para no ofrecer
 * el botón donde de todos modos va a fallar.
 */

import { getPushPublicKey, subscribePush, unsubscribePush } from './api.js';

function isIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
}

/** true si este navegador puede recibir push — en iOS, solo instalada. */
export function isPushSupported() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  if (isIOS() && !isStandalone()) return false;
  return true;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/** 'subscribed' | 'unsubscribed' | 'unsupported' */
export async function getPushStatus() {
  if (!isPushSupported()) return 'unsupported';
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  return sub ? 'subscribed' : 'unsubscribed';
}

/**
 * Pide permiso (si hace falta) y suscribe este dispositivo. Devuelve
 * 'ok', 'denied' (la usuaria negó el permiso) o lanza si algo más falla.
 */
export async function activarNotificaciones(sheetId) {
  if (!isPushSupported()) throw new Error('Este dispositivo no soporta notificaciones push');

  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') {
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') return 'denied';
  }

  const { public_key } = await getPushPublicKey(sheetId);
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(public_key),
  });

  await subscribePush(sheetId, subscription.toJSON());
  return 'ok';
}

/** Desactiva notificaciones en este dispositivo (backend + navegador). */
export async function desactivarNotificaciones(sheetId) {
  if (!isPushSupported()) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await unsubscribePush(sheetId, endpoint);
}
