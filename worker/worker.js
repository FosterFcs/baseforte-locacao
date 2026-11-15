/* ==========================================================
   BACKEND — Base Forte Locação (Cloudflare Worker + D1)
   Substitui o Supabase: login, sessão e CRUD das tabelas.
   ========================================================== */

// Tabelas permitidas e suas colunas (evita que qualquer coluna
// arbitrária seja gravada — só o que está listado aqui passa).
const TABELAS = {
  clientes: ['tipo_pessoa','nome','documento','telefone','email','endereco','cidade','observacoes','status'],
  ferramentas: ['codigo','nome','categoria','foto_url','valor_diaria','valor_semanal','valor_mensal','valor_reposicao','quantidade_total','quantidade_disponivel','status','observacoes'],
  locacoes: ['cliente_id','data_retirada','data_devolucao_prevista','data_devolucao_real','tipo_cobranca','valor_total','valor_caucao','valor_multa','status','observacoes'],
  itens_locacao: ['locacao_id','ferramenta_id','quantidade','valor_unitario','subtotal'],
  pagamentos: ['locacao_id','tipo','valor','forma_pagamento','data_pagamento','observacoes']
};

function corsHeaders(origin){
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function json(data, status, origin){
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) }
  });
}

async function hashPassword(password, salt){
  const enc = new TextEncoder();
  const data = enc.encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hashBuffer)].map(b => b.toString(16).padStart(2,'0')).join('');
}

async function getSessionEmail(request, env){
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if(!token) return null;
  const row = await env.DB.prepare(
    'SELECT usuario_email, expira_em FROM sessions WHERE token = ?1'
  ).bind(token).first();
  if(!row) return null;
  if(new Date(row.expira_em) < new Date()){
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(token).run();
    return null;
  }
  return row.usuario_email;
}

