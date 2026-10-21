/* Pink Studio — lógica do agendamento (JS puro, sem build) */
(function () {
  "use strict";

  var CONFIG = window.CONFIG;
  var guests = [];
  var selectedTime = "";
  var ocupacoes = []; // compromissos já fechados na data escolhida
  var servicos = []; // tabela de preços, vinda do banco (ou do config)
  var expediente = null; // horário de atendimento do dia escolhido
  var enviando = false;
  var mensagemAviso = null; // recado específico (ex.: horário tomado na hora)

  var AVISO_PADRAO = "Preencha nome, WhatsApp, serviço, data e horário para confirmar.";

  var ANTECEDENCIA =
    Number(CONFIG.antecedenciaMinutos) >= 0 ? Number(CONFIG.antecedenciaMinutos) : 10;
  var FOLGA = Number(CONFIG.folgaMinutos) >= 0 ? Number(CONFIG.folgaMinutos) : 10;

  var $ = function (id) {
    return document.getElementById(id);
  };

  var nameInput = $("name");
  var phoneInput = $("phone");
  var serviceSelect = $("service");
  var dateInput = $("date");
  var timesBox = $("times");
  var guestsBox = $("guests");
  var submit = $("submit");
  var hint = $("hint");

  /* ---------- helpers ---------- */

  function precoEmReais(valor) {
    var n = Number(valor) || 0;
    return "R$ " + n.toFixed(2).replace(".", ",");
  }

  // 90 -> "1h30", 60 -> "1h", 45 -> "45min"
  function duracaoPorExtenso(minutos) {
    var m = Number(minutos) || 0;
    var horas = Math.floor(m / 60);
    var resto = m % 60;
    if (!horas) return resto + "min";
    if (!resto) return horas + "h";
    return horas + "h" + String(resto).padStart(2, "0");
  }

  function servicoPorNome(nome) {
    for (var i = 0; i < servicos.length; i++) {
      if (servicos[i].nome === nome) return servicos[i];
    }
    return null;
  }

  function duracaoDoSelecionado() {
    var s = servicoPorNome(serviceSelect.value);
    return s ? Number(s.duracao_min) || 60 : 0;
  }

  function serviceOptions(select, selected) {
    select.innerHTML = "";
    var empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Selecione um serviço";
    select.appendChild(empty);
    servicos.forEach(function (s) {
      var opt = document.createElement("option");
      // Na tela aparece com preço e duração; o valor guardado é só o nome,
      // porque é ele que vai na mensagem do WhatsApp e no banco.
      opt.value = s.nome;
      opt.textContent =
        s.nome + " — " + precoEmReais(s.preco) + " · " + duracaoPorExtenso(s.duracao_min);
      if (s.nome === selected) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function formatDate(value) {
    // value vem como "AAAA-MM-DD" do <input type="date">
    var parts = String(value).split("-");
    if (parts.length !== 3) return value;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function digits(value) {
    return String(value).replace(/\D/g, "");
  }

  function formatPhone(value) {
    var d = digits(value).slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return "(" + d.slice(0, 2) + ") " + d.slice(2);
    if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
    return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
  }

  /* ---------- horários: relógio e encaixe ---------- */

  // Minutos desde a meia-noite de um "HH:MM".
  function emMinutos(hhmm) {
    var p = String(hhmm).split(":");
    if (p.length !== 2) return null;
    return Number(p[0]) * 60 + Number(p[1]);
  }

  // Momento exato de um horário na data escolhida.
  function quandoAcontece(hhmm) {
    var d = String(dateInput.value).split("-");
    var h = String(hhmm).split(":");
    if (d.length !== 3 || h.length !== 2) return null;
    return new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]), Number(h[0]), Number(h[1]), 0, 0);
  }

  // Horário só aparece se ainda faltar a antecedência mínima para ele.
  function aindaDaTempo(hhmm) {
    var quando = quandoAcontece(hhmm);
    if (!quando) return true;
    return quando.getTime() - Date.now() >= ANTECEDENCIA * 60000;
  }

  // O atendimento de duração D começando em hhmm cabe na agenda?
  //
  // Precisa de folga dos dois lados: entre o fim de um compromisso e o começo
  // do outro tem que sobrar FOLGA minutos. É isso que faz quem marca 09:00 num
  // serviço de 1h30 empurrar o próximo horário livre para depois das 10:40.
  function cabeNaAgenda(hhmm, duracao) {
    var inicio = emMinutos(hhmm);
    if (inicio === null) return true;
    var fim = inicio + (Number(duracao) || 0);

    for (var i = 0; i < ocupacoes.length; i++) {
      var oInicio = emMinutos(ocupacoes[i].horario);
      if (oInicio === null) continue;
      var oFim = oInicio + (Number(ocupacoes[i].duracao) || 0);

      var conflita = inicio < oFim + FOLGA && oInicio < fim + FOLGA;
      if (conflita) return false;
    }
    return true;
  }

  function doisDigitos(n) {
    return String(n).padStart(2, "0");
  }

  // Monta os horários oferecidos no dia a partir do expediente do Pink Studio.
  // Sem expediente (banco fora do ar), usa a lista de reserva do config.
  function gradeDoDia() {
    if (!expediente) return CONFIG.times.slice();
    if (expediente.fechado) return [];

    var abre = emMinutos(expediente.abre);
    var fecha = emMinutos(expediente.fecha);
    var passo = Number(expediente.passo_min) || 60;
    if (abre === null || fecha === null || passo < 5) return CONFIG.times.slice();

    var almocoIni = expediente.almoco_inicio ? emMinutos(expediente.almoco_inicio) : null;
    var almocoFim = expediente.almoco_fim ? emMinutos(expediente.almoco_fim) : null;

    // "fecha" é o ÚLTIMO horário que o Pink Studio aceita começar um atendimento,
    // não o fim do expediente: marcado às 19:00, ela sai quando terminar.
    var duracao = duracaoDoSelecionado() || passo;

    var grade = [];
    for (var t = abre; t <= fecha; t += passo) {
      // O almoço continua sendo intervalo de verdade: não oferece horário que
      // comece dentro dele nem atendimento que o atravesse.
      if (almocoIni !== null && almocoFim !== null) {
        var invadeAlmoco = t < almocoFim && almocoIni < t + duracao;
        if (invadeAlmoco) continue;
      }
      grade.push(doisDigitos(Math.floor(t / 60)) + ":" + doisDigitos(t % 60));
    }
    return grade;
  }

  function horariosDisponiveis() {
    var duracao = duracaoDoSelecionado();
    return gradeDoDia().filter(function (t) {
      return aindaDaTempo(t) && cabeNaAgenda(t, duracao);
    });
  }

  function horarioValido(t) {
    return (
      Boolean(t) &&
      gradeDoDia().indexOf(t) !== -1 &&
      aindaDaTempo(t) &&
      cabeNaAgenda(t, duracaoDoSelecionado())
    );
  }

  /* ---------- estado do formulário ---------- */

  function isReady() {
    return Boolean(
      nameInput.value.trim() &&
        digits(phoneInput.value).length >= 10 &&
        serviceSelect.value &&
        dateInput.value &&
        dateInput.value >= dateInput.min &&
        dateInput.value <= dateInput.max &&
        horarioValido(selectedTime),
    );
  }

  function listaAcompanhantes() {
    return guests.filter(function (g) {
      return g.name || g.service;
    });
  }

  function buildMessage() {
    var lines = [
      "Olá! Quero confirmar meu agendamento no Pink Studio 💗",
      "Nome: " + nameInput.value.trim(),
      "WhatsApp: " + formatPhone(phoneInput.value),
      "Serviço: " + serviceSelect.value,
      "Data: " + formatDate(dateInput.value),
      "Horário: " + selectedTime,
    ];
    listaAcompanhantes().forEach(function (g, i) {
      lines.push(
        "Acompanhante " + (i + 1) + ": " + (g.name || "—") + " — " + (g.service || "a definir"),
      );
    });
    return lines.join("\n");
  }

  function waLink(text) {
    var url = "https://wa.me/" + digits(CONFIG.whatsapp);
    return text ? url + "?text=" + encodeURIComponent(text) : url;
  }

  function elementoTexto(tag, classe, texto) {
    var el = document.createElement(tag);
    el.className = classe;
    el.textContent = texto;
    return el;
  }

  function aviso(texto) {
    mensagemAviso = texto;
    hint.textContent = texto;
    hint.style.visibility = "visible";
    hint.classList.remove("shake");
    void hint.offsetWidth; // reinicia a animação
    hint.classList.add("shake");
  }

  /* ---------- render ---------- */

  function renderTimes() {
    timesBox.innerHTML = "";

    var disponiveis = horariosDisponiveis();

    if (dateInput.value && !disponiveis.length) {
      var recado;
      if (expediente && expediente.fechado) {
        recado = "Não atendemos neste dia. Escolha outra data, por favor.";
      } else if (serviceSelect.value) {
        recado = "Não há horário livre neste dia para esse serviço. Escolha outra data, por favor.";
      } else {
        recado = "Não há mais horário para este dia. Escolha outra data, por favor.";
      }
      timesBox.appendChild(elementoTexto("p", "sem-horario", recado));
      return;
    }

    disponiveis.forEach(function (t) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "time" + (t === selectedTime ? " is-active" : "");
      btn.textContent = t;
      btn.setAttribute("aria-pressed", t === selectedTime ? "true" : "false");
      btn.addEventListener("click", function () {
        selectedTime = t;
        mensagemAviso = null; // escolheu outro horário: recado antigo sai
        renderTimes();
        update();
      });
      timesBox.appendChild(btn);
    });
  }

  function renderGuests() {
    guestsBox.innerHTML = "";
    guests.forEach(function (g, i) {
      var box = document.createElement("div");
      box.className = "guest";

      var head = document.createElement("div");
      head.className = "guest-head";
      var title = document.createElement("span");
      title.className = "guest-title";
      title.textContent = "Acompanhante " + (i + 1);
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "guest-remove";
      remove.textContent = "remover";
      remove.addEventListener("click", function () {
        guests.splice(i, 1);
        renderGuests();
        update();
      });
      head.appendChild(title);
      head.appendChild(remove);

      var gname = document.createElement("input");
      gname.className = "input";
      gname.type = "text";
      gname.placeholder = "Nome do acompanhante";
      gname.value = g.name;
      gname.addEventListener("input", function () {
        guests[i].name = gname.value;
        update();
      });

      var gservice = document.createElement("select");
      gservice.className = "input";
      serviceOptions(gservice, g.service);
      gservice.addEventListener("change", function () {
        guests[i].service = gservice.value;
        update();
      });

      box.appendChild(head);
      box.appendChild(gname);
      box.appendChild(gservice);
      guestsBox.appendChild(box);
    });
  }

  function renderPrices() {
    var list = $("price-list");
    list.innerHTML = "";
    servicos.forEach(function (s) {
      var li = document.createElement("li");

      var esquerda = document.createElement("div");
      esquerda.className = "price-nome";
      esquerda.appendChild(elementoTexto("span", "price-titulo", s.nome));
      if (s.descricao) {
        esquerda.appendChild(elementoTexto("span", "price-desc", s.descricao));
      }
      esquerda.appendChild(
        elementoTexto("span", "price-desc", "Duração: " + duracaoPorExtenso(s.duracao_min)),
      );

      var direita = document.createElement("div");
      direita.className = "price-valores";
      direita.appendChild(elementoTexto("span", "price", precoEmReais(s.preco)));
      if (Number(s.preco_antigo) > Number(s.preco)) {
        direita.appendChild(elementoTexto("span", "price-antigo", precoEmReais(s.preco_antigo)));
      }

      li.appendChild(esquerda);
      li.appendChild(direita);
      list.appendChild(li);
    });
  }

  function update() {
    var ready = isReady();
    submit.setAttribute("aria-disabled", ready || enviando ? "false" : "true");
    submit.classList.toggle("is-disabled", !ready || enviando);
    submit.href = ready ? waLink(buildMessage()) : "#";
    submit.textContent = enviando ? "Reservando…" : "Confirmar agendamento";

    if (ready) {
      hint.style.visibility = "hidden";
    } else {
      hint.textContent = mensagemAviso || AVISO_PADRAO;
      hint.style.visibility = "visible";
    }
  }

  /* ---------- dados que vêm do banco ---------- */

  function carregarServicos() {
    // Enquanto o banco não responde (ou se ele estiver fora), vale a lista
    // de reserva do config.js: melhor um preço desatualizado que uma tela vazia.
    servicos = (CONFIG.services || []).map(function (s) {
      return {
        nome: s.name,
        descricao: s.descricao || "",
        preco: s.preco,
        preco_antigo: s.precoAntigo || 0,
        duracao_min: s.duracao || 60,
      };
    });
    serviceOptions(serviceSelect, "");
    renderPrices();

    if (!window.DB || !DB.ligado) return Promise.resolve();

    return DB.listarServicos()
      .then(function (lista) {
        if (!lista || !lista.length) return;
        servicos = lista;
        var escolhido = serviceSelect.value;
        serviceOptions(serviceSelect, escolhido);
        renderPrices();
        renderGuests();
        renderTimes();
        update();
      })
      .catch(function (err) {
        console.error("Não foi possível ler a tabela de preços:", err);
      });
  }

  function carregarOcupacoes() {
    ocupacoes = [];
    expediente = null;
    renderTimes();
    update();
    if (!window.DB || !DB.ligado || !dateInput.value) return;

    timesBox.classList.add("is-loading");
    var pedidoPara = dateInput.value;
    Promise.all([DB.ocupacoes(pedidoPara), DB.expedienteDoDia(pedidoPara).catch(function () {
      return null;
    })])
      .then(function (respostas) {
        // ignora resposta de uma data que a cliente já trocou
        if (pedidoPara !== dateInput.value) return;
        ocupacoes = respostas[0];
        expediente = respostas[1];
        if (!horarioValido(selectedTime)) selectedTime = "";
        renderTimes();
        update();
      })
      .catch(function (err) {
        // Sem conexão com o banco o site não trava: segue sem bloquear
        // horários, e o Pink Studio confirma manualmente pelo WhatsApp.
        console.error("Não foi possível ler os horários ocupados:", err);
      })
      .then(function () {
        timesBox.classList.remove("is-loading");
      });
  }

  /* ---------- envio ---------- */

  function irParaWhatsApp() {
    window.location.href = waLink(buildMessage());
  }

  function enviar(e) {
    e.preventDefault();
    if (enviando) return;

    if (selectedTime && !aindaDaTempo(selectedTime)) {
      // A cliente demorou preenchendo e o horário chegou perto demais.
      selectedTime = "";
      renderTimes();
      aviso("Esse horário está muito em cima da hora. Escolha outro, por favor.");
      update();
      return;
    }
    if (selectedTime && !cabeNaAgenda(selectedTime, duracaoDoSelecionado())) {
      selectedTime = "";
      renderTimes();
      aviso("Esse horário não cabe mais para esse serviço. Escolha outro, por favor.");
      update();
      return;
    }
    if (!isReady()) {
      aviso(AVISO_PADRAO);
      return;
    }

    // Sem banco configurado: comportamento antigo, vai direto pro WhatsApp.
    if (!window.DB || !DB.ligado) {
      irParaWhatsApp();
      return;
    }

    enviando = true;
    update();

    DB.criarAgendamento({
      data: dateInput.value,
      horario: selectedTime,
      nome: nameInput.value.trim(),
      telefone: formatPhone(phoneInput.value),
      servico: serviceSelect.value,
      duracao: duracaoDoSelecionado(),
      acompanhantes: listaAcompanhantes(),
    })
      .then(function () {
        irParaWhatsApp();
      })
      .catch(function (err) {
        enviando = false;
        if (err.status === 409) {
          // O Pink Studio confirmou outra cliente neste horário nos últimos segundos.
          aviso("Esse horário acabou de ser fechado. Escolha outro, por favor.");
          selectedTime = "";
          carregarOcupacoes();
          return;
        }
        // Qualquer outro problema (internet, banco fora do ar) não pode
        // impedir a cliente de falar com o Pink Studio.
        console.error("Falha ao reservar:", err);
        update();
        irParaWhatsApp();
      });
  }

  /* ---------- init ---------- */

  carregarServicos();
  renderTimes();

  // A agenda abre só para os próximos dias: nada de passado, nada de daqui a
  // seis meses. A janela anda sozinha — amanhã ela já cobre um dia a mais.
  var pad = function (n) {
    return String(n).padStart(2, "0");
  };
  var paraISO = function (d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  };

  var DIAS_ABERTOS = Number(CONFIG.diasAbertos) > 0 ? Number(CONFIG.diasAbertos) : 15;
  var hoje = new Date();
  var ultimoDia = new Date();
  ultimoDia.setDate(ultimoDia.getDate() + DIAS_ABERTOS);

  dateInput.min = paraISO(hoje);
  dateInput.max = paraISO(ultimoDia);

  var ajuda = $("janela-datas");
  if (ajuda) {
    ajuda.textContent =
      "Agenda aberta até " +
      ultimoDia.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" }) +
      " (" +
      DIAS_ABERTOS +
      " dias).";
  }

  // O seletor nativo já bloqueia, mas dá para digitar a data na mão.
  function dataDentroDaJanela() {
    var v = dateInput.value;
    if (!v) return true;
    return v >= dateInput.min && v <= dateInput.max;
  }

  phoneInput.addEventListener("input", function () {
    phoneInput.value = formatPhone(phoneInput.value);
    update();
  });
  nameInput.addEventListener("input", update);

  // Trocar de serviço muda a duração, e a duração muda quais horários cabem.
  serviceSelect.addEventListener("change", function () {
    if (!horarioValido(selectedTime)) selectedTime = "";
    renderTimes();
    update();
  });

  dateInput.addEventListener("change", function () {
    if (!dataDentroDaJanela()) {
      dateInput.value = "";
      aviso("A agenda está aberta só até " + formatDate(dateInput.max) + ".");
      ocupacoes = [];
      renderTimes();
      update();
      return;
    }
    carregarOcupacoes();
  });

  $("add-guest").addEventListener("click", function () {
    guests.push({ name: "", service: "" });
    renderGuests();
    update();
  });

  submit.addEventListener("click", enviar);

  $("booking-form").addEventListener("submit", function (e) {
    e.preventDefault();
  });

  // Com a página aberta o relógio anda: um horário que faltava 12 minutos passa
  // a faltar 9. Reavalia de meio em meio minuto para a tela não mentir.
  setInterval(function () {
    if (!dateInput.value) return;
    if (selectedTime && !aindaDaTempo(selectedTime)) {
      selectedTime = "";
      renderTimes();
      aviso("Esse horário está muito em cima da hora. Escolha outro, por favor.");
      update();
      return;
    }
    if (horariosDisponiveis().length !== timesBox.querySelectorAll(".time").length) {
      renderTimes();
      update();
    }
  }, 30000);

  $("wa-float").href = waLink("Olá! Vim pelo site do Pink Studio 💗");

  update();
})();
