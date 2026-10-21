# Pink Studio — site de agendamento

Site estático (HTML + CSS + JavaScript puro, **sem build**) com formulário de
agendamento que envia a mensagem pronta para o WhatsApp do Pink Studio, bloqueia
horários já ocupados e tem um painel para a profissional controlar a agenda.

- Site: https://SEU-USUARIO.github.io/pinkstudio/
- Painel: https://SEU-USUARIO.github.io/pinkstudio/admin.html

## O que falta preencher

Este site é a cópia do Flávia Nails adaptada para o Pink Studio. Tudo já está
no lugar; faltam só os dados que são do Pink Studio:

1. **WhatsApp** — em `config.js`, `whatsapp: "55DDDNUMERO"`. Troque pelo número
   que recebe os pedidos: 55 + DDD + número, só dígitos.
2. **Banco próprio (Supabase)** — projeto novo, separado do da Flávia. Siga
   *Ligar a agenda* mais abaixo e cole `url` e `anonKey` em `config.js`.
3. **Avisos no celular (push)** — opcional. `vapidPublicKey` está vazio; sem
   ele o painel funciona, só não manda notificação.
4. **Publicar** — crie o repositório `pinkstudio` no GitHub, ligue o GitHub
   Pages no branch `main` (pasta raiz) e troque `SEU-USUARIO` nos links acima.

```
index.html      -> a página das clientes
admin.html      -> painel da agenda (só o Pink Studio entra)
styles.css      -> visual do site
admin.css       -> visual do painel
config.js       -> WhatsApp, serviços, horários e chaves do Supabase
db.js           -> conversa com o banco (Supabase) via REST
app.js          -> lógica do formulário e do link do WhatsApp
admin.js        -> lógica do painel
supabase.sql    -> cria a tabela e as permissões no Supabase (rodar 1 vez)
assets/         -> imagens (logo.jpg, hero-brows.jpg, favicon.png)
```

## Como o WhatsApp funciona

A cliente preenche o formulário e clica em **Confirmar agendamento**. O site
registra o pedido no banco e abre o WhatsApp já com o texto pronto: nome,
telefone, serviço, data, horário e acompanhantes. Ela toca em enviar e a
mensagem chega **direto no WhatsApp do Pink Studio**, na conversa normal.

O pedido **não** tira o horário do ar. Ele continua aberto para outras clientes
até o Pink Studio confirmar no painel — mais de uma pessoa pode pedir o mesmo
horário, e quem decide é ela.

Isso é o *WhatsApp Click to Chat*, o mecanismo oficial da Meta para sites. É
gratuito, não precisa de servidor, não precisa de aprovação e funciona no
celular e no computador.

> A *WhatsApp Business Cloud API* (envio automático, chatbot, mensagens em
> massa) é outra coisa: exige conta Meta Business verificada, um número
> dedicado, um servidor rodando 24h para receber os webhooks e custa por
> conversa. O GitHub Pages só hospeda arquivos estáticos, então não roda esse
> servidor. Se um dia for necessário, dá para acrescentar sem trocar o site.

## Ligar a agenda (Supabase) — feito uma vez

Enquanto isto não for feito, o site funciona normalmente, só que **sem bloquear
horários** e sem o painel.

1. Crie uma conta gratuita em https://supabase.com e um projeto novo.
2. No projeto, abra **SQL Editor**, cole o conteúdo de `supabase.sql` e clique
   em **RUN**. Isso cria a tabela `agendamentos` e as permissões.
3. Vá em **Project Settings > API keys** e copie:
   - o **Project URL**;
   - a chave **publishable** (`sb_publishable_...`). Esta pode ficar pública; a
     **secret** (`sb_secret_...`) **nunca** entra no site.
4. Cole as duas em `config.js`, no bloco `supabase`.
5. Crie o login do Pink Studio em **Authentication > Users > Add user**, com e-mail e
   senha, marcando *Auto Confirm User*. **A senha é dela** — ninguém mais precisa
   saber, e ela não fica escrita em lugar nenhum do código.
6. Autorize esse e-mail no painel. O cadastro do Supabase é aberto: qualquer
   pessoa com a chave pública do site consegue criar uma conta, então **estar
   logada não basta**. Só entra quem estiver na tabela `admins`. No SQL Editor:

   ```sql
   insert into public.admins (email) values ('email-do-pinkstudio@exemplo.com');
   ```

   Vale a pena também desligar o cadastro público em
   **Authentication > Sign In / Providers > Email > Allow new users to sign up**.
7. Publique:

```bash
git add -A && git commit -m "liga a agenda" && git push
```

### Por que a chave publishable pode ficar pública

O banco está protegido por *Row Level Security*. Com a chave publishable, o site só
consegue **criar** um agendamento e **perguntar quais horários estão ocupados**.
Ler nome e telefone das clientes exige estar logada **e** estar na tabela
`admins`. Isso está escrito nas
políticas dentro de `supabase.sql`.

## O painel do Pink Studio

Organizado em páginas, com menu no canto superior esquerdo:

1. **Mês** — calendário do mês inteiro. Cada dia mostra bolinhas (rosa =
   confirmado, dourado = esperando resposta), dias fechados aparecem
   tracejados, e um selo dourado conta os pedidos a responder. Tocar num dia
   abre a página do Dia naquela data.
2. **Dia** — a agenda hora a hora, como sempre foi.
3. **Horário de atendimento** — o expediente da semana e os dias diferentes do
   normal, na mesma página.
4. **Serviços e preços**.
5. **Avisos no celular** — as notificações push.

O sino no topo mostra quantos pedidos esperam resposta e leva direto para o
Dia. Os **próximos atendimentos** ficam sempre visíveis nas páginas de data
(Mês e Dia).

