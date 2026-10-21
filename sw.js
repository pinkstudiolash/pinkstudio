/*
 * Service worker — é o que permite instalar o painel como app.
 *
 * Estratégia: rede primeiro, cache como reserva.
 *   - Sempre que houver internet, o Pink Studio vê a versão mais nova. Um `git push`
 *     chega nela sem precisar de loja de aplicativos.
 *   - Sem internet, abre a última versão guardada, em vez do dinossauro.
 *
 * Só mexe em arquivos do próprio site. Chamadas ao Supabase passam direto:
 * agenda é informação viva, não pode vir de cache.
 */

var VERSAO = "pinkstudio-v1";

// A "casca" do app: o suficiente para a tela abrir offline.
var ARQUIVOS = [
  "./admin.html",
  "./styles.css",
  "./admin.css",
  "./config.js",
  "./db.js",
  "./admin.js",
  "./manifest-admin.json",
  "./assets/logo.jpg",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
];

self.addEventListener("install", function (evento) {
  evento.waitUntil(
    caches
      .open(VERSAO)
      .then(function (cache) {
        // addAll falha inteiro se um arquivo falhar; guardamos um a um.
        return Promise.all(
          ARQUIVOS.map(function (url) {
            return cache.add(url).catch(function () {});
          }),
        );
      })
      .then(function () {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", function (evento) {
  evento.waitUntil(
    caches
      .keys()
      .then(function (nomes) {
        return Promise.all(
          nomes.map(function (nome) {
            if (nome !== VERSAO) return caches.delete(nome);
          }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", function (evento) {
  var pedido = evento.request;

  if (pedido.method !== "GET") return;

  // Supabase e qualquer outro domínio: sempre rede, nunca cache.
  var mesmaOrigem = new URL(pedido.url).origin === self.location.origin;
  if (!mesmaOrigem) return;

  // cache: "reload" ignora o cache HTTP do navegador. O GitHub Pages manda
  // guardar os arquivos por 10 minutos, e sem isso uma correção recém-publicada
  // demorava para aparecer no celular.
  // Pedido de navegação não aceita ser reconstruído em alguns navegadores,
  // então nesse caso vai como veio.
  var busca = pedido;
  if (pedido.mode !== "navigate") {
    try {
      busca = new Request(pedido, { cache: "reload" });
    } catch (e) {
      busca = pedido;
    }
  }

  evento.respondWith(
    fetch(busca)
      .then(function (resposta) {
        if (resposta && resposta.ok) {
          var copia = resposta.clone();
          caches.open(VERSAO).then(function (cache) {
            cache.put(pedido, copia);
          });
        }
        return resposta;
      })
      .catch(function () {
        return caches.match(pedido).then(function (guardada) {
          if (guardada) return guardada;
          // navegação sem internet e sem cache da rota: cai na tela do painel
          if (pedido.mode === "navigate") return caches.match("./admin.html");
          return Response.error();
        });
      }),
  );
});

/* ------------------------------------------------------------
 *  Notificações
 * ------------------------------------------------------------
 *  O aviso chega sem conteúdo: o texto é montado aqui, no celular.
 *  Assim nenhum dado de cliente passa pelo servidor do Google/Apple.
 */

self.addEventListener("push", function (evento) {
  var texto = "Toque para abrir a agenda.";
  if (evento.data) {
    try {
      var dados = evento.data.json();
      if (dados && dados.corpo) texto = dados.corpo;
    } catch (e) {
      var bruto = evento.data.text();
      if (bruto) texto = bruto;
    }
  }

  evento.waitUntil(
    self.registration.showNotification("Novo pedido de agendamento", {
      body: texto,
      icon: "./assets/icon-192.png",
      badge: "./assets/icon-192.png",
      tag: "novo-agendamento",
      renotify: true,
      data: { url: "./admin.html" },
    }),
  );
});

self.addEventListener("notificationclick", function (evento) {
  evento.notification.close();
  var destino = new URL(
    (evento.notification.data && evento.notification.data.url) || "./admin.html",
    self.location.href,
  ).href;

  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (janelas) {
      for (var i = 0; i < janelas.length; i++) {
        if (janelas[i].url.indexOf("admin") !== -1 && "focus" in janelas[i]) {
          return janelas[i].focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
