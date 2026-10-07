"use client";
import { useEffect } from "react";

/**
 * Registra o service worker (`public/sw.js`) em toda página — é ele que faz o
 * navegador oferecer "Instalar app" e que mostra a tela de "sem conexão" em vez
 * do erro cru do navegador. Falha em silêncio: o CRM funciona igual sem ele.
 */
export function PwaSetup() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
  return null;
}
