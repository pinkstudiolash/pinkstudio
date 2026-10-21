/*
 * ============================================================
 *  CONFIGURAÇÃO DO SITE — edite só este arquivo
 * ============================================================
 *  Depois de editar, salve e faça:
 *      git add -A && git commit -m "atualiza dados" && git push
 *  O site online atualiza sozinho em ~1 minuto.
 */

window.CONFIG = {
  // Número do WhatsApp que RECEBE as mensagens.
  // Formato: 55 (Brasil) + DDD + número, só dígitos, sem espaços ou traços.
  whatsapp: "55DDDNUMERO",

  // Tabela de preços de RESERVA.
  // Depois de rodar o supabase-servicos.sql, quem manda é o banco — o Pink Studio
  // edita tudo pelo painel. Esta lista só aparece se o banco não responder,
  // para o site nunca ficar sem preços na tela.
  services: [
    { name: "Brow lamination completa", descricao: "Laminação com design e henna", preco: 140.0, precoAntigo: 0, duracao: 90 },
    { name: "Brow lamination simples", descricao: "Laminação das sobrancelhas", preco: 120.0, precoAntigo: 0, duracao: 75 },
    { name: "Design simples", descricao: "Design de sobrancelhas", preco: 50.0, precoAntigo: 0, duracao: 30 },
    { name: "Design com henna", descricao: "Design de sobrancelhas com henna", preco: 65.0, precoAntigo: 0, duracao: 45 },
  ],

  // Folga, em minutos, entre um atendimento e o seguinte. Somada à duração do
  // serviço: quem marca 09:00 num serviço de 1h30 libera o próximo às 10:40.
  folgaMinutos: 10,

  // ------------------------------------------------------------
  //  Supabase — o banco que guarda a agenda.
  // ------------------------------------------------------------
  //  Enquanto estes dois campos estiverem vazios, o site funciona
  //  normalmente, só que SEM bloquear horários já ocupados e sem
  //  o painel do Pink Studio.
  //
  //  Onde achar: painel do Supabase > Project Settings > API keys.
  //    url     = "Project URL"
  //    anonKey = a chave "publishable" (sb_publishable_...)
  //              Esta pode ficar pública: com ela o site só consegue
  //              criar um pedido e perguntar quais horários estão
  //              fechados. Ver as políticas em supabase.sql.
  //
  //  NUNCA coloque aqui a chave "secret" (sb_secret_...) nem a
  //  "service_role": elas dão acesso total ao banco, ignoram todas as
  //  regras de segurança, e este arquivo é visível para quem visitar
  //  o site.
  supabase: {
    url: "",
    anonKey: "",
  },

  // Chave pública das notificações (VAPID). Pode ficar pública — é ela que
  // o celular usa para conferir que o aviso veio mesmo do nosso servidor.
  // A chave PRIVADA correspondente vive só nos segredos do Supabase.
  vapidPublicKey: "",

  // ------------------------------------------------------------
  //  Mensagens prontas do painel
  // ------------------------------------------------------------
  //  Ao tocar num botão de WhatsApp no painel, a conversa da cliente abre
  //  com um destes textos já escrito — o Pink Studio só aperta enviar.
  //  Peças que são trocadas pelos dados do agendamento:
  //    {nome}  {data}  {hora}  {servico}
  mensagens: {
    recebido:
      "Oi {nome}! Recebi seu pedido para {data} às {hora} 💗 Já confirmo pra você.",
    confirmado:
      "Oi {nome}! Seu horário está confirmado 💗\n{data} às {hora} — {servico}\nAté lá!",
    recusado:
      "Oi {nome}! Infelizmente {data} às {hora} não vai dar 😔 Me diga outro horário que eu encaixo pra você 💗",
  },

  // Por quantos dias à frente a agenda fica aberta.
  // Com 15, a cliente só escolhe entre hoje e os próximos 15 dias — a janela
  // anda sozinha todo dia, sem ninguém precisar mexer.
  diasAbertos: 15,

  // Antecedência mínima, em minutos, para agendar no mesmo dia.
  // Com 10, um horário some da tela quando faltam menos de 10 minutos para ele
  // — ninguém consegue pedir as 14:00 às 13:55.
  antecedenciaMinutos: 10,

  // Grade de horários de RESERVA. Depois do supabase-expediente.sql quem manda
  // é o expediente que o Pink Studio configura no painel; esta lista só entra em
  // cena se o banco não responder.
  times: [
    "09:00",
    "10:00",
    "11:00",
    "13:00",
    "14:00",
    "15:00",
    "16:00",
    "17:00",
    "18:00",
  ],
};
