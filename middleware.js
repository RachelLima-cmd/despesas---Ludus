// Porta de entrada do painel: nada é servido sem senha.
// Roda na borda (Edge), antes de qualquer arquivo estático ou função.
// A senha fica na variável de ambiente SENHA_PAINEL, configurada no painel da Vercel.

export const config = {
  matcher: ['/((?!_next/static|favicon.ico).*)'],
};

const COOKIE = 'ludus_sessao';
const DIAS = 30;

async function tokenDe(senha) {
  const dados = new TextEncoder().encode(`ludus-despesas|${senha}`);
  const hash = await crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function paginaLogin(erro) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Despesas Ludus — acesso restrito</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    font-family:'Inter',system-ui,-apple-system,sans-serif;
    background:#f6f7f4;color:#1b2430;
    min-height:100vh;display:grid;place-items:center;padding:24px;
  }
  .caixa{
    background:#fff;border:1px solid #e3e6df;border-radius:16px;
    padding:36px 34px;width:100%;max-width:380px;
    box-shadow:0 12px 40px rgba(15,76,70,.08);
  }
  .marca{
    display:inline-block;font-size:11px;font-weight:700;letter-spacing:.14em;
    text-transform:uppercase;background:#0f4c46;color:#fff;
    padding:6px 14px;border-radius:20px;margin-bottom:20px;
  }
  h1{font-size:21px;font-weight:800;line-height:1.25;margin-bottom:6px}
  p.sub{font-size:13.5px;color:#6b7480;line-height:1.5;margin-bottom:22px}
  label{display:block;font-size:12px;font-weight:700;color:#6b7480;
    text-transform:uppercase;letter-spacing:.08em;margin-bottom:7px}
  input{
    width:100%;border:1.5px solid #e3e6df;border-radius:9px;
    padding:12px 14px;font-size:15px;font-family:inherit;color:#1b2430;
    background:#fbfcfa;transition:border-color .15s;
  }
  input:focus{outline:none;border-color:#0f4c46;background:#fff}
  button{
    width:100%;margin-top:16px;border:none;border-radius:9px;cursor:pointer;
    background:#0f4c46;color:#fff;font-family:inherit;
    font-size:14.5px;font-weight:700;padding:13px;transition:opacity .15s;
  }
  button:hover{opacity:.9}
  .erro{
    background:#fdeaea;color:#a33327;border:1px solid #f0c6c0;
    border-radius:8px;padding:10px 13px;font-size:13px;font-weight:600;
    margin-bottom:16px;
  }
  .rodape{margin-top:22px;font-size:11.5px;color:#9aa3ad;line-height:1.5;text-align:center}
</style>
</head>
<body>
  <form class="caixa" method="POST" action="/entrar">
    <span class="marca">Ludus</span>
    <h1>Painel de despesas</h1>
    <p class="sub">Área restrita. Informe a senha de acesso para continuar.</p>
    ${erro ? `<div class="erro">Senha incorreta. Tente novamente.</div>` : ''}
    <label for="senha">Senha de acesso</label>
    <input id="senha" name="senha" type="password" autocomplete="current-password" autofocus required>
    <button type="submit">Entrar</button>
    <div class="rodape">Este painel contém dados financeiros e chaves PIX.<br>Não compartilhe a senha fora da diretoria.</div>
  </form>
</body>
</html>`;
}

const CABECALHOS_HTML = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex, nofollow',
};

export default async function middleware(request) {
  const url = new URL(request.url);
  const senhaCerta = process.env.SENHA_PAINEL;

  // Sem senha configurada: bloqueia tudo em vez de vazar os dados.
  if (!senhaCerta) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;max-width:560px;margin:auto">' +
        '<h1 style="font-size:19px">Configuração pendente</h1>' +
        '<p style="color:#555;line-height:1.6">A variável de ambiente <code>SENHA_PAINEL</code> ainda não foi definida ' +
        'no projeto da Vercel. Enquanto isso, o painel fica bloqueado por segurança.</p></body>',
      { status: 503, headers: CABECALHOS_HTML },
    );
  }

  const esperado = await tokenDe(senhaCerta);

  // Sair
  if (url.pathname === '/sair') {
    return new Response(null, {
      status: 302,
      headers: {
        location: '/',
        'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }

  // Login
  if (url.pathname === '/entrar' && request.method === 'POST') {
    const form = await request.formData();
    const enviada = String(form.get('senha') || '');
    if (enviada === senhaCerta) {
      return new Response(null, {
        status: 302,
        headers: {
          location: '/',
          'set-cookie': `${COOKIE}=${esperado}; Path=/; Max-Age=${DIAS * 86400}; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    return new Response(paginaLogin(true), { status: 401, headers: CABECALHOS_HTML });
  }

  // Já autenticado?
  const cookie = request.headers.get('cookie') || '';
  const atual = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`));
  if (atual && atual.slice(COOKIE.length + 1) === esperado) {
    return; // segue para o arquivo estático ou a função /api
  }

  // A API responde JSON, não uma tela de login.
  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ erro: 'nao_autenticado' }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  }

  return new Response(paginaLogin(false), { status: 401, headers: CABECALHOS_HTML });
}
