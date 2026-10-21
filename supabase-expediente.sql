-- ============================================================
--  Pink Studio — expediente (horário de atendimento)
-- ============================================================
--  Rode no SQL Editor do Supabase, DEPOIS do supabase-servicos.sql.
--
--  Duas camadas:
--    expediente        -> o horário normal de cada dia da semana
--    agenda_excecoes   -> um dia específico que foge do normal
--                         (ficar até 20h numa sexta, fechar num feriado)
--
--  A exceção vence sobre o dia da semana. Campo deixado em branco
--  na exceção herda o valor do dia da semana.
-- ============================================================

create table if not exists public.expediente (
  dia_semana     integer primary key,   -- 0 = domingo ... 6 = sábado
  fechado        boolean not null default false,
  -- Primeiro e ÚLTIMO horário oferecido. 'fecha' é o mais tarde que ela
  -- aceita começar um atendimento, não o fim do expediente.
  abre           time    not null default '09:00',
  fecha          time    not null default '19:00',
  -- Intervalo do almoço. Em branco = sem intervalo.
  almoco_inicio  time,
  almoco_fim     time,
  -- De quanto em quanto tempo um horário é oferecido.
  passo_min      integer not null default 60,

  constraint expediente_dia_valido check (dia_semana between 0 and 6),
  constraint expediente_passo_valido check (passo_min between 15 and 240)
);

create table if not exists public.agenda_excecoes (
  data           date primary key,
  fechado        boolean,
  abre           time,
  fecha          time,
  almoco_inicio  time,
  almoco_fim     time,
  passo_min      integer,
  observacao     text not null default '',

  constraint excecoes_passo_valido check (passo_min is null or passo_min between 15 and 240)
);

-- ------------------------------------------------------------
--  Segurança
-- ------------------------------------------------------------
--  O horário de atendimento é informação pública — é o que o site
--  precisa para montar a lista de horários. Só o Pink Studio altera.

alter table public.expediente enable row level security;
alter table public.agenda_excecoes enable row level security;

drop policy if exists "todos leem expediente" on public.expediente;
create policy "todos leem expediente"
  on public.expediente for select to anon, authenticated using (true);

drop policy if exists "admin edita expediente" on public.expediente;
create policy "admin edita expediente"
  on public.expediente for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists "admin cria expediente" on public.expediente;
create policy "admin cria expediente"
  on public.expediente for insert to authenticated with check (public.eh_admin());

drop policy if exists "todos leem excecoes" on public.agenda_excecoes;
create policy "todos leem excecoes"
  on public.agenda_excecoes for select to anon, authenticated using (true);

drop policy if exists "admin cria excecao" on public.agenda_excecoes;
create policy "admin cria excecao"
  on public.agenda_excecoes for insert to authenticated with check (public.eh_admin());

drop policy if exists "admin edita excecao" on public.agenda_excecoes;
create policy "admin edita excecao"
  on public.agenda_excecoes for update to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists "admin apaga excecao" on public.agenda_excecoes;
create policy "admin apaga excecao"
  on public.agenda_excecoes for delete to authenticated using (public.eh_admin());

-- ------------------------------------------------------------
--  Expediente inicial
-- ------------------------------------------------------------
--  Segunda a sábado, 9h às 19h, almoço 12h–13h. Domingo fechado.
--  Tudo isso é ajustável pelo painel, inclusive reabrir o domingo.

insert into public.expediente (dia_semana, fechado, abre, fecha, almoco_inicio, almoco_fim, passo_min)
select * from (values
  (0, true,  '09:00'::time, '19:00'::time, '12:00'::time, '13:00'::time, 60),
  (1, false, '09:00'::time, '19:00'::time, '12:00'::time, '13:00'::time, 60),
  (2, false, '09:00'::time, '19:00'::time, '12:00'::time, '13:00'::time, 60),
  (3, false, '09:00'::time, '19:00'::time, '12:00'::time, '13:00'::time, 60),
  (4, false, '09:00'::time, '19:00'::time, '12:00'::time, '13:00'::time, 60),
  (5, false, '09:00'::time, '19:00'::time, '12:00'::time, '13:00'::time, 60),
  (6, false, '09:00'::time, '19:00'::time, '12:00'::time, '13:00'::time, 60)
) as novos(dia_semana, fechado, abre, fecha, almoco_inicio, almoco_fim, passo_min)
where not exists (select 1 from public.expediente);

-- ------------------------------------------------------------
--  O que o site pergunta
-- ------------------------------------------------------------
--  "Como é o expediente neste dia?" — já resolvendo a exceção.

create or replace function public.expediente_do_dia(dia date)
returns table (
  fechado       boolean,
  abre          text,
  fecha         text,
  almoco_inicio text,
  almoco_fim    text,
  passo_min     integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(e.fechado, w.fechado),
    to_char(coalesce(e.abre, w.abre), 'HH24:MI'),
    to_char(coalesce(e.fecha, w.fecha), 'HH24:MI'),
    to_char(coalesce(e.almoco_inicio, w.almoco_inicio), 'HH24:MI'),
    to_char(coalesce(e.almoco_fim, w.almoco_fim), 'HH24:MI'),
    coalesce(e.passo_min, w.passo_min)
  from public.expediente w
  left join public.agenda_excecoes e on e.data = dia
  where w.dia_semana = extract(dow from dia)::int
$$;

revoke all on function public.expediente_do_dia(date) from public;
grant execute on function public.expediente_do_dia(date) to anon, authenticated;
