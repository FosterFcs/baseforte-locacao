-- Esquema do banco D1 "baseforte-db" (cópia de segurança, lida em 15/11/2026)
CREATE TABLE usuarios (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  senha_hash TEXT NOT NULL,
  senha_salt TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  usuario_email TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now')),
  expira_em TEXT NOT NULL
);

CREATE TABLE clientes (
  id TEXT PRIMARY KEY,
  tipo_pessoa TEXT DEFAULT 'fisica',
  nome TEXT NOT NULL,
  documento TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  endereco TEXT,
  cidade TEXT,
  observacoes TEXT,
  status TEXT DEFAULT 'ativo',
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE ferramentas (
  id TEXT PRIMARY KEY,
  codigo TEXT UNIQUE NOT NULL,
  nome TEXT NOT NULL,
  categoria TEXT,
  foto_url TEXT,
  valor_diaria REAL NOT NULL,
  valor_semanal REAL,
  valor_mensal REAL,
  valor_reposicao REAL,
  quantidade_total INTEGER DEFAULT 1,
  quantidade_disponivel INTEGER DEFAULT 1,
  status TEXT DEFAULT 'disponivel',
  observacoes TEXT,
  criado_em TEXT DEFAULT (datetime('now'))
);

CREATE TABLE locacoes (
  id TEXT PRIMARY KEY,
  numero INTEGER,
  cliente_id TEXT NOT NULL,
  data_retirada TEXT NOT NULL,
  data_devolucao_prevista TEXT NOT NULL,
  data_devolucao_real TEXT,
  tipo_cobranca TEXT NOT NULL,
  valor_total REAL DEFAULT 0,
  valor_caucao REAL DEFAULT 0,
  valor_multa REAL DEFAULT 0,
  status TEXT DEFAULT 'ativa',
  observacoes TEXT,
  criado_em TEXT DEFAULT (datetime('now')),
  FOREIGN KEY(cliente_id) REFERENCES clientes(id)
);

CREATE TABLE itens_locacao (
  id TEXT PRIMARY KEY,
  locacao_id TEXT NOT NULL,
  ferramenta_id TEXT NOT NULL,
  quantidade INTEGER DEFAULT 1,
  valor_unitario REAL NOT NULL,
  subtotal REAL NOT NULL,
  FOREIGN KEY(locacao_id) REFERENCES locacoes(id),
  FOREIGN KEY(ferramenta_id) REFERENCES ferramentas(id)
);

CREATE TABLE pagamentos (
  id TEXT PRIMARY KEY,
  locacao_id TEXT NOT NULL,
  tipo TEXT NOT NULL,
  valor REAL NOT NULL,
  forma_pagamento TEXT,
  data_pagamento TEXT DEFAULT (datetime('now')),
  observacoes TEXT,
  FOREIGN KEY(locacao_id) REFERENCES locacoes(id)
);

CREATE INDEX idx_locacoes_cliente ON locacoes(cliente_id);
CREATE INDEX idx_itens_locacao ON itens_locacao(locacao_id);
CREATE INDEX idx_sessions_expira ON sessions(expira_em);