export default {
  async fetch(request, env, ctx){
    const origin = request.headers.get('Origin') || '*';
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');
    const method = request.method;

    if(method === 'OPTIONS'){
      return new Response(null, { headers: corsHeaders(origin) });
    }

    try{
      // ---------- LOGIN ----------
      if(path === '/api/login' && method === 'POST'){
        const { email, password } = await request.json();
        if(!email || !password) return json({message:'E-mail e senha obrigatórios'}, 400, origin);

        const user = await env.DB.prepare('SELECT * FROM usuarios WHERE email = ?1').bind(email).first();
        if(!user) return json({message:'E-mail ou senha inválidos'}, 401, origin);

        const hash = await hashPassword(password, user.senha_salt);
        if(hash !== user.senha_hash) return json({message:'E-mail ou senha inválidos'}, 401, origin);

        const token = crypto.randomUUID() + crypto.randomUUID();
        const expira = new Date(Date.now() + 30*24*60*60*1000).toISOString(); // 30 dias
        await env.DB.prepare('INSERT INTO sessions (token, usuario_email, expira_em) VALUES (?1,?2,?3)')
          .bind(token, email, expira).run();

        return json({ token, user: { email } }, 200, origin);
      }

      // ---------- LOGOUT ----------
      if(path === '/api/logout' && method === 'POST'){
        const auth = request.headers.get('Authorization') || '';
        const token = auth.replace('Bearer ', '').trim();
        if(token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?1').bind(token).run();
        return json({ ok: true }, 200, origin);
      }

      // ---------- SESSÃO ATUAL ----------
      if(path === '/api/me' && method === 'GET'){
        const email = await getSessionEmail(request, env);
        if(!email) return json({message:'Não autenticado'}, 401, origin);
        return json({ email }, 200, origin);
      }

      // ---------- GESTÃO DE USUÁRIOS ----------
      if(path === '/api/usuarios'){
        const emailLogado = await getSessionEmail(request, env);
        if(!emailLogado) return json({message:'Não autenticado'}, 401, origin);

        if(method === 'GET'){
          const { results } = await env.DB.prepare('SELECT id, email, criado_em FROM usuarios ORDER BY criado_em ASC').all();
          return json(results, 200, origin);
        }

        if(method === 'POST'){
          const { email, password } = await request.json();
          if(!email || !password) return json({message:'E-mail e senha obrigatórios'}, 400, origin);
          if(password.length < 6) return json({message:'Senha deve ter ao menos 6 caracteres'}, 400, origin);

          const existente = await env.DB.prepare('SELECT id FROM usuarios WHERE email = ?1').bind(email).first();
          if(existente) return json({message:'Já existe um usuário com esse e-mail'}, 409, origin);

          const salt = crypto.randomUUID().replace(/-/g,'');
          const hash = await hashPassword(password, salt);
          const novoId = crypto.randomUUID();
          await env.DB.prepare('INSERT INTO usuarios (id, email, senha_hash, senha_salt) VALUES (?1,?2,?3,?4)')
            .bind(novoId, email, hash, salt).run();

          return json({ id: novoId, email }, 201, origin);
        }
      }

      if(path.startsWith('/api/usuarios/') && method === 'DELETE'){
        const emailLogado = await getSessionEmail(request, env);
        if(!emailLogado) return json({message:'Não autenticado'}, 401, origin);

        const idAlvo = path.replace('/api/usuarios/', '');
        const total = await env.DB.prepare('SELECT COUNT(*) as n FROM usuarios').first();
        if(total.n <= 1) return json({message:'Não é possível excluir o único usuário existente'}, 400, origin);

        await env.DB.prepare('DELETE FROM usuarios WHERE id = ?1').bind(idAlvo).run();
        return json({ ok: true }, 200, origin);
      }

      // ---------- CRUD DE TABELAS ----------
      const match = path.match(/^\/api\/([a-z_]+)(?:\/([a-zA-Z0-9-]+))?$/);
      if(match){
        const tabela = match[1];
        const id = match[2];

        if(!TABELAS[tabela]) return json({message:'Tabela não permitida'}, 404, origin);

        // todas as rotas de dados exigem sessão válida
        const email = await getSessionEmail(request, env);
        if(!email) return json({message:'Não autenticado'}, 401, origin);

        const colunas = TABELAS[tabela];

        // ---- GET (listar) ----
        if(method === 'GET' && !id){
          let sql = `SELECT * FROM ${tabela}`;
          const order = url.searchParams.get('order');
          const dir = url.searchParams.get('dir') === 'asc' ? 'ASC' : 'DESC';
          if(order && (colunas.includes(order) || order === 'criado_em' || order === 'id')){
            sql += ` ORDER BY ${order} ${dir}`;
          }
          const { results } = await env.DB.prepare(sql).all();
          return json(results, 200, origin);
        }

        // ---- POST (criar — objeto único ou lista) ----
        if(method === 'POST' && !id){
          const body = await request.json();
          const itens = Array.isArray(body) ? body : [body];
          const criados = [];

          for(const item of itens){
            const novoId = item.id || (crypto.randomUUID());
            const camposPresentes = colunas.filter(c => item[c] !== undefined);
            const nomes = ['id', ...camposPresentes];
            const valores = [novoId, ...camposPresentes.map(c => item[c])];

            if(tabela === 'locacoes'){
              const maxRow = await env.DB.prepare('SELECT COALESCE(MAX(numero),0) as maxNum FROM locacoes').first();
              nomes.push('numero');
              valores.push((maxRow.maxNum || 0) + 1);
            }

            const placeholders = nomes.map((_,i) => `?${i+1}`).join(',');
            const sql = `INSERT INTO ${tabela} (${nomes.join(',')}) VALUES (${placeholders})`;
            await env.DB.prepare(sql).bind(...valores).run();

            const criado = await env.DB.prepare(`SELECT * FROM ${tabela} WHERE id = ?1`).bind(novoId).first();
            criados.push(criado);
          }

          return json(Array.isArray(body) ? criados : criados[0], 201, origin);
        }

        // ---- PATCH (atualizar) ----
        if(method === 'PATCH' && id){
          const body = await request.json();
          const camposPresentes = colunas.filter(c => body[c] !== undefined);
          if(!camposPresentes.length) return json({message:'Nada para atualizar'}, 400, origin);

          const sets = camposPresentes.map((c,i) => `${c} = ?${i+1}`).join(', ');
          const valores = camposPresentes.map(c => body[c]);
          valores.push(id);

          await env.DB.prepare(`UPDATE ${tabela} SET ${sets} WHERE id = ?${valores.length}`).bind(...valores).run();
          const atualizado = await env.DB.prepare(`SELECT * FROM ${tabela} WHERE id = ?1`).bind(id).first();
          return json(atualizado, 200, origin);
        }

        // ---- DELETE ----
        if(method === 'DELETE' && id){
          await env.DB.prepare(`DELETE FROM ${tabela} WHERE id = ?1`).bind(id).run();
          return json({ ok: true }, 200, origin);
        }
      }

      return json({message:'Rota não encontrada'}, 404, origin);

    }catch(err){
      return json({message: 'Erro no servidor: ' + err.message}, 500, origin);
    }
  }
};
