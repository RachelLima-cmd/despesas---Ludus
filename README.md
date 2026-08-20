# Painel de Despesas — Ludus

Painel interno de acompanhamento das despesas mensais (Gerais · PJ · Ferramentas).
Cada linha tem uma caixa de seleção: **marcada = Pago ✓**, **desmarcada = Pendente**.
O status é salvo no servidor e compartilhado — todo mundo que entrar com a senha vê o mesmo estado.

## Estrutura

| Arquivo | O que faz |
| --- | --- |
| `middleware.js` | Porta de entrada. Nenhuma página é servida sem a senha. Roda na borda, antes de tudo. |
| `api/estado.js` | Lê e grava quais despesas já foram pagas (Postgres / Supabase). Cria a tabela sozinho. |
| `public/index.html` | O painel em si. |

## Variáveis de ambiente (Vercel → Settings → Environment Variables)

| Variável | Origem | Para quê |
| --- | --- | --- |
| `SENHA_PAINEL` | você define | Senha de entrada do painel. **Obrigatória** — sem ela o site fica bloqueado. |
| `POSTGRES_URL` | criada sozinha | Conexão com o Postgres. Aparece ao conectar o Supabase em *Storage*. |

Se o banco não estiver conectado, o painel continua funcionando, mas as marcações
ficam salvas apenas no navegador de quem marcou (o indicador no topo avisa).

## Como rodar o banco

1. No projeto na Vercel: **Storage → Create Database → Supabase** (plano gratuito).
2. Conectar ao projeto — as variáveis (`POSTGRES_URL` e companhia) entram sozinhas.
3. **Deployments → Redeploy** para o novo deploy enxergar as variáveis.

A tabela `despesas_pagas` é criada automaticamente no primeiro acesso — não há SQL para rodar na mão.

No plano gratuito o Supabase **hiberna após 7 dias sem uso**. Quando isso acontece o painel
continua abrindo, mostra *"Banco hibernando"* e salva as marcações localmente; basta reativar
o projeto no painel do Supabase para voltar a sincronizar.

## Trocar a senha

Edite `SENHA_PAINEL` em *Settings → Environment Variables* e faça um **Redeploy**.
Quem já estava logado é deslogado automaticamente (o cookie deixa de bater).

## Atualizar os dados do mês

Os valores estão fixos em `public/index.html`. Para o mês seguinte, edite o HTML
(ou gere um novo a partir da planilha) e faça `git push` — a Vercel publica sozinha.
O total do mês fica na constante `TOTAL` no script, no fim do arquivo.

## Segurança

- A página não é indexável (`noindex`) e nada é servido sem senha.
- O arquivo contém **chaves PIX (CPF, telefone, e-mail)** de prestadores. Não remova a
  proteção do `middleware.js` e não deixe o repositório público no GitHub.