Fica em `admin.html`. Ela entra com e-mail e senha e pode:

- ver o dia inteiro, horário por horário, e navegar entre os dias;
- ver nome, telefone, serviço e acompanhantes de cada agendamento;
- abrir o WhatsApp da cliente com um toque;
- **confirmar** um agendamento (a cliente pediu, ela aceitou);
- **cancelar e liberar** o horário;
- **fechar um horário** que não vai atender (almoço, compromisso), que some da
  tela das clientes;
- ver a lista dos próximos agendamentos.

### Como o horário fecha

Cada pedido entra como **pendente** e não bloqueia nada. Quando o Pink Studio
**confirma** um deles, aquele horário sai do ar para todo mundo: o banco tem um
índice único que só admite um confirmado por data e horário, e um gatilho que
recusa qualquer pedido novo em horário já confirmado — inclusive de uma página
que ficou aberta no celular antes do fechamento.

Se houver outros pedidos no mesmo horário, o painel continua mostrando eles,
com um aviso para o Pink Studio responder a essas clientes. Ela recusa cada um com
um toque.

## Instalar o painel como app (PWA)

O painel é instalável: vira um ícone na tela inicial e abre em tela cheia, sem
barra de navegador. Não passa por App Store nem Play Store, e atualiza sozinho
a cada `git push`.

- **Android (Chrome):** abrir `admin.html` → menu ⋮ → *Instalar app* (ou
  *Adicionar à tela inicial*).
- **iPhone (Safari):** abrir `admin.html` → botão Compartilhar →
  *Adicionar à Tela de Início*. Precisa ser o Safari; no iPhone o Chrome não
  instala PWA.

Peças envolvidas: `manifest-admin.json` (nome, ícones, tela cheia), `sw.js`
(service worker) e os ícones em `assets/icon-*.png`.

O service worker usa **rede primeiro, cache como reserva**: com internet ela
sempre vê a versão mais nova; sem internet, abre a última versão guardada em vez
de dar erro. As chamadas ao Supabase nunca vêm do cache — agenda é informação
viva. Ao mudar arquivos do painel, suba o número em `var VERSAO` no `sw.js` para
forçar a limpeza do cache antigo.

## Janela da agenda

Em `config.js`, `diasAbertos: 15` limita o calendário da cliente a hoje + 15
dias. A janela **anda sozinha todo dia** — não precisa reabrir nada
periodicamente. Para dar mais ou menos prazo, mude só esse número.

## Mensagens prontas do painel

Os botões verdes de WhatsApp abrem a conversa da cliente com o texto já escrito
— o Pink Studio só aperta enviar. Os modelos ficam em `config.js`, em `mensagens`,
e aceitam `{nome}`, `{data}`, `{hora}` e `{servico}`:

- **Responder** (pedido pendente) → "recebi seu pedido, já confirmo"
- **Avisar confirmação** (já confirmado) → "seu horário está confirmado"
- **Não vai dar** (pedido pendente) → recusa pedindo outro horário

## Horário de atendimento

Fica no banco (`expediente` e `agenda_excecoes`) e é editado pelo painel:

- **Horário de atendimento** — o normal de cada dia da semana: abre, fecha,
  almoço, de quantos em quantos minutos oferecer horário, ou "não atendo neste
  dia".
- **Dias diferentes do normal** — uma data específica que foge da regra: ficar
  até 22h numa sexta, fechar num feriado. Vence sobre o dia da semana; campo
  deixado em branco herda o horário normal.

`fecha` é o **último horário oferecido**, não o fim do expediente: com 19:00, o
19:00 aparece para a cliente mesmo num serviço de 2h50 — o Pink Studio sai quando
terminar. O almoço, esse sim, continua sendo intervalo de verdade: nenhum
atendimento é oferecido se atravessá-lo.

## Serviços, preços e duração

Ficam na tabela `servicos` do banco e são editados **pelo painel** — o Pink Studio
mexe em nome, descrição, preço, preço antigo (riscado) e duração sem tocar em
código. Também dá para esconder um serviço do site sem apagar.

A lista em `config.js` é só reserva: aparece se o banco não responder, para o
site nunca ficar sem preços.

### Como a duração ocupa a agenda

Cada agendamento guarda a duração do serviço escolhido. Um horário só é
oferecido se o atendimento inteiro couber, respeitando `folgaMinutos` (10) de
intervalo dos dois lados. Na prática: quem marca 09:00 num serviço de 1h30
ocupa até 10:30, e o próximo horário livre passa a ser 11:00.

Mudar a duração de um serviço **não** mexe no que já foi marcado — o
agendamento guarda o tempo combinado na hora da marcação.

## Antecedência mínima

Em `config.js`, `antecedenciaMinutos: 10` esconde os horários que estão perto
demais: às 13h52 as 14:00 já não aparecem. Vale só para o dia de hoje — nos
outros dias a conta dá positivo sozinha. Se a cliente ficar com a página aberta,
a lista se atualiza a cada 30 segundos, e um horário selecionado que fica em
cima da hora é desmarcado com aviso.

## Mudar número, preços ou horários

Abra `config.js`, edite e publique:

```bash
git add -A && git commit -m "atualiza dados" && git push
```

O site online atualiza em cerca de 1 minuto.

## Ver o site no computador antes de publicar

```bash
python -m http.server 8765
```

Depois abra http://127.0.0.1:8765 no navegador.

## Publicação

Já está configurado: GitHub Pages servindo o branch `main`, pasta raiz. Todo
`git push` publica automaticamente, em cerca de 1 minuto.
