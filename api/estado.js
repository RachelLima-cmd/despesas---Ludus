// Estado compartilhado das despesas (quais já foram pagas).
//
// Funciona com DOIS bancos, escolhido automaticamente pelas variáveis de ambiente:
//   1. Postgres / Supabase  -> se existir POSTGRES_URL
//   2. Redis / Upstash      -> se existir KV_REST_API_URL (ou UPSTASH_REDIS_REST_URL)
//
// Assim dá para começar no Upstash e migrar para o Supabase depois: basta conectar
// o Supabase na Vercel e republicar — nenhuma linha de código muda.
//
// Em ambos, "marcado" é a existência de um registro. Marcar insere, desmarcar remove.
// Isso evita que duas pessoas marcando ao mesmo tempo apaguem a marcação uma da outra.

const MES = 'agosto2026';

/* ───────────────────────── Postgres / Supabase ───────────────────────── */

let pool = null;
let tabelaPronta = false;

function urlPostgres() {
  return (
    process.env.POSTGRES_URL ||
    process.env.SUPABASE_POSTGRES_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    null
  );
}

function getPool() {
  if (pool) return pool;
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: urlPostgres(),
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

const bancoPostgres = {
  nome: 'supabase',
  async executar(acao, id) {
    const cliente = await getPool().connect();
    try {
      if (!tabelaPronta) {
        await cliente.query(`
          CREATE TABLE IF NOT EXISTS despesas_pagas (
            mes         text        NOT NULL,
            linha_id    text        NOT NULL,
            pago_em     timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (mes, linha_id)
          )
        `);
        tabelaPronta = true;
      }

      if (acao === 'limpar') {
        await cliente.query('DELETE FROM despesas_pagas WHERE mes = $1', [MES]);
      } else if (acao === 'marcar') {
        await cliente.query(
          `INSERT INTO despesas_pagas (mes, linha_id) VALUES ($1, $2)
           ON CONFLICT (mes, linha_id) DO NOTHING`,
          [MES, id],
        );
      } else if (acao === 'desmarcar') {
        await cliente.query('DELETE FROM despesas_pagas WHERE mes = $1 AND linha_id = $2', [MES, id]);
      }

      const r = await cliente.query(
        'SELECT linha_id, pago_em FROM despesas_pagas WHERE mes = $1 ORDER BY pago_em',
        [MES],
      );
      const ultimo = r.rows.reduce((a, l) => (!a || l.pago_em > a ? l.pago_em : a), null);
      return {
        pagos: r.rows.map((l) => l.linha_id),
        atualizadoEm: ultimo ? new Date(ultimo).toISOString() : null,
      };
    } finally {
      cliente.release();
    }
  },
};

/* ─────────────────────────── Redis / Upstash ─────────────────────────── */

const CHAVE = `ludus:despesas:${MES}:pagos`;
const CHAVE_TS = `ludus:despesas:${MES}:atualizado`;

function credenciaisRedis() {
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

const bancoRedis = {
  nome: 'upstash',
  async executar(acao, id) {
    const cred = credenciaisRedis();

    const chamar = async (comandos) => {
      const r = await fetch(`${cred.url}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cred.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(comandos),
      });
      if (!r.ok) throw new Error(`redis ${r.status}: ${await r.text()}`);
      const dados = await r.json();
      return dados.map((d) => (d && 'result' in d ? d.result : null));
    };

    const agora = new Date().toISOString();
    if (acao === 'limpar') {
      await chamar([['DEL', CHAVE], ['SET', CHAVE_TS, agora]]);
    } else if (acao === 'marcar' || acao === 'desmarcar') {
      await chamar([
        [acao === 'marcar' ? 'SADD' : 'SREM', CHAVE, id],
        ['SET', CHAVE_TS, agora],
      ]);
    }

    const [pagos, ts] = await chamar([['SMEMBERS', CHAVE], ['GET', CHAVE_TS]]);
    return { pagos: pagos || [], atualizadoEm: ts || null };
  },
};

/* ──────────────────────────────── rota ───────────────────────────────── */

function escolherBanco() {
  if (urlPostgres()) return bancoPostgres;
  if (credenciaisRedis()) return bancoRedis;
  return null;
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

  const banco = escolherBanco();
  if (!banco) {
    res.status(503).json({
      erro: 'banco_nao_configurado',
      dica: 'Conecte o Upstash ou o Supabase em Vercel → Storage e republique o site.',
    });
    return;
  }

  try {
    if (req.method === 'GET') {
      const estado = await banco.executar('ler', null);
      res.status(200).json({ ...estado, banco: banco.nome });
      return;
    }

    if (req.method === 'POST') {
      const { acao, id } = corpoJson(req);
      if (!['marcar', 'desmarcar', 'limpar'].includes(acao)) {
        res.status(400).json({ erro: 'acao_invalida' });
        return;
      }
      if (acao !== 'limpar' && (!id || typeof id !== 'string' || id.length > 300)) {
        res.status(400).json({ erro: 'id_invalido' });
        return;
      }
      const estado = await banco.executar(acao, id);
      res.status(200).json({ ...estado, banco: banco.nome });
      return;
    }

    res.setHeader('allow', 'GET, POST');
    res.status(405).json({ erro: 'metodo_nao_permitido' });
  } catch (e) {
    const msg = String((e && e.message) || e);
    // Supabase no plano gratuito hiberna após 7 dias sem uso.
    const dormindo = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|terminating connection/i.test(msg);
    res.status(dormindo ? 503 : 502).json({
      erro: dormindo ? 'banco_dormindo' : 'falha_no_banco',
      banco: banco.nome,
      detalhe: msg,
    });
  }
};
