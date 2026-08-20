// Estado compartilhado das despesas (quem já foi pago).
// Guarda um SET no Redis (Upstash / Vercel KV) — cada membro é o id de uma linha.
// Usar um SET em vez de sobrescrever a lista inteira evita que duas pessoas
// marcando ao mesmo tempo apaguem a marcação uma da outra.

const CHAVE = 'ludus:despesas:agosto2026:pagos';
const CHAVE_TS = 'ludus:despesas:agosto2026:atualizado';

function credenciais() {
  const url =
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

async function redis(cred, comandos) {
  const resposta = await fetch(`${cred.url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cred.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(comandos),
  });
  if (!resposta.ok) {
    throw new Error(`redis ${resposta.status}: ${await resposta.text()}`);
  }
  const dados = await resposta.json();
  return dados.map((d) => (d && 'result' in d ? d.result : null));
}

function corpoJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body) {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return {};
    }
  }
  return {};
}

module.exports = async (req, res) => {
  res.setHeader('cache-control', 'no-store');

  const cred = credenciais();
  if (!cred) {
    res.status(503).json({
      erro: 'banco_nao_configurado',
      dica: 'Conecte o Upstash Redis em Vercel → Storage e faça um novo deploy.',
    });
    return;
  }

  try {
    if (req.method === 'GET') {
      const [pagos, ts] = await redis(cred, [
        ['SMEMBERS', CHAVE],
        ['GET', CHAVE_TS],
      ]);
      res.status(200).json({ pagos: pagos || [], atualizadoEm: ts || null });
      return;
    }

    if (req.method === 'POST') {
      const { acao, id } = corpoJson(req);
      const agora = new Date().toISOString();

      if (acao === 'limpar') {
        await redis(cred, [
          ['DEL', CHAVE],
          ['SET', CHAVE_TS, agora],
        ]);
      } else if (acao === 'marcar' || acao === 'desmarcar') {
        if (!id || typeof id !== 'string') {
          res.status(400).json({ erro: 'id_invalido' });
          return;
        }
        await redis(cred, [
          [acao === 'marcar' ? 'SADD' : 'SREM', CHAVE, id],
          ['SET', CHAVE_TS, agora],
        ]);
      } else {
        res.status(400).json({ erro: 'acao_invalida' });
        return;
      }

      const [pagos] = await redis(cred, [['SMEMBERS', CHAVE]]);
      res.status(200).json({ pagos: pagos || [], atualizadoEm: agora });
      return;
    }

    res.setHeader('allow', 'GET, POST');
    res.status(405).json({ erro: 'metodo_nao_permitido' });
  } catch (e) {
    res.status(502).json({ erro: 'falha_no_banco', detalhe: String(e.message || e) });
  }
};
