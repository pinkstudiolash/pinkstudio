/*
 * Supabase Edge Function — avisa o Pink Studio quando entra um pedido novo.
 *
 * Quem chama: um Database Webhook do Supabase, disparado no INSERT da
 * tabela agendamentos.
 *
 * O que faz: para cada aparelho registrado em push_assinaturas, manda um
 * "push" vazio. O texto da notificação é montado no celular, pelo sw.js —
 * assim nome e telefone de cliente nunca passam pelo servidor do
 * Google/Apple.
 *
 * Segredos necessários (Supabase > Edge Functions > Secrets):
 *   VAPID_PUBLIC_KEY    chave pública  (a mesma do config.js)
 *   VAPID_PRIVATE_KEY   chave privada  (só aqui, nunca no site)
 *   VAPID_SUBJECT       mailto:seu-email@exemplo.com
 *   SERVICE_ROLE_KEY    chave secreta do projeto, para ler as assinaturas
 *   PROJECT_URL         https://SEU-PROJETO.supabase.co
 */

const enc = new TextEncoder();

function base64urlParaBytes(base64url: string): Uint8Array {
  const base64 = (base64url + "===".slice((base64url.length + 3) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const bruto = atob(base64);
  const bytes = new Uint8Array(bruto.length);
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

function bytesParaBase64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Importa a chave privada VAPID (32 bytes crus) para assinar com ES256. */
async function importarChavePrivada(privB64: string, pubB64: string): Promise<CryptoKey> {
  const d = base64urlParaBytes(privB64);
  const pub = base64urlParaBytes(pubB64); // 0x04 + X(32) + Y(32)
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    d: bytesParaBase64url(d),
    x: bytesParaBase64url(pub.slice(1, 33)),
    y: bytesParaBase64url(pub.slice(33, 65)),
    ext: true,
  };
  return await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

/** Monta o JWT que prova para o serviço de push que o aviso é nosso. */
async function criarJwtVapid(audiencia: string, chave: CryptoKey, assunto: string) {
  const cabecalho = { typ: "JWT", alg: "ES256" };
  const corpo = {
    aud: audiencia,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: assunto,
  };
  const parte1 = bytesParaBase64url(enc.encode(JSON.stringify(cabecalho)));
  const parte2 = bytesParaBase64url(enc.encode(JSON.stringify(corpo)));
  const aAssinar = enc.encode(parte1 + "." + parte2);

  const assinatura = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    chave,
    aAssinar,
  );
  return parte1 + "." + parte2 + "." + bytesParaBase64url(assinatura);
}

Deno.serve(async (req) => {
  try {
    const PUB = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const PRIV = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:contato@exemplo.com";
    const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? "";
    const SERVICE_ROLE = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

    if (!PUB || !PRIV || !PROJECT_URL || !SERVICE_ROLE) {
      return new Response("faltam segredos de configuração", { status: 500 });
    }

    // Só interessa pedido novo de cliente.
    const evento = await req.json().catch(() => ({}));
    const registro = evento?.record ?? {};
    if (evento?.type && evento.type !== "INSERT") {
      return new Response("ignorado", { status: 200 });
    }
    if (registro?.tipo && registro.tipo !== "agendamento") {
      return new Response("ignorado", { status: 200 });
    }

    // Lê os aparelhos registrados (service role: ignora o RLS).
    const resposta = await fetch(`${PROJECT_URL}/rest/v1/push_assinaturas?select=endpoint`, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
    });
    const assinaturas: Array<{ endpoint: string }> = await resposta.json();
    if (!Array.isArray(assinaturas) || !assinaturas.length) {
      return new Response("nenhum aparelho registrado", { status: 200 });
    }

    const chave = await importarChavePrivada(PRIV, PUB);
    const mortos: string[] = [];

    await Promise.all(
      assinaturas.map(async (a) => {
        const url = new URL(a.endpoint);
        const jwt = await criarJwtVapid(url.origin, chave, SUBJECT);

        const envio = await fetch(a.endpoint, {
          method: "POST",
          headers: {
            TTL: "3600",
            Urgency: "high",
            // Sem corpo: a notificação é montada no celular, pelo sw.js.
            Authorization: `vapid t=${jwt}, k=${PUB}`,
          },
        });

        // 404/410 = aparelho desinstalou ou revogou: limpar depois.
        if (envio.status === 404 || envio.status === 410) mortos.push(a.endpoint);
      }),
    );

    // Faxina das assinaturas mortas, para não tentar de novo amanhã.
    for (const endpoint of mortos) {
      await fetch(
        `${PROJECT_URL}/rest/v1/push_assinaturas?endpoint=eq.${encodeURIComponent(endpoint)}`,
        {
          method: "DELETE",
          headers: {
            apikey: SERVICE_ROLE,
            Authorization: `Bearer ${SERVICE_ROLE}`,
          },
        },
      );
    }

    return new Response(
      JSON.stringify({ enviados: assinaturas.length - mortos.length, removidos: mortos.length }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (erro) {
    console.error(erro);
    return new Response("erro: " + (erro as Error).message, { status: 500 });
  }
});
