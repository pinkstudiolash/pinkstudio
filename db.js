/*
 * Conversa com o Supabase (banco da agenda), via REST — sem bibliotecas.
 * Usado pelo site público (app.js) e pelo painel do Pink Studio (admin.js).
 *
 * Se o Supabase não estiver configurado em config.js, tudo aqui vira
 * "desligado" e o site continua funcionando do jeito antigo: sem bloquear
 * horários, só montando a mensagem do WhatsApp.
 */
(function () {
  "use strict";

  var CFG = (window.CONFIG && window.CONFIG.supabase) || {};
  var URL_BASE = (CFG.url || "").replace(/\/+$/, "");
  var ANON = CFG.anonKey || "";
  var LIGADO = Boolean(URL_BASE && ANON);

  var TOKEN_KEY = "pinkstudio.sessao";

  function sessao() {
    try {
      return JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function guardarSessao(s) {
    if (s) localStorage.setItem(TOKEN_KEY, JSON.stringify(s));
    else localStorage.removeItem(TOKEN_KEY);
  }

  function headers(comToken) {
    var h = {
      apikey: ANON,
      "Content-Type": "application/json",
      Authorization: "Bearer " + ANON,
    };
    var s = sessao();
    if (comToken && s && s.access_token) {
      h.Authorization = "Bearer " + s.access_token;
    }
    return h;
  }

  function erroDe(resposta, corpo) {
    var msg = "";
    try {
      var j = JSON.parse(corpo);
      msg = j.message || j.error_description || j.msg || j.error || "";
    } catch (e) {
      msg = corpo;
    }
    var err = new Error(msg || "Erro " + resposta.status);
    err.status = resposta.status;
    return err;
  }

  function pedir(caminho, opcoes, comToken) {
    opcoes = opcoes || {};
    opcoes.headers = Object.assign(headers(comToken), opcoes.headers || {});
    return fetch(URL_BASE + caminho, opcoes).then(function (r) {
      return r.text().then(function (texto) {
        if (!r.ok) throw erroDe(r, texto);
        return texto ? JSON.parse(texto) : null;
      });
    });
  }

  /* ---------- site público ---------- */

  // Compromissos já fechados no dia: horário de início e quanto tempo ocupam.
  // Sem nome, sem telefone — só o suficiente para calcular os encaixes.
  function ocupacoes(dia) {
    if (!LIGADO || !dia) return Promise.resolve([]);
    return pedir("/rest/v1/rpc/ocupacoes", {
      method: "POST",
      body: JSON.stringify({ dia: dia }),
    })
      .then(function (linhas) {
        return (linhas || []).map(function (l) {
          return { horario: l.horario, duracao: Number(l.duracao_min) || 0 };
        });
      })
      .catch(function (err) {
        // Enquanto o supabase-servicos.sql não for rodado, a função nova não
        // existe. Cai na antiga para o site não parar de bloquear horários.
        if (err.status !== 404) throw err;
        return pedir("/rest/v1/rpc/horarios_ocupados", {
          method: "POST",
          body: JSON.stringify({ dia: dia }),
        }).then(function (linhas) {
          return (linhas || []).map(function (l) {
            return { horario: l.horario, duracao: 0 };
          });
        });
      });
  }

  // Como é o expediente num dia: abre, fecha, almoço e de quanto em quanto
  // tempo oferecer horário. Já vem com a exceção da data aplicada.
  function expedienteDoDia(dia) {
    if (!LIGADO || !dia) return Promise.resolve(null);
    return pedir("/rest/v1/rpc/expediente_do_dia", {
      method: "POST",
      body: JSON.stringify({ dia: dia }),
    }).then(function (linhas) {
      return linhas && linhas.length ? linhas[0] : null;
    });
  }

  // Tabela de preços. Leitura pública: são os serviços ativos.
  function listarServicos() {
    if (!LIGADO) return Promise.resolve(null);
    return pedir(
      "/rest/v1/servicos?select=id,nome,descricao,preco,preco_antigo,duracao_min,ativo,ordem" +
        "&ativo=is.true&order=ordem.asc,id.asc",
      { method: "GET" },
    );
  }

  function criarAgendamento(dados) {
    if (!LIGADO) return Promise.resolve(null);
    return pedir("/rest/v1/agendamentos", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        data: dados.data,
        horario: dados.horario,
        tipo: "agendamento",
        status: "pendente",
        nome: dados.nome,
        telefone: dados.telefone,
        servico: dados.servico,
        duracao_min: dados.duracao || 60,
        acompanhantes: dados.acompanhantes || [],
      }),
    });
  }

  /* ---------- painel do Pink Studio ---------- */

  function entrar(email, senha) {
    return fetch(URL_BASE + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: senha }),
    }).then(function (r) {
      return r.text().then(function (texto) {
        if (!r.ok) throw erroDe(r, texto);
        var s = JSON.parse(texto);
        guardarSessao(s);
        return s;
      });
    });
  }

  function sair() {
    guardarSessao(null);
  }

  function logada() {
    var s = sessao();
    return Boolean(s && s.access_token);
  }

  function renovar() {
    var s = sessao();
    if (!s || !s.refresh_token) return Promise.reject(new Error("sem sessão"));
    return fetch(URL_BASE + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token }),
    }).then(function (r) {
      if (!r.ok) {
        guardarSessao(null);
        throw new Error("sessão expirada");
      }
      return r.json().then(function (nova) {
        guardarSessao(nova);
        return nova;
      });
    });
  }

  // Repete o pedido uma vez se o token tiver expirado.
  function admin(caminho, opcoes) {
    return pedir(caminho, opcoes, true).catch(function (err) {
      if (err.status !== 401) throw err;
      return renovar().then(function () {
        return pedir(caminho, opcoes, true);
      });
    });
  }

  // Estar logada não basta: o cadastro do Supabase é aberto. Isto pergunta
  // ao banco se o e-mail da sessão está na lista de administradoras.
  function souAdmin() {
    return admin("/rest/v1/rpc/eh_admin", {
      method: "POST",
      body: "{}",
    }).then(function (resposta) {
      return resposta === true;
    });
  }

  function listarPorData(dia) {
    return admin(
      "/rest/v1/agendamentos?data=eq." + encodeURIComponent(dia) + "&order=horario.asc",
      { method: "GET" },
    );
  }

  // Tudo que existe entre duas datas — usado pelo calendário do mês.
  function listarPeriodo(de, ate) {
    return admin(
      "/rest/v1/agendamentos?select=data,horario,tipo,status,nome" +
        "&data=gte." + de + "&data=lte." + ate + "&order=data.asc,horario.asc",
      { method: "GET" },
    );
  }

  function listarFuturos() {
    // Precisa ser a data do relógio local. Com toISOString() o Brasil (UTC-3)
    // já vira "amanhã" às 21h, e os agendamentos do fim do dia sumiam da lista.
    var d = new Date();
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    var hoje = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    return admin(
      "/rest/v1/agendamentos?data=gte." + hoje + "&order=data.asc,horario.asc",
      { method: "GET" },
    );
  }

  function confirmar(id) {
    return admin("/rest/v1/agendamentos?id=eq." + id, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ status: "confirmado" }),
    });
  }

  function apagar(id) {
    return admin("/rest/v1/agendamentos?id=eq." + id, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  function bloquear(dia, horario, observacao) {
    return admin("/rest/v1/agendamentos", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        data: dia,
        horario: horario,
        tipo: "bloqueio",
        status: "confirmado",
        duracao_min: 0,
        nome: "Horário fechado",
        observacao: observacao || "",
      }),
    });
  }

  /* ---------- notificações push ---------- */

  function salvarAssinatura(assinatura, aparelho) {
    var j = assinatura.toJSON();
    return admin("/rest/v1/push_assinaturas", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        endpoint: j.endpoint,
        p256dh: (j.keys && j.keys.p256dh) || "",
        auth: (j.keys && j.keys.auth) || "",
        aparelho: aparelho || "",
      }),
    });
  }

  function apagarAssinatura(endpoint) {
    return admin("/rest/v1/push_assinaturas?endpoint=eq." + encodeURIComponent(endpoint), {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  /* ---------- serviços (painel) ---------- */

  function listarServicosAdmin() {
    return admin(
      "/rest/v1/servicos?select=id,nome,descricao,preco,preco_antigo,duracao_min,ativo,ordem" +
        "&order=ordem.asc,id.asc",
      { method: "GET" },
    );
  }

  function criarServico(servico) {
    return admin("/rest/v1/servicos", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(servico),
    });
  }

  function atualizarServico(id, mudancas) {
    return admin("/rest/v1/servicos?id=eq." + id, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(mudancas),
    });
  }

  function apagarServico(id) {
    return admin("/rest/v1/servicos?id=eq." + id, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  /* ---------- expediente (painel) ---------- */

  function listarExpediente() {
    return admin("/rest/v1/expediente?select=*&order=dia_semana.asc", { method: "GET" });
  }

  function salvarExpediente(diaSemana, mudancas) {
    return admin("/rest/v1/expediente?dia_semana=eq." + diaSemana, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(mudancas),
    });
  }

  function listarExcecoes(deADataDe) {
    return admin(
      "/rest/v1/agenda_excecoes?select=*&data=gte." + deADataDe + "&order=data.asc",
      { method: "GET" },
    );
  }

  function salvarExcecao(excecao) {
    return admin("/rest/v1/agenda_excecoes", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(excecao),
    });
  }

  function apagarExcecao(data) {
    return admin("/rest/v1/agenda_excecoes?data=eq." + encodeURIComponent(data), {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }

  window.DB = {
    ligado: LIGADO,
    ocupacoes: ocupacoes,
    listarServicos: listarServicos,
    expedienteDoDia: expedienteDoDia,
    criarAgendamento: criarAgendamento,
    entrar: entrar,
    sair: sair,
    logada: logada,
    souAdmin: souAdmin,
    listarPorData: listarPorData,
    listarPeriodo: listarPeriodo,
    listarFuturos: listarFuturos,
    confirmar: confirmar,
    apagar: apagar,
    bloquear: bloquear,
    listarServicosAdmin: listarServicosAdmin,
    listarExpediente: listarExpediente,
    salvarExpediente: salvarExpediente,
    listarExcecoes: listarExcecoes,
    salvarExcecao: salvarExcecao,
    apagarExcecao: apagarExcecao,
    criarServico: criarServico,
    atualizarServico: atualizarServico,
    apagarServico: apagarServico,
    salvarAssinatura: salvarAssinatura,
    apagarAssinatura: apagarAssinatura,
  };
})();
