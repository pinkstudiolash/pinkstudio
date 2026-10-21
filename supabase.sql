-- ============================================================
--  Pink Studio — banco da agenda (Supabase / PostgreSQL)
-- ============================================================
--  Como usar: no painel do Supabase, abra "SQL Editor", cole
--  este arquivo inteiro e clique em RUN. Roda uma vez só.
--
--  Regra principal: um pedido feito pela cliente NÃO tira o
--  horário do ar. O horário só fica indisponível quando a
--  Pink Studio confirma (ou quando ela fecha o horário).
-- ============================================================

create table if not exists public.agendamentos (
  id             bigint generated always as identity primary key,
  data           date        not null,
  horario        text        not null,
  -- 'agendamento' = pedido feito por uma cliente pelo site
  -- 'bloqueio'    = horário fechado pelo Pink Studio no painel
  tipo           text        not null default 'agendamento',
  -- 'pendente'   = a cliente pediu; o horário continua aberto
  -- 'confirmado' = o Pink Studio aceitou; o horário sai do ar
  status         text        not null default 'pendente',
  nome           text        not null,
  telefone       text        not null default '',
  servico        text        not null default '',
  acompanhantes  jsonb       not null default '[]'::jsonb,
  observacao     text        not null default '',
  criado_em      timestamptz not null default now(),

  constraint agendamentos_tipo_valido check (tipo in ('agendamento', 'bloqueio')),
  constraint agendamentos_status_valido check (status in ('pendente', 'confirmado'))
);

-- Vários pedidos podem disputar o mesmo horário...
alter table public.agendamentos
  drop constraint if exists agendamentos_horario_unico;

-- ...mas confirmado só pode haver um. (Horário fechado pelo Pink Studio
-- também entra como 'confirmado', então ocupa a vaga do mesmo jeito.)
create unique index if not exists agendamentos_confirmado_unico
  on public.agendamentos (data, horario)
  where status = 'confirmado';

create index if not exists agendamentos_data_idx on public.agendamentos (data);

-- Barra na entrada qualquer tentativa de ocupar um horário que já
-- está confirmado — inclusive a corrida entre dois cliques simultâneos.
-- O código 23505 faz o Supabase responder 409, que o site já trata.
create or replace function public.impede_horario_ocupado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Vale para qualquer novo registro, inclusive um pedido pendente vindo de
  -- uma página que ficou aberta antes de o Pink Studio fechar o horário.
  if exists (
    select 1
    from public.agendamentos a
    where a.data = new.data
      and a.horario = new.horario
      and a.status = 'confirmado'
      and a.id is distinct from new.id
  ) then
    raise exception 'Esse horário já está confirmado para outra pessoa.'
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists agendamentos_impede_ocupado on public.agendamentos;
create trigger agendamentos_impede_ocupado
  before insert or update on public.agendamentos
  for each row execute function public.impede_horario_ocupado();

-- ------------------------------------------------------------
--  Segurança (Row Level Security)
-- ------------------------------------------------------------
--  Sem nenhuma política, ninguém lê nem escreve nada.

alter table public.agendamentos enable row level security;

-- A CLIENTE (chave anônima, que fica pública no site) pode apenas
-- CRIAR um pedido pendente — e só de hoje em diante.
drop policy if exists "cliente cria agendamento" on public.agendamentos;
create policy "cliente cria agendamento"
  on public.agendamentos
  for insert
  to anon
  with check (
    tipo = 'agendamento'
    and status = 'pendente'
    and data >= current_date
    and length(nome) between 2 and 120
    and length(telefone) between 8 and 40
  );

-- A cliente NÃO pode ler a tabela: nome e telefone das outras clientes
-- ficam invisíveis para o site público. (Sem política de select = negado.)

-- ------------------------------------------------------------
--  Quem é administradora
-- ------------------------------------------------------------
--  Estar logada NÃO basta: o cadastro do Supabase é aberto, então
--  qualquer pessoa com a chave pública do site consegue criar uma
--  conta. Só quem estiver nesta lista entra no painel.

create table if not exists public.admins (
  email text primary key
);

alter table public.admins enable row level security;
-- Sem políticas: ninguém lê nem escreve esta lista pela API.
-- Para adicionar alguém, use o SQL Editor:
--     insert into public.admins (email) values ('email-do-pinkstudio@exemplo.com');

-- A checagem precisa ignorar o RLS da tabela acima, por isso a função
-- é security definer.
create or replace function public.eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admins a
    where a.email = (auth.jwt() ->> 'email')
  )
$$;

revoke all on function public.eh_admin() from public;
grant execute on function public.eh_admin() to authenticated;

-- A FLÁVIA (na lista de admins) enxerga e controla tudo.
drop policy if exists "admin le tudo" on public.agendamentos;
create policy "admin le tudo"
  on public.agendamentos for select to authenticated using (public.eh_admin());

drop policy if exists "admin cria" on public.agendamentos;
create policy "admin cria"
  on public.agendamentos for insert to authenticated with check (public.eh_admin());

drop policy if exists "admin edita" on public.agendamentos;
create policy "admin edita"
  on public.agendamentos for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists "admin apaga" on public.agendamentos;
create policy "admin apaga"
  on public.agendamentos for delete to authenticated using (public.eh_admin());

-- ------------------------------------------------------------
--  O que o site público pode perguntar
-- ------------------------------------------------------------
--  Só isto: "quais horários já estão fechados neste dia?".
--  Pedidos pendentes não entram — o horário continua aberto até
--  o Pink Studio confirmar. Nenhum dado pessoal sai por aqui.

create or replace function public.horarios_ocupados(dia date)
returns table (horario text)
language sql
stable
security definer
set search_path = public
as $$
  select a.horario
  from public.agendamentos a
  where a.data = dia
    and a.status = 'confirmado'
$$;

revoke all on function public.horarios_ocupados(date) from public;
grant execute on function public.horarios_ocupados(date) to anon, authenticated;
