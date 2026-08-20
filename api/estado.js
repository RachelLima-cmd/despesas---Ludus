// Estado compartilhado das despesas (quem já foi pago) — Postgres / Supabase.
//
// Uma linha na tabela = uma despesa paga. Marcar insere, desmarcar remove.
// Isso evita que duas pessoas marcando ao mesmo tempo apaguem a marcação
// uma da outra, e ainda guarda quando cada uma foi paga.
//
// A tabela é criada sozinha no primeiro acesso — nada de SQL manual.

const { Pool } = require('pg');

const MES = 'agosto2026';
let pool = null;
let tabelaPronta = false;

function conexao() {
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
  const url = conexao();
  if (!url) return null;
  pool = new Pool({
    connectionString: url,
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    ssl: { rejectUnauthorized: false },
  });
  return pool;
}

async function garantirTabela(cliente) {
  if (tabelaPronta) return;
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

async function lerEstado(cliente) {
  const r = await cliente.query(
    'SELECT linha_id, pago_em FROM despesas_pagas WHERE mes = $1 ORDER BY pago_em',
    [MES],
  );
  const pagos = r.rows.map((l) => l.linha_id);
  const ultimo = r.rows.reduce((a, l) => (!a || l.pago_em > a ? l.pago_em : a), null);
  return { pagos, atualizadoEm: ultimo ? new Date(ultimo).toISOString() : null };
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

  const p = getPool();
  if (!p) {
    res.status(503).json({
      erro: 'banco_nao_configurado',
      dica: 'Conecte o Supabase em Vercel → Storage e faça um novo deploy.',
    });
    return;
  }

  let cliente;
  try {
    cliente = await p.connect();
  } catch (e) {
    // Supabase no plano gratuito hiberna após 7 dias sem uso.
    res.status(503).json({
      erro: 'banco_dormindo',
      dica: 'Reative o projeto no painel do Supabase (leva ~1 minuto).',
      detalhe: String(e.message || e),
    });
    return;
  }

  try {
    await garantirTabela(cliente);

    if (req.method === 'GET') {
      res.status(200).json(await lerEstado(cliente));
      return;
    }

    if (req.method === 'POST') {
      const { acao, id } = corpoJson(req);

      if (acao === 'limpar') {
        await cliente.query('DELETE FROM despesas_pagas WHERE mes = $1', [MES]);
      } else if (acao === 'marcar' || acao === 'desmarcar') {
        if (!id || typeof id !== 'string' || id.length > 300) {
          res.status(400).json({ erro: 'id_invalido' });
          return;
        }
        if (acao === 'marcar') {
          await cliente.query(
            `INSERT INTO despesas_pagas (mes, linha_id) VALUES ($1, $2)
             ON CONFLICT (mes, linha_id) DO NOTHING`,
            [MES, id],
          );
        } else {
          await cliente.query('DELETE FROM despesas_pagas WHERE mes = $1 AND linha_id = $2', [
            MES,
            id,
          ]);
        }
      } else {
        res.status(400).json({ erro: 'acao_invalida' });
        return;
      }

      res.status(200).json(await lerEstado(cliente));
      return;
    }

    res.setHeader('allow', 'GET, POST');
    res.status(405).json({ erro: 'metodo_nao_permitido' });
  } catch (e) {
    res.status(502).json({ erro: 'falha_no_banco', detalhe: String(e.message || e) });
  } finally {
    cliente.release();
  }
};
