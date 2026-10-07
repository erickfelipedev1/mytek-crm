// Service worker do app instalável (PWA).
//
// - Sem conexão: abrir uma página mostra /offline.html em vez do erro do navegador.
// - NÃO guarda cache de dado nenhum: o CRM é todo online, e cachear página de
//   quem está logado serviria tela velha (ou de OUTRA pessoa, num aparelho
//   compartilhado).
// - NEUTRO de marca de propósito: a imagem é uma só para todas as marcas, então
//   nada aqui pode dizer o nome do produto (ver app/manifest.ts).
//
// Notificações push ficam para uma próxima etapa (precisam de chaves VAPID e de
// uma tabela de inscrições).

const CACHE = "crm-pwa-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  // Se não der pra guardar a tela offline (armazenamento cheio ou bloqueado),
  // segue mesmo assim — instalar o app não pode depender disso.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(OFFLINE))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// Só navegações (abrir página): tenta a rede; se cair, mostra a tela offline.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(OFFLINE).then((r) => r || new Response("Sem conexão", { status: 503 }))
    )
  );
});
