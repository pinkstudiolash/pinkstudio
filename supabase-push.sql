-- ============================================================
--  Pink Studio — notificações push no celular do Pink Studio
-- ============================================================
--  Rode no SQL Editor do Supabase, uma vez, DEPOIS do supabase.sql.
--
--  Guarda a "assinatura" do aparelho dela: um endereço que o
--  navegador (Google/Apple) fornece e para o qual mandamos o aviso.
--  Nenhum dado de cliente passa por aqui.
-- ============================================================

create table if not exists public.push_assinaturas (
  endpoint    text primary key,
  p256dh      text not null default '',
  auth        text not null default '',
  aparelho    text not null default '',
  criado_em   timestamptz not null default now()
);

alter table public.push_assinaturas enable row level security;

-- Só a administradora logada registra ou remove o próprio aparelho.
-- A chave pública do site não lê nem escreve nada aqui.
drop policy if exists "admin le assinaturas" on public.push_assinaturas;
create policy "admin le assinaturas"
  on public.push_assinaturas for select to authenticated using (public.eh_admin());

drop policy if exists "admin cria assinatura" on public.push_assinaturas;
create policy "admin cria assinatura"
  on public.push_assinaturas for insert to authenticated with check (public.eh_admin());

drop policy if exists "admin apaga assinatura" on public.push_assinaturas;
create policy "admin apaga assinatura"
  on public.push_assinaturas for delete to authenticated using (public.eh_admin());
