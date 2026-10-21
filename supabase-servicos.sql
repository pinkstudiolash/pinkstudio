-- ============================================================
--  Pink Studio — serviços, preços e duração
-- ============================================================
--  Rode no SQL Editor do Supabase, uma vez, DEPOIS do supabase.sql.
--
--  Tira a tabela de preços de dentro do código: o Pink Studio passa a
--  cadastrar e alterar serviços pelo próprio painel.
--
--  A duração é o que faz a agenda respeitar o tempo de cada
--  atendimento: quem marca 09:00 num serviço de 60 minutos ocupa
--  até 10:00, e com a folga o próximo horário livre é 10:10.
-- ============================================================

create table if not exists public.servicos (
  id           bigint generated always as identity primary key,
  nome         text    not null,
  descricao    text    not null default '',
  preco        numeric(10, 2) not null default 0,
  -- preço "de", riscado na tela. Zero = não mostra promoção.
  preco_antigo numeric(10, 2) not null default 0,
  duracao_min  integer not null default 60,
  ativo        boolean not null default true,
  ordem        integer not null default 0,
  criado_em    timestamptz not null default now(),

  constraint servicos_duracao_valida check (duracao_min between 5 and 600),
  constraint servicos_nome_nao_vazio check (length(trim(nome)) > 0)
);

create index if not exists servicos_ordem_idx on public.servicos (ordem, id);

alter table public.servicos enable row level security;

-- A tabela de preços é pública: qualquer visitante do site lê os
-- serviços ativos. Não há nada sigiloso aqui.
drop policy if exists "todos leem servicos ativos" on public.servicos;
create policy "todos leem servicos ativos"
  on public.servicos for select to anon, authenticated using (ativo);

-- O Pink Studio (admin) vê todos, inclusive os desativados, e edita.
drop policy if exists "admin le todos servicos" on public.servicos;
create policy "admin le todos servicos"
  on public.servicos for select to authenticated using (public.eh_admin());

drop policy if exists "admin cria servico" on public.servicos;
create policy "admin cria servico"
  on public.servicos for insert to authenticated with check (public.eh_admin());

drop policy if exists "admin edita servico" on public.servicos;
create policy "admin edita servico"
  on public.servicos for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists "admin apaga servico" on public.servicos;
create policy "admin apaga servico"
  on public.servicos for delete to authenticated using (public.eh_admin());

-- ------------------------------------------------------------
--  Tabela de preços inicial
-- ------------------------------------------------------------
--  Preços conforme a tabela do Pink Studio. As durações são uma
--  estimativa inicial — basta ajustar pelo painel se o atendimento
--  levar mais ou menos tempo.

insert into public.servicos (nome, descricao, preco, preco_antigo, duracao_min, ordem, ativo)
select * from (values
  ('Brow lamination completa', 'Laminação com design e henna',      140.00, 0, 90, 1, true),
  ('Brow lamination simples',  'Laminação das sobrancelhas',        120.00, 0, 75, 2, true),
  ('Design simples',           'Design de sobrancelhas',             50.00, 0, 30, 3, true),
  ('Design com henna',         'Design de sobrancelhas com henna',   65.00, 0, 45, 4, true)
) as novos(nome, descricao, preco, preco_antigo, duracao_min, ordem, ativo)
where not exists (select 1 from public.servicos);

-- ------------------------------------------------------------
--  Duração dentro do agendamento
-- ------------------------------------------------------------
--  Guardada no próprio agendamento: se o Pink Studio mudar a duração do
--  serviço amanhã, o que já foi marcado continua ocupando o tempo
--  combinado na hora da marcação.

alter table public.agendamentos
  add column if not exists duracao_min integer not null default 60;

-- Horário fechado pelo Pink Studio é um ponto na agenda, não um
-- atendimento: não come o horário seguinte.
update public.agendamentos set duracao_min = 0
where tipo = 'bloqueio' and duracao_min <> 0;

-- ------------------------------------------------------------
--  O que o site público pode perguntar
-- ------------------------------------------------------------
--  Agora devolve também quanto tempo cada compromisso ocupa, para o
--  site conseguir calcular os encaixes. Continua sem dado pessoal.

create or replace function public.ocupacoes(dia date)
returns table (horario text, duracao_min integer)
language sql
stable
security definer
set search_path = public
as $$
  select a.horario, a.duracao_min
  from public.agendamentos a
  where a.data = dia
    and a.status = 'confirmado'
$$;

revoke all on function public.ocupacoes(date) from public;
grant execute on function public.ocupacoes(date) to anon, authenticated;
