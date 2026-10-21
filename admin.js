/* Painel da agenda do Pink Studio */
(function () {
  "use strict";

  var CONFIG = window.CONFIG;
  var $ = function (id) {
    return document.getElementById(id);
  };

  var telaDesligado = $("tela-desligado");
  var telaLogin = $("tela-login");
  var telaAgenda = $("tela-agenda");
  var diaInput = $("dia");
  var slotsBox = $("slots");
  var proximosBox = $("proximos");
  var resumoDia = $("resumo-dia");
  var erroLogin = $("erro-login");
  var btnSair = $("sair");

  var doDia = []; // registros do dia que está na tela
  var expedienteDoDiaNaTela = null; // horário de atendimento do dia na tela

  // Mesma grade que a cliente enxerga, para o Pink Studio ver o dia como ele é.
  // Sem expediente (banco antigo), cai na lista de reserva do config.
  function gradeDoExpediente() {
    var e = expedienteDoDiaNaTela;
    if (!e) return (CONFIG.times || []).slice();
    if (e.fechado) return [];

    var paraMin = function (hhmm) {
      var p = String(hhmm).split(":");
      return p.length < 2 ? null : Number(p[0]) * 60 + Number(p[1]);
    };
    var abre = paraMin(e.abre);
    var fecha = paraMin(e.fecha);
    var passo = Number(e.passo_min) || 60;
    if (abre === null || fecha === null) return (CONFIG.times || []).slice();

    var almocoIni = e.almoco_inicio ? paraMin(e.almoco_inicio) : null;
    var almocoFim = e.almoco_fim ? paraMin(e.almoco_fim) : null;

    var grade = [];
    for (var t = abre; t <= fecha; t += passo) {
      if (almocoIni !== null && almocoFim !== null && t >= almocoIni && t < almocoFim) continue;
      grade.push(String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0"));
    }
    return grade;
  }

  /* ---------- utilidades ---------- */

  function hojeISO() {
    var d = new Date();
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function porExtenso(iso) {
    var p = String(iso).split("-");
    if (p.length !== 3) return iso;
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
    });
  }

  function curta(iso) {
    var p = String(iso).split("-");
    return p.length === 3 ? p[2] + "/" + p[1] : iso;
  }

  function somaDias(iso, n) {
    var p = String(iso).split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + n);
    var pad = function (x) {
      return String(x).padStart(2, "0");
    };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function soDigitos(t) {
    return String(t).replace(/\D/g, "");
  }

  function linkWhats(telefone, texto) {
    var d = soDigitos(telefone);
    if (!d) return null;
    if (d.length <= 11) d = "55" + d;
    var url = "https://wa.me/" + d;
    return texto ? url + "?text=" + encodeURIComponent(texto) : url;
  }

  // Troca {nome}, {data}, {hora} e {servico} pelos dados do agendamento.
  function mensagemPronta(qual, reg) {
    var modelos = CONFIG.mensagens || {};
    var texto = modelos[qual];
    if (!texto) return "";
    return texto
      .replace(/\{nome\}/g, (reg.nome || "").split(" ")[0])
      .replace(/\{data\}/g, curta(reg.data))
      .replace(/\{hora\}/g, reg.horario || "")
      .replace(/\{servico\}/g, reg.servico || "");
  }

  // Link já com o texto certo para a situação do pedido.
  function botaoWhats(reg, qual, rotulo) {
    var url = linkWhats(reg.telefone, mensagemPronta(qual, reg));
    if (!url) return null;
    var a = elemento("a", "btn-ghost btn-whats", rotulo);
    a.href = url;
    a.target = "_blank";
    a.rel = "noreferrer";
    return a;
  }

  function mostrar(tela) {
    telaDesligado.hidden = tela !== "desligado";
    telaLogin.hidden = tela !== "login";
    telaAgenda.hidden = tela !== "agenda";
    btnSair.hidden = tela !== "agenda";
  }

  function elemento(tag, classe, texto) {
    var el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto != null) el.textContent = texto;
    return el;
  }

  function botao(rotulo, aoClicar) {
    var b = elemento("button", "btn-ghost", rotulo);
    b.type = "button";
    b.addEventListener("click", function () {
      b.disabled = true;
      Promise.resolve(aoClicar())
        .catch(function (err) {
          if (err.status === 409) {
            alert("Esse horário já está confirmado para outra pessoa.");
            return recarregar();
          }
          alert("Não deu certo: " + (err.message || err));
        })
        .then(function () {
          b.disabled = false;
        });
    });
    return b;
  }

  /* ---------- agenda do dia ---------- */

  function recarregar() {
    var tarefas = [carregarProximos()];
    if (paginaAtual === "mes") tarefas.push(carregarMes());
    if (paginaAtual === "dia") tarefas.push(carregarDia());
    return Promise.all(tarefas);
  }

  function carregarDia() {
    var dia = diaInput.value || hojeISO();
    slotsBox.innerHTML = "";
    slotsBox.appendChild(elemento("li", "carregando", "Carregando…"));
    resumoDia.textContent = porExtenso(dia);

    return Promise.all([
      DB.listarPorData(dia),
      DB.expedienteDoDia(dia).catch(function () {
        return null;
      }),
    ])
      .then(function (respostas) {
        doDia = respostas[0] || [];
        expedienteDoDiaNaTela = respostas[1];
        desenharSlots(dia);
      })
      .catch(function (err) {
        if (err.status === 401 || /sess/i.test(err.message)) return exigirLogin();
        slotsBox.innerHTML = "";
        slotsBox.appendChild(elemento("li", "admin-erro", "Erro ao carregar: " + err.message));
      });
  }

  // Monta o cartão de um pedido de cliente dentro do horário.
  function blocoPedido(reg, opcoes) {
    var bloco = elemento("div", "pedido");

    var nome = elemento("div", "slot-nome", reg.nome);
    nome.appendChild(
      elemento(
        "span",
        "etiqueta " + (reg.status === "confirmado" ? "etiqueta-confirmado" : "etiqueta-pendente"),
        reg.status === "confirmado" ? "confirmado" : "pendente",
      ),
    );
    bloco.appendChild(nome);

    bloco.appendChild(elemento("p", "slot-detalhe", reg.servico));
    if (reg.telefone) bloco.appendChild(elemento("p", "slot-detalhe", reg.telefone));

    var acomp = reg.acompanhantes || [];
    if (acomp.length) {
      bloco.appendChild(
        elemento(
          "p",
          "slot-detalhe",
          "Acompanhantes: " +
            acomp
              .map(function (g) {
                return (g.name || "—") + (g.service ? " (" + g.service + ")" : "");
              })
              .join(", "),
        ),
      );
    }

    var acoes = elemento("div", "slot-acoes");

    if (opcoes.podeConfirmar) {
      acoes.appendChild(
        botao("Confirmar", function () {
          return DB.confirmar(reg.id).then(recarregar);
        }),
      );
    }

    var whats = reg.status === "confirmado"
      ? botaoWhats(reg, "confirmado", "Avisar confirmação")
      : botaoWhats(reg, "recebido", "Responder");
    if (whats) acoes.appendChild(whats);

    if (reg.status !== "confirmado") {
      // Texto pronto para quando ela não vai conseguir atender.
      var recusa = botaoWhats(reg, "recusado", "Não vai dar");
      if (recusa) acoes.appendChild(recusa);
    }

    acoes.appendChild(
      botao(reg.status === "confirmado" ? "Cancelar e liberar" : "Recusar", function () {
        var pergunta =
          reg.status === "confirmado"
            ? "Cancelar o agendamento de " + reg.nome + " às " + reg.horario + "?"
            : "Recusar o pedido de " +
              reg.nome +
              " às " +
              reg.horario +
              "?\n\nAvise a cliente pelo WhatsApp antes, se ainda não avisou.";
        if (!confirm(pergunta)) return Promise.resolve();
        return DB.apagar(reg.id).then(recarregar);
      }),
    );

    bloco.appendChild(acoes);
    return bloco;
  }

  function desenharSlots(dia) {
    slotsBox.innerHTML = "";

    // horários do expediente do dia + qualquer horário fora da grade que já
    // exista no banco (por exemplo, um encaixe manual de outro dia)
    var horarios = gradeDoExpediente();
    doDia.forEach(function (r) {
      if (horarios.indexOf(r.horario) === -1) horarios.push(r.horario);
    });
    horarios.sort();

    var fechados = 0;
    var pendentesNoDia = 0;

    horarios.forEach(function (hora) {
      var registros = doDia.filter(function (r) {
        return r.horario === hora;
      });
      // Só um registro pode estar confirmado por horário (garantido no banco).
      var fechado = registros.filter(function (r) {
        return r.status === "confirmado";
      })[0];
      var pendentes = registros.filter(function (r) {
        return r.status === "pendente";
      });

      if (fechado) fechados++;
      pendentesNoDia += pendentes.length;

      var classe = !fechado && !pendentes.length
        ? "slot-livre"
        : fechado && fechado.tipo === "bloqueio"
          ? "slot-bloqueio"
          : fechado
            ? "slot-agendado"
            : "slot-pendente";

      var li = elemento("li", "slot " + classe);
      li.appendChild(elemento("span", "slot-hora", hora));

      var corpo = elemento("div", "slot-corpo");

      if (fechado && fechado.tipo === "bloqueio") {
        corpo.appendChild(elemento("div", "slot-nome", "Horário fechado"));
        if (fechado.observacao) {
          corpo.appendChild(elemento("p", "slot-detalhe", fechado.observacao));
        }
        var acoesBloq = elemento("div", "slot-acoes");
        acoesBloq.appendChild(
          botao("Reabrir", function () {
            return DB.apagar(fechado.id).then(recarregar);
          }),
        );
        corpo.appendChild(acoesBloq);
      } else if (fechado) {
        corpo.appendChild(blocoPedido(fechado, { podeConfirmar: false }));
      } else if (!pendentes.length) {
        corpo.appendChild(elemento("div", "slot-nome", "Livre"));
        var acoesLivre = elemento("div", "slot-acoes");
        acoesLivre.appendChild(
          botao("Fechar este horário", function () {
            return DB.bloquear(dia, hora, "").then(recarregar);
          }),
        );
        corpo.appendChild(acoesLivre);
      }

      if (pendentes.length) {
        corpo.appendChild(
          elemento(
            "p",
            "slot-aviso",
            fechado
              ? "Ainda há " +
                  pendentes.length +
                  (pendentes.length === 1 ? " pedido" : " pedidos") +
                  " neste horário — avise a cliente."
              : pendentes.length === 1
                ? "1 pedido aguardando sua confirmação"
                : pendentes.length + " pedidos disputando este horário",
          ),
        );
        pendentes.forEach(function (reg) {
          corpo.appendChild(blocoPedido(reg, { podeConfirmar: !fechado }));
        });
      }

      li.appendChild(corpo);
      slotsBox.appendChild(li);
    });

    var texto = porExtenso(dia) + " — " + fechados + " de " + horarios.length + " horários fechados";
    if (pendentesNoDia) {
      texto +=
        " · " + pendentesNoDia + (pendentesNoDia === 1 ? " pedido pendente" : " pedidos pendentes");
    }
    resumoDia.textContent = texto;
  }

  /* ---------- próximos agendamentos ---------- */

  function carregarProximos() {
    proximosBox.innerHTML = "";
    proximosBox.appendChild(elemento("li", "carregando", "Carregando…"));
    return DB.listarFuturos()
      .then(function (registros) {
        proximosBox.innerHTML = "";
        // Horários que já estão fechados (agendamento confirmado ou bloqueio),
        // para não oferecer Confirmar em pedido que perdeu a vaga.
        var fechados = {};
        (registros || []).forEach(function (r) {
          if (r.status === "confirmado") fechados[r.data + " " + r.horario] = true;
        });

        var lista = (registros || []).filter(function (r) {
          return r.tipo === "agendamento";
        });
        if (!lista.length) {
          proximosBox.appendChild(elemento("li", "carregando", "Nenhum agendamento por enquanto."));
          return;
        }
        pendentesFuturos = lista.filter(function (r) {
          return r.status !== "confirmado";
        });
        atualizarAvisosDePendencia();

        lista.slice(0, 30).forEach(function (r) {
          var li = elemento("li");
          li.appendChild(elemento("span", "quando", curta(r.data) + " · " + r.horario + " "));
          li.appendChild(document.createTextNode(r.nome + " — " + r.servico));

          if (r.status === "confirmado") {
            li.appendChild(elemento("span", "etiqueta etiqueta-confirmado", "confirmado"));
            proximosBox.appendChild(li);
            return;
          }

          li.appendChild(elemento("span", "etiqueta etiqueta-pendente", "pendente"));

          var acoes = elemento("div", "slot-acoes");

          if (fechados[r.data + " " + r.horario]) {
            // O horário já foi para outra cliente: só resta responder esta.
            li.appendChild(
              elemento("p", "slot-detalhe", "Este horário já foi confirmado para outra pessoa."),
            );
          } else {
            // Confirmar aqui fecha o horário na mesma hora, sem precisar
            // navegar até o dia.
            acoes.appendChild(
              botao("Confirmar", function () {
                return DB.confirmar(r.id).then(recarregar);
              }),
            );
          }
          var whats = botaoWhats(r, "recebido", "Responder");
          if (whats) acoes.appendChild(whats);
          acoes.appendChild(
            botao("Recusar", function () {
              if (!confirm("Recusar o pedido de " + r.nome + " em " + curta(r.data) + " às " + r.horario + "?")) {
                return Promise.resolve();
              }
              return DB.apagar(r.id).then(recarregar);
            }),
          );
          li.appendChild(acoes);
          proximosBox.appendChild(li);
        });
      })
      .catch(function (err) {
        proximosBox.innerHTML = "";
        proximosBox.appendChild(elemento("li", "admin-erro", "Erro: " + err.message));
      });
  }

  /* ---------- páginas e menu ---------- */

  var PAGINAS = {
    mes: "Mês",
    dia: "Dia",
    horarios: "Horário de atendimento",
    servicos: "Serviços e preços",
    avisos: "Avisos no celular",
  };

  // Páginas que falam de data: é nelas que os próximos atendimentos aparecem.
  var PAGINAS_DE_DATA = ["mes", "dia"];

  var paginaAtual = "mes";
  var menuEl = $("menu");
  var menuFundo = $("menu-fundo");

  function abrirMenu() {
    menuEl.hidden = false;
    menuFundo.hidden = false;
    // um quadro depois, para a animação acontecer
    requestAnimationFrame(function () {
      menuEl.classList.add("aberto");
      menuFundo.classList.add("aberto");
    });
  }

  function fecharMenu() {
    menuEl.classList.remove("aberto");
    menuFundo.classList.remove("aberto");
    setTimeout(function () {
      menuEl.hidden = true;
      menuFundo.hidden = true;
    }, 220);
  }

  function irPara(pagina, opcoes) {
    if (!PAGINAS[pagina]) pagina = "mes";
    paginaAtual = pagina;

    [].forEach.call(document.querySelectorAll(".pagina"), function (el) {
      el.hidden = el.getAttribute("data-pagina") !== pagina;
    });
    [].forEach.call(document.querySelectorAll(".menu-item"), function (b) {
      b.classList.toggle("atual", b.getAttribute("data-ir") === pagina);
    });

    $("titulo-pagina").textContent = PAGINAS[pagina];
    $("cartao-proximos").hidden = PAGINAS_DE_DATA.indexOf(pagina) === -1;

    if (!opcoes || !opcoes.semFechar) fecharMenu();

    // Cada página busca o que precisa só quando é aberta.
    if (pagina === "mes") carregarMes();
    if (pagina === "dia") carregarDia();
    if (pagina === "horarios") carregarExpediente();
    if (pagina === "servicos") carregarServicos();
    if (pagina === "avisos") mostrarEstadoPush();

    // O aviso do menu depende do dia que está na tela.
    atualizarAvisosDePendencia();
  }

  $("menu-abrir").addEventListener("click", abrirMenu);
  menuFundo.addEventListener("click", fecharMenu);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") fecharMenu();
  });
  [].forEach.call(document.querySelectorAll(".menu-item"), function (b) {
    b.addEventListener("click", function () {
      irPara(b.getAttribute("data-ir"));
    });
  });
  $("sino").addEventListener("click", function () {
    irPara("dia");
  });

  /* ---------- pendências ---------- */

  var pendentesFuturos = []; // pedidos esperando resposta, de hoje em diante

  function atualizarAvisosDePendencia() {
    var total = pendentesFuturos.length;
    var sino = $("sino");
    sino.hidden = total === 0;
    $("sino-conta").textContent = total;

    var hoje = hojeISO();
    var doDiaNaTela = pendentesFuturos.filter(function (r) {
      return r.data === (diaInput.value || hoje);
    }).length;

    var badges = {
      mes: total,
      dia: doDiaNaTela,
    };
    [].forEach.call(document.querySelectorAll(".menu-badge"), function (b) {
      var quantos = badges[b.getAttribute("data-badge")] || 0;
      b.hidden = quantos === 0;
      b.textContent = quantos;
    });
  }

  /* ---------- calendário do mês ---------- */

  var mesNaTela = null; // primeiro dia do mês exibido
  var calGrade = $("cal-grade");

  function primeiroDiaDoMes(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function iso(d) {
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function carregarMes() {
    if (!mesNaTela) mesNaTela = primeiroDiaDoMes(new Date());

    var inicio = primeiroDiaDoMes(mesNaTela);
    var fim = new Date(mesNaTela.getFullYear(), mesNaTela.getMonth() + 1, 0);

    $("mes-titulo").textContent = inicio
      .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
      .replace(/^./, function (c) {
        return c.toUpperCase();
      });

    calGrade.innerHTML = "";
    calGrade.appendChild(elemento("p", "carregando", "Carregando…"));

    return Promise.all([
      DB.listarPeriodo(iso(inicio), iso(fim)),
      DB.listarExcecoes(iso(inicio)).catch(function () {
        return [];
      }),
      DB.listarExpediente().catch(function () {
        return [];
      }),
    ])
      .then(function (respostas) {
        desenharMes(inicio, fim, respostas[0] || [], respostas[1] || [], respostas[2] || []);
      })
      .catch(function (err) {
        if (err.status === 401 || /sess/i.test(err.message)) return exigirLogin();
        calGrade.innerHTML = "";
        calGrade.appendChild(elemento("p", "admin-erro", "Erro ao carregar: " + err.message));
      });
  }

  function desenharMes(inicio, fim, registros, excecoes, expedienteSemana) {
    calGrade.innerHTML = "";

    var porDia = {};
    registros.forEach(function (r) {
      if (!porDia[r.data]) porDia[r.data] = { confirmados: 0, pendentes: 0, bloqueios: 0 };
      if (r.tipo === "bloqueio") porDia[r.data].bloqueios++;
      else if (r.status === "confirmado") porDia[r.data].confirmados++;
      else porDia[r.data].pendentes++;
    });

    var fechadoNaSemana = {};
    expedienteSemana.forEach(function (d) {
      fechadoNaSemana[d.dia_semana] = d.fechado;
    });
    var excecaoPorData = {};
    excecoes.forEach(function (e) {
      excecaoPorData[e.data] = e;
    });

    // casas vazias até o primeiro dia cair no dia da semana certo
    for (var v = 0; v < inicio.getDay(); v++) {
      calGrade.appendChild(elemento("div", "cal-vazio"));
    }

    var hoje = hojeISO();
    for (var dia = 1; dia <= fim.getDate(); dia++) {
      (function (dia) {
        var data = new Date(inicio.getFullYear(), inicio.getMonth(), dia);
        var chave = iso(data);
        var conta = porDia[chave] || { confirmados: 0, pendentes: 0, bloqueios: 0 };

        var exc = excecaoPorData[chave];
        var fechado = exc && exc.fechado != null ? exc.fechado : fechadoNaSemana[data.getDay()];

        var cel = elemento("button", "cal-dia");
        cel.type = "button";
        if (chave === hoje) cel.classList.add("cal-hoje");
        if (fechado) cel.classList.add("cal-fechado");
        if (conta.pendentes) cel.classList.add("cal-tem-pendente");

        cel.appendChild(elemento("span", "cal-numero", String(dia)));

        var pontos = elemento("span", "cal-pontos");
        if (fechado) {
          pontos.appendChild(elemento("i", "ponto ponto-fechado"));
        } else {
          var i;
          for (i = 0; i < Math.min(conta.confirmados, 3); i++) {
            pontos.appendChild(elemento("i", "ponto ponto-confirmado"));
          }
          for (i = 0; i < Math.min(conta.pendentes, 3); i++) {
            pontos.appendChild(elemento("i", "ponto ponto-pendente"));
          }
        }
        cel.appendChild(pontos);

        if (conta.pendentes) {
          cel.appendChild(elemento("span", "cal-aviso", String(conta.pendentes)));
        }

        cel.title =
          conta.confirmados + " confirmado(s), " + conta.pendentes + " esperando resposta";

        cel.addEventListener("click", function () {
          diaInput.value = chave;
          irPara("dia");
        });

        calGrade.appendChild(cel);
      })(dia);
    }
  }

  $("mes-anterior").addEventListener("click", function () {
    mesNaTela = new Date(mesNaTela.getFullYear(), mesNaTela.getMonth() - 1, 1);
    carregarMes();
  });
  $("mes-seguinte").addEventListener("click", function () {
    mesNaTela = new Date(mesNaTela.getFullYear(), mesNaTela.getMonth() + 1, 1);
    carregarMes();
  });
  $("mes-hoje").addEventListener("click", function () {
    mesNaTela = primeiroDiaDoMes(new Date());
    diaInput.value = hojeISO();
    carregarMes();
  });

  /* ---------- expediente ---------- */

  var expedienteBox = $("expediente");
  var excecoesBox = $("excecoes");

  var DIAS = [
    "Domingo",
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sábado",
  ];

  // Aceita "19", "19h", "19:30" e devolve "19:30:00" para o banco.
  function horaDoTexto(texto) {
    var t = String(texto).trim().toLowerCase().replace("h", ":").replace(",", ":");
    if (!t) return null;
    var m = t.match(/^(\d{1,2})(?::(\d{1,2}))?:?$/);
    if (!m) return null;
    var h = Number(m[1]);
    var min = Number(m[2] || 0);
    if (h > 23 || min > 59) return null;
    return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0") + ":00";
  }

  function horaCurta(valor) {
    if (!valor) return "";
    return String(valor).slice(0, 5);
  }

  function resumoDoDia(d) {
    if (d.fechado) return "Fechado";
    var texto = horaCurta(d.abre) + " às " + horaCurta(d.fecha) + " (último)";
    if (d.almoco_inicio && d.almoco_fim) {
      texto += " · almoço " + horaCurta(d.almoco_inicio) + "–" + horaCurta(d.almoco_fim);
    }
    return texto;
  }

  // Campos de horário compartilhados pelo dia da semana e pela exceção.
  function camposDeHorario(d) {
    var fAbre = campo("Primeiro horário", horaCurta(d.abre), "09:00");
    var fFecha = campo("Último horário", horaCurta(d.fecha), "19:00");
    var fAlmocoIni = campo("Almoço começa", horaCurta(d.almoco_inicio), "vazio = sem almoço");
    var fAlmocoFim = campo("Almoço termina", horaCurta(d.almoco_fim), "vazio = sem almoço");
    var fPasso = campo("Um horário a cada quantos minutos", d.passo_min || 60, "60");

    var fechado = elemento("label", "servico-campo campo-caixa");
    var caixa = document.createElement("input");
    caixa.type = "checkbox";
    caixa.checked = Boolean(d.fechado);
    fechado.appendChild(caixa);
    fechado.appendChild(elemento("span", "servico-rotulo-lado", "Não atendo neste dia"));

    return {
      fechado: fechado,
      campos: [fAbre, fFecha, fAlmocoIni, fAlmocoFim, fPasso],
      ler: function () {
        var abre = horaDoTexto(fAbre.input.value);
        var fecha = horaDoTexto(fFecha.input.value);
        var passo = Number(String(fPasso.input.value).replace(/\D/g, ""));
        var almocoIni = fAlmocoIni.input.value.trim() ? horaDoTexto(fAlmocoIni.input.value) : null;
        var almocoFim = fAlmocoFim.input.value.trim() ? horaDoTexto(fAlmocoFim.input.value) : null;

        if (!caixa.checked) {
          if (!abre || !fecha) {
            return { erro: "Horário inválido. Escreva assim: 09:00 e 19:00." };
          }

          if (abre >= fecha) {
            return { erro: "O último horário tem que ser depois do primeiro." };
          }
          if ((almocoIni && !almocoFim) || (!almocoIni && almocoFim)) {
            return { erro: "Preencha o começo e o fim do almoço, ou deixe os dois vazios." };
          }
          if (almocoIni && almocoFim && almocoIni >= almocoFim) {
            return { erro: "O fim do almoço tem que ser depois do começo." };
          }
        }
        if (!passo || passo < 15 || passo > 240) {
          return { erro: "O intervalo entre horários deve ficar entre 15 e 240 minutos." };
        }

        return {
          valores: {
            fechado: caixa.checked,
            abre: abre,
            fecha: fecha,
            almoco_inicio: almocoIni,
            almoco_fim: almocoFim,
            passo_min: passo,
          },
        };
      },
      repor: function (original) {
        caixa.checked = Boolean(original.fechado);
        fAbre.input.value = horaCurta(original.abre);
        fFecha.input.value = horaCurta(original.fecha);
        fAlmocoIni.input.value = horaCurta(original.almoco_inicio);
        fAlmocoFim.input.value = horaCurta(original.almoco_fim);
        fPasso.input.value = original.passo_min || 60;
      },
    };
  }

  function linhaExpediente(d) {
    var li = elemento("li", "servico" + (d.fechado ? " servico-inativo" : ""));

    var cabeca = elemento("div", "servico-cabeca");
    cabeca.appendChild(elemento("span", "servico-nome", DIAS[d.dia_semana]));
    cabeca.appendChild(elemento("span", "servico-resumo", resumoDoDia(d)));
    li.appendChild(cabeca);

    var form = elemento("div", "servico-form");
    var h = camposDeHorario(d);
    form.appendChild(h.fechado);
    h.campos.forEach(function (c) {
      form.appendChild(c.envolto);
    });

    var acoes = elemento("div", "slot-acoes");
    acoes.appendChild(
      botao("Salvar", function () {
        var lido = h.ler();
        if (lido.erro) {
          alert(lido.erro);
          return Promise.resolve();
        }
        return DB.salvarExpediente(d.dia_semana, lido.valores).then(carregarExpediente);
      }),
    );

    var cancelar = elemento("button", "btn-ghost", "Cancelar");
    cancelar.type = "button";
    cancelar.addEventListener("click", function () {
      h.repor(d);
      li.classList.remove("aberto");
    });
    acoes.appendChild(cancelar);

    form.appendChild(acoes);
    li.appendChild(form);
    cabeca.addEventListener("click", function () {
      li.classList.toggle("aberto");
    });
    return li;
  }

  function carregarExpediente() {
    expedienteBox.innerHTML = "";
    expedienteBox.appendChild(elemento("li", "carregando", "Carregando…"));
    return DB.listarExpediente()
      .then(function (lista) {
        expedienteBox.innerHTML = "";
        (lista || []).forEach(function (d) {
          expedienteBox.appendChild(linhaExpediente(d));
        });
      })
      .catch(function (err) {
        expedienteBox.innerHTML = "";
        expedienteBox.appendChild(
          elemento(
            "li",
            "admin-erro",
            err.status === 404
              ? "Falta rodar o arquivo supabase-expediente.sql no SQL Editor do Supabase."
              : "Erro: " + err.message,
          ),
        );
      })
      .then(carregarExcecoes);
  }

  /* ---------- dias fora do normal ---------- */

  function linhaExcecao(e, nova) {
    var li = elemento("li", "servico" + (nova ? " servico-novo" : ""));

    var cabeca = elemento("div", "servico-cabeca");
    var titulo = elemento("span", "servico-nome", nova ? "Escolha o dia" : curta(e.data));
    if (nova) titulo.appendChild(elemento("span", "etiqueta etiqueta-pendente", "não salvo"));
    cabeca.appendChild(titulo);
    cabeca.appendChild(elemento("span", "servico-resumo", nova ? "" : resumoDoDia(e)));
    li.appendChild(cabeca);

    var form = elemento("div", "servico-form");

    var envoltoData = elemento("label", "servico-campo");
    envoltoData.appendChild(elemento("span", "servico-rotulo", "Dia"));
    var campoData = elemento("input", "input");
    campoData.type = "date";
    campoData.value = e.data || hojeISO();
    campoData.disabled = !nova;
    envoltoData.appendChild(campoData);
    form.appendChild(envoltoData);

    var h = camposDeHorario(e);
    form.appendChild(h.fechado);
    h.campos.forEach(function (c) {
      form.appendChild(c.envolto);
    });

    var acoes = elemento("div", "slot-acoes");
    acoes.appendChild(
      botao("Salvar", function () {
        if (!campoData.value) {
          alert("Escolha o dia.");
          return Promise.resolve();
        }
        var lido = h.ler();
        if (lido.erro) {
          alert(lido.erro);
          return Promise.resolve();
        }
        var registro = lido.valores;
        registro.data = campoData.value;
        return DB.salvarExcecao(registro).then(carregarExcecoes);
      }),
    );

    var cancelar = elemento("button", "btn-ghost", "Cancelar");
    cancelar.type = "button";
    cancelar.addEventListener("click", function () {
      if (nova) {
        li.remove();
        return;
      }
      h.repor(e);
      li.classList.remove("aberto");
    });
    acoes.appendChild(cancelar);

    if (!nova) {
      acoes.appendChild(
        botao("Voltar ao normal", function () {
          if (!confirm("Tirar " + curta(e.data) + " da lista e voltar ao horário da semana?")) {
            return Promise.resolve();
          }
          return DB.apagarExcecao(e.data).then(carregarExcecoes);
        }),
      );
    }

    form.appendChild(acoes);
    li.appendChild(form);
    cabeca.addEventListener("click", function () {
      li.classList.toggle("aberto");
    });
    return li;
  }

  function carregarExcecoes() {
    excecoesBox.innerHTML = "";
    return DB.listarExcecoes(hojeISO())
      .then(function (lista) {
        excecoesBox.innerHTML = "";
        if (!lista || !lista.length) {
          excecoesBox.appendChild(elemento("li", "carregando", "Nenhum dia diferente cadastrado."));
          return;
        }
        lista.forEach(function (e) {
          excecoesBox.appendChild(linhaExcecao(e, false));
        });
      })
      .catch(function () {
        excecoesBox.innerHTML = "";
      });
  }

  $("excecao-nova").addEventListener("click", function () {
    var rascunho = excecoesBox.querySelector(".servico-novo");
    if (rascunho) {
      rascunho.classList.add("aberto");
      return;
    }
    var li = linhaExcecao(
      { data: "", fechado: false, abre: "09:00", fecha: "19:00", passo_min: 60 },
      true,
    );
    li.classList.add("aberto");
    excecoesBox.insertBefore(li, excecoesBox.firstChild);
  });

  /* ---------- serviços e preços ---------- */


  var servicosBox = $("servicos");

  function precoEmReais(valor) {
    return "R$ " + (Number(valor) || 0).toFixed(2).replace(".", ",");
  }

  // 90 -> "1h30"; aceita digitar "1:30", "1h30" ou "90".
  function duracaoPorExtenso(minutos) {
    var m = Number(minutos) || 0;
    var h = Math.floor(m / 60);
    var r = m % 60;
    if (!h) return r + "min";
    if (!r) return h + "h";
    return h + "h" + String(r).padStart(2, "0");
  }

  function minutosDoTexto(texto) {
    var t = String(texto).trim().toLowerCase().replace(",", ":");
    var casado = t.match(/^(\d+)\s*[:h]\s*(\d{1,2})?$/);
    if (casado) {
      return Number(casado[1]) * 60 + Number(casado[2] || 0);
    }
    var so = t.match(/^(\d+)\s*(min)?$/);
    if (so) return Number(so[1]);
    return null;
  }

  function precoDoTexto(texto) {
    var t = String(texto).replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
    var n = Number(t);
    return isNaN(n) ? null : n;
  }

  function campo(rotulo, valor, dica) {
    var envolto = elemento("label", "servico-campo");
    envolto.appendChild(elemento("span", "servico-rotulo", rotulo));
    var input = elemento("input", "input");
    input.type = "text";
    input.value = valor == null ? "" : String(valor);
    if (dica) input.placeholder = dica;
    envolto.appendChild(input);
    return { envolto: envolto, input: input };
  }

  function linhaServico(servico) {
    var novo = !servico.id;
    var li = elemento(
      "li",
      "servico" + (servico.ativo ? "" : " servico-inativo") + (novo ? " servico-novo" : ""),
    );

    var cabeca = elemento("div", "servico-cabeca");
    var titulo = elemento("span", "servico-nome", servico.nome);
    if (novo) {
      titulo.appendChild(elemento("span", "etiqueta etiqueta-pendente", "não salvo"));
    } else if (!servico.ativo) {
      titulo.appendChild(elemento("span", "etiqueta etiqueta-pendente", "escondido"));
    }
    cabeca.appendChild(titulo);
    cabeca.appendChild(
      elemento(
        "span",
        "servico-resumo",
        precoEmReais(servico.preco) + " · " + duracaoPorExtenso(servico.duracao_min),
      ),
    );
    li.appendChild(cabeca);

    var form = elemento("div", "servico-form");
    var fNome = campo("Nome", servico.nome);
    var fDesc = campo("Descrição", servico.descricao, "Design de sobrancelhas");
    var fPreco = campo("Preço", precoEmReais(servico.preco));
    var fAntigo = campo("Preço antigo (riscado)", servico.preco_antigo > 0 ? precoEmReais(servico.preco_antigo) : "", "deixe vazio se não houver");
    var fDuracao = campo("Duração", duracaoPorExtenso(servico.duracao_min), "1:30");
    [fNome, fDesc, fPreco, fAntigo, fDuracao].forEach(function (c) {
      form.appendChild(c.envolto);
    });

    var acoes = elemento("div", "slot-acoes");

    acoes.appendChild(
      botao("Salvar", function () {
        var preco = precoDoTexto(fPreco.input.value);
        var antigo = fAntigo.input.value.trim() ? precoDoTexto(fAntigo.input.value) : 0;
        var duracao = minutosDoTexto(fDuracao.input.value);

        if (!fNome.input.value.trim()) {
          alert("O serviço precisa de um nome.");
          return Promise.resolve();
        }
        if (preco === null || antigo === null) {
          alert("Preço inválido. Escreva assim: 59,99");
          return Promise.resolve();
        }
        if (duracao === null || duracao < 5 || duracao > 600) {
          alert("Duração inválida. Escreva assim: 1:30 (uma hora e meia) ou 90.");
          return Promise.resolve();
        }

        var mudancas = {
          nome: fNome.input.value.trim(),
          descricao: fDesc.input.value.trim(),
          preco: preco,
          preco_antigo: antigo,
          duracao_min: duracao,
        };
        var salvar = servico.id
          ? DB.atualizarServico(servico.id, mudancas)
          : DB.criarServico(mudancas);
        return salvar.then(carregarServicos);
      }),
    );

    var cancelar = elemento("button", "btn-ghost", "Cancelar");
    cancelar.type = "button";
    cancelar.addEventListener("click", function () {
      if (novo) {
        // Nunca existiu no banco: some da tela sem deixar rastro.
        li.remove();
        if (!servicosBox.querySelector(".servico")) carregarServicos();
        return;
      }
      // Já existe: devolve cada campo ao que está gravado e fecha a linha.
      fNome.input.value = servico.nome;
      fDesc.input.value = servico.descricao || "";
      fPreco.input.value = precoEmReais(servico.preco);
      fAntigo.input.value = servico.preco_antigo > 0 ? precoEmReais(servico.preco_antigo) : "";
      fDuracao.input.value = duracaoPorExtenso(servico.duracao_min);
      li.classList.remove("aberto");
    });
    acoes.appendChild(cancelar);

    if (!novo) {
      acoes.appendChild(
        botao(servico.ativo ? "Esconder do site" : "Mostrar no site", function () {
          return DB.atualizarServico(servico.id, { ativo: !servico.ativo }).then(carregarServicos);
        }),
      );

      acoes.appendChild(
        botao("Apagar", function () {
          if (!confirm("Apagar o serviço \"" + servico.nome + '\" de vez?')) {
            return Promise.resolve();
          }
          return DB.apagarServico(servico.id).then(carregarServicos);
        }),
      );
    }

    form.appendChild(acoes);
    li.appendChild(form);

    // Abre e fecha ao tocar no cabeçalho, para a lista não virar um paredão.
    cabeca.addEventListener("click", function () {
      li.classList.toggle("aberto");
    });

    return li;
  }

  function carregarServicos() {
    servicosBox.innerHTML = "";
    servicosBox.appendChild(elemento("li", "carregando", "Carregando…"));
    return DB.listarServicosAdmin()
      .then(function (lista) {
        servicosBox.innerHTML = "";
        if (!lista || !lista.length) {
          servicosBox.appendChild(
            elemento("li", "carregando", "Nenhum serviço cadastrado ainda."),
          );
          return;
        }
        lista.forEach(function (servico) {
          servicosBox.appendChild(linhaServico(servico));
        });
      })
      .catch(function (err) {
        servicosBox.innerHTML = "";
        var recado =
          err.status === 404
            ? "Falta rodar o arquivo supabase-servicos.sql no SQL Editor do Supabase."
            : "Erro: " + err.message;
        servicosBox.appendChild(elemento("li", "admin-erro", recado));
      });
  }

  $("servico-novo").addEventListener("click", function () {
    // Um rascunho por vez: clicar de novo não empilha linhas em branco.
    var rascunho = servicosBox.querySelector(".servico-novo");
    if (rascunho) {
      rascunho.classList.add("aberto");
      var campo = rascunho.querySelector("input");
      if (campo) campo.focus();
      return;
    }

    var li = linhaServico({
      nome: "Novo serviço",
      descricao: "",
      preco: 0,
      preco_antigo: 0,
      duracao_min: 60,
      ativo: true,
    });
    li.classList.add("aberto");
    servicosBox.insertBefore(li, servicosBox.firstChild);
    var primeiro = li.querySelector("input");
    if (primeiro) {
      primeiro.focus();
      primeiro.select();
    }
  });

  /* ---------- avisos no celular (push) ---------- */

  var cartaoPush = $("cartao-push");
  var estadoPush = $("push-estado");
  var btnLigar = $("push-ligar");
  var btnDesligar = $("push-desligar");

  function pushSuportado() {
    return (
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window &&
      Boolean(CONFIG.vapidPublicKey)
    );
  }

  // A chave VAPID viaja em base64url e o navegador exige bytes.
  function chaveEmBytes(base64url) {
    var base64 = (base64url + "===".slice((base64url.length + 3) % 4))
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    var bruto = atob(base64);
    var bytes = new Uint8Array(bruto.length);
    for (var i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
    return bytes;
  }

  function nomeDoAparelho() {
    var ua = navigator.userAgent;
    if (/iPhone|iPad/.test(ua)) return "iPhone";
    if (/Android/.test(ua)) return "Android";
    return "Computador";
  }

  function mostrarEstadoPush() {
    if (!pushSuportado()) {
      cartaoPush.hidden = true;
      return;
    }
    cartaoPush.hidden = false;
    estadoPush.textContent = "Verificando…";

    // Em alguns navegadores o service worker nunca fica pronto (aba privada,
    // navegador embutido). Sem esse limite o cartão ficaria pendurado.
    var pronto = Promise.race([
      navigator.serviceWorker.ready,
      new Promise(function (_, falhou) {
        setTimeout(function () {
          falhou(new Error("service worker não respondeu"));
        }, 5000);
      }),
    ]);

    pronto
      .then(function (reg) {
        return reg.pushManager.getSubscription();
      })
      .then(function (assinatura) {
        var ligado = Boolean(assinatura);
        btnLigar.hidden = ligado;
        btnDesligar.hidden = !ligado;

        if (ligado) {
          estadoPush.textContent =
            "Ativado neste aparelho. Você recebe um aviso assim que uma cliente pedir horário.";
          return;
        }
        if (Notification.permission === "denied") {
          estadoPush.textContent =
            "Os avisos estão bloqueados nas configurações do navegador para este site. " +
            "Libere as notificações por lá e volte aqui.";
          btnLigar.hidden = true;
          return;
        }
        estadoPush.textContent =
          "Receba um aviso no celular assim que chegar um pedido, mesmo sem abrir o app.";
      })
      .catch(function () {
        cartaoPush.hidden = true;
      });
  }

  function ligarPush() {
    btnLigar.disabled = true;
    estadoPush.textContent = "Pedindo permissão…";

    Notification.requestPermission()
      .then(function (resposta) {
        if (resposta !== "granted") throw new Error("permissão negada");
        return navigator.serviceWorker.ready;
      })
      .then(function (reg) {
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: chaveEmBytes(CONFIG.vapidPublicKey),
        });
      })
      .then(function (assinatura) {
        return DB.salvarAssinatura(assinatura, nomeDoAparelho());
      })
      .then(function () {
        mostrarEstadoPush();
      })
      .catch(function (err) {
        estadoPush.textContent =
          err && /negada/.test(err.message)
            ? "Você recusou a permissão. Para ativar, libere as notificações nas configurações do site."
            : "Não consegui ativar: " + (err.message || err);
      })
      .then(function () {
        btnLigar.disabled = false;
      });
  }

  function desligarPush() {
    btnDesligar.disabled = true;
    navigator.serviceWorker.ready
      .then(function (reg) {
        return reg.pushManager.getSubscription();
      })
      .then(function (assinatura) {
        if (!assinatura) return;
        var endpoint = assinatura.endpoint;
        return assinatura.unsubscribe().then(function () {
          return DB.apagarAssinatura(endpoint);
        });
      })
      .then(function () {
        mostrarEstadoPush();
      })
      .catch(function (err) {
        estadoPush.textContent = "Não consegui desativar: " + (err.message || err);
      })
      .then(function () {
        btnDesligar.disabled = false;
      });
  }

  if (btnLigar) btnLigar.addEventListener("click", ligarPush);
  if (btnDesligar) btnDesligar.addEventListener("click", desligarPush);

  /* ---------- login ---------- */

  function exigirLogin() {
    DB.sair();
    $("quem").textContent = "";
    $("menu-abrir").hidden = true;
    $("sino").hidden = true;
    fecharMenu();
    mostrar("login");
  }

  // Estar logada não basta: o e-mail precisa estar na lista de admins do banco.
  function abrirAgenda() {
    return DB.souAdmin()
      .then(function (ok) {
        if (!ok) {
          DB.sair();
          mostrar("login");
          erroLogin.textContent =
            "Esta conta não tem acesso à agenda. Fale com quem cuida do site.";
          erroLogin.hidden = false;
          return;
        }
        mostrar("agenda");
        $("quem").textContent = "conectada";
        $("menu-quem").textContent = "conectada";
        $("menu-abrir").hidden = false;
        if (!diaInput.value) diaInput.value = hojeISO();
        irPara("mes");
        return carregarProximos();
      })
      .catch(function () {
        exigirLogin();
      });
  }

  $("form-login").addEventListener("submit", function (e) {
    e.preventDefault();
    erroLogin.hidden = true;
    var btn = $("btn-entrar");
    btn.classList.add("is-disabled");
    btn.textContent = "Entrando…";
    DB.entrar($("email").value.trim(), $("senha").value)
      .then(function () {
        $("senha").value = "";
        abrirAgenda();
      })
      .catch(function (err) {
        erroLogin.textContent =
          err.status === 400 ? "E-mail ou senha incorretos." : "Erro ao entrar: " + err.message;
        erroLogin.hidden = false;
      })
      .then(function () {
        btn.classList.remove("is-disabled");
        btn.textContent = "Entrar";
      });
  });

  btnSair.addEventListener("click", function () {
    exigirLogin();
  });

  diaInput.addEventListener("change", function () {
    carregarDia();
    atualizarAvisosDePendencia();
  });
  $("dia-anterior").addEventListener("click", function () {
    diaInput.value = somaDias(diaInput.value || hojeISO(), -1);
    carregarDia();
  });
  $("dia-seguinte").addEventListener("click", function () {
    diaInput.value = somaDias(diaInput.value || hojeISO(), 1);
    carregarDia();
  });

  /* ---------- início ---------- */

  if (!window.DB || !DB.ligado) {
    mostrar("desligado");
  } else if (DB.logada()) {
    abrirAgenda();
  } else {
    mostrar("login");
  }
})();
