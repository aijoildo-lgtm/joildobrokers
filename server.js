const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const { extrairAoCubo } = require('./aocubo');
const orulo = require('./orulo');

const app = express();
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '30mb' }));

const DATA_FILE = path.join(__dirname, 'imoveis.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const SESSION_FILE = path.join(__dirname, 'orulo-session.json');
const ADMIN_USER = process.env.ADMIN_USER || 'adm';
const ADMIN_PASS = process.env.ADMIN_PASS || '1234';
if (!process.env.ADMIN_PASS) console.warn('⚠️  Defina ADMIN_USER e ADMIN_PASS nas variáveis de ambiente.');

const DEFAULT_CONFIG = {
  logoUrl: '', slogan: 'Ética e dedicação para tornar seus sonhos realidade',
  linkedin: 'https://www.linkedin.com/in/joildo-costa-0154a29b/',
  instagram: '', facebook: '', youtube: '',
  whatsapp: '5511951377033', telefone: '(11) 95137-7033',
  email: 'joildo.contato@gmail.com', creci: 'CRECI 200298', parceiros: [],
  quemSomos: {
    titulo: 'Quem Somos | Joildo Brokers',
    subtitulo: 'Expertise em consultoria estratégica de ativos imobiliários de alto padrão e alta liquidez',
    foto: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=800&q=80',
    nome: 'Joildo Costa',
    cargo: 'Founder & Senior Real Estate Advisor',
    p1: 'A <strong>Joildo Brokers</strong> é uma consultoria imobiliária boutique estruturada sob a liderança executiva de <strong>Joildo Costa</strong>, profissional especialista com ampla atuação no mercado imobiliário de São Paulo e expansão nacional.',
    p2: 'Nosso trabalho combina <strong>inteligência de mercado, análise de valorização do metro quadrado e negociação estratégica</strong> para conectar compradores, investidores e incorporadoras aos projetos mais exclusivos dos eixos de maior liquidez (Jardins, Itaim Bibi, Pinheiros, Vila Nova Conceição e Alphaville).',
    linkedin: 'https://www.linkedin.com/in/joildo-costa-0154a29b/'
  }
};

const lerJson = (file, fallback) => {
  try {
    if (!fs.existsSync(file)) { fs.writeFileSync(file, JSON.stringify(fallback, null, 2)); return fallback; }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.error('Erro lendo', file, e.message); return fallback; }
};
const gravarJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// AUTENTICAÇÃO (token assinado, continua válido por 7 dias mesmo se o servidor reiniciar)
const assinar = (exp) => crypto.createHmac('sha256', `${ADMIN_USER}|${ADMIN_PASS}`).update(String(exp)).digest('hex');
const tokenValido = (t) => {
  const [exp, sig] = String(t || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const esperado = Buffer.from(assinar(exp)), recebido = Buffer.from(sig);
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
};
const exigirLogin = (req, res, next) =>
  tokenValido(req.headers['x-token']) ? next() : res.status(401).json({ success: false, error: 'Não autorizado.' });

app.post('/api/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    const exp = Date.now() + 7 * 24 * 3600 * 1000;
    return res.json({ success: true, token: `${exp}.${assinar(exp)}` });
  }
  res.status(401).json({ success: false, error: 'Acesso negado.' });
});

// PÁGINAS (só arquivos públicos, config.json e server.js NÃO ficam expostos)
const enviar = (f) => (req, res) => res.sendFile(path.join(__dirname, f));
app.get('/', enviar('index.html'));
app.get(['/admin', '/admin.html'], enviar('admin.html'));
app.get(['/cpainel', '/cpainel.html'], enviar('cpainel.html'));
app.get('/style.css', enviar('style.css'));
app.get('/taxonomia.js', enviar('taxonomia.js'));

// BANCO DE DADOS (MongoDB se MONGODB_URI existir; senão arquivos JSON)
let db = null, bancoStatus = 'arquivos';
async function iniciarBanco() {
  if (!process.env.MONGODB_URI) return;
  try {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    await client.connect();
    db = client.db('joildobrokers');
    await db.collection('imoveis').createIndex({ id: 1 }, { unique: true });
    if (!(await db.collection('config').findOne({ _id: 'semente' }))) {
      const base = lerJson(DATA_FILE, []);
      if (base.length) await db.collection('imoveis').insertMany(base.map((i, n) => ({ ...i, criadoEm: i.criadoEm || new Date(Date.now() - n * 1000).toISOString() })));
      await db.collection('config').insertOne({ _id: 'semente', em: new Date().toISOString() });
    }
    bancoStatus = 'mongodb';
    console.log('✅ MongoDB conectado');
  } catch (e) { db = null; bancoStatus = 'arquivos (falha ao conectar no banco)'; console.error('Falha no MongoDB:', e.message); }
}
const ah = (fn) => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ success: false, error: 'Erro interno.' }); });
const getImoveis = async () => db ? db.collection('imoveis').find({}, { projection: { _id: 0 } }).sort({ criadoEm: -1 }).toArray() : lerJson(DATA_FILE, []);
async function addImovel(i) {
  if (db) return db.collection('imoveis').insertOne({ ...i });
  const l = lerJson(DATA_FILE, []); l.unshift(i); gravarJson(DATA_FILE, l);
}
async function updImovel(id, set) {
  if (db) return (await db.collection('imoveis').updateOne({ id: Number(id) }, { $set: set })).matchedCount > 0;
  const l = lerJson(DATA_FILE, []); const x = l.find(i => String(i.id) === String(id));
  if (!x) return false; Object.assign(x, set); gravarJson(DATA_FILE, l); return true;
}
async function delImovel(id) {
  if (db) return (await db.collection('imoveis').deleteOne({ id: Number(id) })).deletedCount > 0;
  const l = lerJson(DATA_FILE, []); const n = l.filter(i => String(i.id) !== String(id));
  gravarJson(DATA_FILE, n); return n.length < l.length;
}
const getConfig = async () => {
  if (db) { const d = await db.collection('config').findOne({ _id: 'site' }); return { ...DEFAULT_CONFIG, ...(d ? d.dados : lerJson(CONFIG_FILE, DEFAULT_CONFIG)) }; }
  return { ...DEFAULT_CONFIG, ...lerJson(CONFIG_FILE, DEFAULT_CONFIG) };
};
const saveConfig = async (c) => db ? db.collection('config').updateOne({ _id: 'site' }, { $set: { dados: c } }, { upsert: true }) : gravarJson(CONFIG_FILE, c);

// VALIDAÇÃO DO IMÓVEL (só campos conhecidos, com limites)
const TXT = ['ref','titulo','preco','foto','localizacao','estagio','destaque','area','dormitorios','vagas','youtube','tour360','transacao','categoria','tipo','apresentacao','diferencial','proximidade','origem','linkOrigem','videoArquivo','sincronizadoEm','construtora','precoM2'];
const s2 = (v, n) => String(v == null ? '' : v).slice(0, n);
function limpar(b) {
  const o = {};
  TXT.forEach(k => { if (b[k] != null) o[k] = s2(b[k], k === 'apresentacao' ? 4000 : 500); });
  o.fotos = (Array.isArray(b.fotos) ? b.fotos : []).map(u => s2(u, 500)).filter(u => /^https?:\/\//i.test(u)).slice(0, 100);
  // plantas: texto (link) ou objeto { nome, url }
  o.plantas = (Array.isArray(b.plantas) ? b.plantas : []).map(p => (p && typeof p === 'object') ? { nome: s2(p.nome, 120), url: s2(p.url, 500) } : s2(p, 500))
    .filter(p => /^https?:\/\//i.test(typeof p === 'string' ? p : p.url)).slice(0, 100);
  o.lazer = (Array.isArray(b.lazer) ? b.lazer : []).map(x => s2(x, 80)).filter(Boolean).slice(0, 60);
  o.caracteristicasUnidade = (Array.isArray(b.caracteristicasUnidade) ? b.caracteristicasUnidade : []).map(x => s2(x, 80)).filter(Boolean).slice(0, 60);
  o.tipologias = (Array.isArray(b.tipologias) ? b.tipologias : []).slice(0, 40).map(t => ({ nome: s2(t.nome, 80), area: s2(t.area, 40), dorm: s2(t.dorm, 20), suites: s2(t.suites, 20), vagas: s2(t.vagas, 20), preco: s2(t.preco, 40) })).filter(t => t.nome);
  o.infoTecnica = (Array.isArray(b.infoTecnica) ? b.infoTecnica : []).slice(0, 40).map(x => ({ k: s2(x.k, 80), v: s2(x.v, 200) })).filter(x => x.k);
  o.emDestaque = b.emDestaque === true;
  o.sincronizar = b.sincronizar !== false;
  const coord = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && Math.abs(n) <= 180 ? n : null; };
  o.lat = coord(b.lat); o.lng = coord(b.lng);
  o.ativo = b.ativo !== false;
  if (b.demo === true) o.demo = true;
  return o;
}
const novaRef = () => `REF-${Math.floor(100000 + Math.random() * 900000)}`;

// APIs
app.get('/api/versao', (req, res) => res.json({ versao: '2026-11-14-o', banco: bancoStatus }));
app.get('/api/imoveis', ah(async (req, res) => res.json((await getImoveis()).filter(i => i.ativo !== false))));
app.get('/api/admin/imoveis', exigirLogin, ah(async (req, res) => res.json(await getImoveis())));
app.get('/api/config', ah(async (req, res) => res.json(await getConfig())));
app.post('/api/config', exigirLogin, ah(async (req, res) => { await saveConfig(req.body); res.json({ success: true, message: 'Configurações atualizadas!' }); }));

app.post('/api/adicionar-imovel', exigirLogin, ah(async (req, res) => {
  const i = limpar(req.body || {}), agora = new Date().toISOString();
  i.id = Date.now(); i.ref = i.ref || novaRef(); i.criadoEm = agora; i.atualizadoEm = agora;
  await addImovel(i);
  res.json({ success: true, ref: i.ref });
}));
app.patch('/api/imoveis/:id', exigirLogin, ah(async (req, res) => {
  const b = req.body || {}, set = { atualizadoEm: new Date().toISOString() };
  if ('ativo' in b) set.ativo = b.ativo === true;
  if ('emDestaque' in b) set.emDestaque = b.emDestaque === true;
  res.json({ success: await updImovel(req.params.id, set) });
}));
app.put('/api/imoveis/:id', exigirLogin, ah(async (req, res) => {
  const b = req.body || {}, set = limpar(b);
  set.demo = b.demo === true;
  set.atualizadoEm = new Date().toISOString();
  if (!set.ref) delete set.ref;
  const ok = await updImovel(req.params.id, set);
  res.status(ok ? 200 : 404).json(ok ? { success: true } : { success: false, error: 'Imóvel não encontrado.' });
}));
app.delete('/api/imoveis/:id', exigirLogin, ah(async (req, res) => res.json({ success: await delImovel(req.params.id) })));
app.post('/api/duplicar-imovel/:id', exigirLogin, ah(async (req, res) => {
  const o = (await getImoveis()).find(i => String(i.id) === String(req.params.id));
  if (!o) return res.status(404).json({ success: false, error: 'Imóvel não encontrado.' });
  const agora = new Date().toISOString(), c = { ...o };
  delete c._id; delete c.demo; delete c.acessos; delete c.sincronizadoEm;
  Object.assign(c, { id: Date.now(), ref: novaRef(), titulo: `${o.titulo} (cópia)`, ativo: false, emDestaque: false, criadoEm: agora, atualizadoEm: agora });
  await addImovel(c);
  res.json({ success: true, ref: c.ref });
}));

// EXTRAÇÃO POR TEXTO COLADO (funciona sempre, sem depender do login do Órulo)
function tituloDoTexto(t) {
  const linhas = t.split('\n').map(l => l.trim()).filter(Boolean);
  const ignorar = /^(tabela digital|compartilhar|tour virtual|ver fotos|(?:ó|o)rulo|empreendimentos|terrenos de interesse|integrar crm|indique e ganhe|editar cadastro|sair|c[óo]digo:)/i;
  const limpa = (l) => l.replace(/\s*tabela digital\s*$/i, '').trim();
  const iEnd = linhas.findIndex(l => /\d+\.\s*[^-\n]+-\s*[^\n\/]+\/[A-Z]{2}/.test(l));
  for (let i = iEnd - 1; i >= 0; i--) {
    const l = limpa(linhas[i]);
    if (l.length > 2 && l.length < 80 && !ignorar.test(l)) return l;
  }
  return limpa(linhas.find(l => l.length > 3 && l.length < 80 && !ignorar.test(l)) || '');
}

function extrairDoTexto(texto) {
  const t = String(texto || '');
  const pega = (re) => { const m = t.match(re); return m ? m[1] : ''; };
  const precos = [...t.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/g)]
    .map(m => ({ s: m[1], n: parseFloat(m[1].replace(/\./g, '').replace(',', '.')) }))
    .filter(p => p.n >= 50000).sort((a, b) => a.n - b.n);
  const area = pega(/(\d{2,4}(?:[.,]\d+)?(?:\s*a\s*\d{2,4}(?:[.,]\d+)?)?)\s*m²/i);
  const loc = t.match(/\d+\.\s*([^-\n]+?)\s*-\s*([^\n\/]+)\/([A-Z]{2})/);
  const dorm = pega(/(\d+)\s*(?:dormit[óo]rios?|quartos?|dorms?)/i);
  const suites = pega(/(\d+)\s*su[ií]tes?/i);
  const vagas = pega(/(\d+)\s*vagas?/i);
  return {
    titulo: tituloDoTexto(t),
    preco: precos.length ? `R$ ${precos[0].s}` : '',
    area: area ? `${area}m²` : '',
    dormitorios: dorm ? `${dorm} Dormitório${dorm > 1 ? 's' : ''}${suites ? ` (${suites} suíte${suites > 1 ? 's' : ''})` : ''}` : '',
    localizacao: loc ? `${loc[1].trim()}, ${loc[2].trim()} - ${loc[3]}` : '',
    vagas: vagas && vagas !== '0' ? `${vagas} vaga${vagas > 1 ? 's' : ''}` : ''
  };
}
app.post('/api/extrair-texto', exigirLogin, (req, res) => res.json({ success: true, dados: extrairDoTexto(req.body.texto) }));

// SESSÃO DO ÓRULO (cookie guardado só no servidor, nunca enviado ao navegador)
app.post('/api/orulo-sessao', exigirLogin, (req, res) => {
  gravarJson(SESSION_FILE, { cookie: String((req.body || {}).cookie || '').trim(), salvoEm: new Date().toISOString() });
  res.json({ success: true });
});
app.get('/api/orulo-sessao', exigirLogin, (req, res) => {
  const s = lerJson(SESSION_FILE, {});
  res.json({ salva: !!s.cookie, salvoEm: s.salvoEm || null });
});

// MINERAÇÃO DO ÓRULO (dados reais ou nenhum, nunca valores inventados)
// IMPORTAÇÃO POR LINK: AoCubo (leitura aberta) e Órulo (exige login)
async function importarAoCubo(url, res) {
  try {
    const r = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36', 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html' },
      timeout: 15000, maxRedirects: 3
    });
    const dados = extrairAoCubo(String(r.data), url);
    if (!dados.titulo && !dados.preco) return res.json({ success: false, precisaTexto: true, error: 'Abri a página, mas não encontrei os dados do imóvel. Use a aba Assistente IA: cole o texto da página e a IA preenche o cadastro.' });
    const faltando = ['titulo', 'preco', 'area', 'dormitorios', 'foto'].filter(k => !dados[k]);
    res.json({ success: true, dados, faltando, precisaTexto: faltando.length > 1, fonte: 'AoCubo' });
  } catch (e) {
    res.json({ success: false, precisaTexto: true, error: `Não consegui abrir o link do AoCubo (${e.response ? 'HTTP ' + e.response.status : e.code || e.message}). Use a aba Assistente IA e cole o texto da página.` });
  }
}
app.post(['/api/minerar-orulo', '/api/importar-link'], exigirLogin, async (req, res) => {
  const { url } = req.body || {};
  let host = ''; try { host = new URL(url).hostname; } catch (e) {}
  if (/(^|\.)aocubo\.com$/i.test(host)) return importarAoCubo(url, res);
  if (!url || !/(^|\.)orulo\.com\.br$/i.test(host)) return res.status(400).json({ success: false, error: 'Use um link do AoCubo ou do Órulo.' });
  const m = String(url).match(/buildings\/(\d+)/i);
  if (!m) return res.json({ success: false, precisaTexto: true, error: 'Não achei o número do empreendimento no link (modelo: orulo.com.br/buildings/83363).' });
  if (!process.env.ORULO_CLIENT_ID || !process.env.ORULO_CLIENT_SECRET)
    return res.json({ success: false, precisaTexto: true, error: 'Falta ligar a API da Órulo: defina ORULO_CLIENT_ID e ORULO_CLIENT_SECRET no Render. Enquanto isso, use a aba Assistente IA e cole o texto da página.' });
  try {
    const { dados, diag } = await orulo.importar(m[1]);
    console.log('ORULO API:', diag);
    const faltando = ['titulo', 'preco', 'area', 'dormitorios', 'foto'].filter(k => !dados[k]);
    res.json({ success: true, dados, faltando, precisaTexto: faltando.length > 1, fonte: 'Órulo', diag: faltando.length > 1 ? diag : undefined });
  } catch (e) {
    const st = e.response && e.response.status;
    console.error('Erro Órulo API:', st, e.response ? JSON.stringify(e.response.data).slice(0, 300) : e.message);
    const msg = st === 401 || st === 400 ? 'A Órulo recusou as credenciais (confira ORULO_CLIENT_ID e ORULO_CLIENT_SECRET).'
      : st === 403 || st === 404 ? 'Esse empreendimento não está liberado para a sua conta na Órulo.'
      : `Não consegui falar com a API da Órulo (${st ? 'HTTP ' + st : e.code || e.message}).`;
    res.json({ success: false, precisaTexto: true, error: msg + ' Você pode usar a aba Assistente IA com o texto da página.' });
  }
});

// ===== CONTEÚDOS (blog, notícias e depoimentos editáveis pelo painel) =====
const CONTEUDOS_FILE = path.join(__dirname, 'conteudos.json');
const U = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=700&q=80`;
const CONTEUDOS_PADRAO = [
  { id: 1800000000001, tipo: 'blog', titulo: 'Como escolher o apartamento ideal na planta', categoria: 'Investimento', data: '2026-11-12', imagem: U('photo-1484154218962-a197022b5858') },
  { id: 1800000000002, tipo: 'blog', titulo: 'Varanda gourmet: como aproveitar cada metro do espaço', categoria: 'Decoração', data: '2026-10-28', imagem: U('photo-1493809842364-78817add7ffb') },
  { id: 1800000000003, tipo: 'blog', titulo: 'Morar perto do metrô: o que muda na rotina da família', categoria: 'Lifestyle', data: '2026-10-15', imagem: U('photo-1502672260266-1c1ef2d93688') },
  { id: 1800000000004, tipo: 'noticia', titulo: 'Financiamento imobiliário: entenda as etapas até a assinatura', categoria: 'Joildo Informa', data: '2026-11-10', imagem: U('photo-1560518883-ce09059eeffa') },
  { id: 1800000000005, tipo: 'noticia', titulo: 'Documentos que você precisa reunir para comprar um imóvel', categoria: 'Joildo Informa', data: '2026-11-03', imagem: U('photo-1522708323590-d24dbb6b0267') },
  { id: 1800000000006, tipo: 'noticia', titulo: 'Jardins e Itaim Bibi: o que observar antes de investir', categoria: 'Bairros', data: '2026-10-24', imagem: U('photo-1545324418-cc1a3fa10c00') },
  { id: 1800000000007, tipo: 'noticia', titulo: 'Tour virtual 360°: conhecer o imóvel sem sair de casa', categoria: 'Tecnologia', data: '2026-10-09', imagem: U('photo-1600585154340-be6161a56a0c') },
  { id: 1800000000008, tipo: 'depoimento', titulo: '', texto: 'O Joildo possui uma leitura de mercado espetacular. Apresentou opções fora do circuito tradicional com retorno rápido para meu portfólio.', autor: 'Carlos M., Investidor Institucional', estrelas: 5, data: '2026-01-02' },
  { id: 1800000000009, tipo: 'depoimento', titulo: '', texto: 'Atendimento ético, ágil e altamente técnico. Encontramos o apartamento ideal nos Jardins exatamente dentro dos parâmetros que solicitamos.', autor: 'Fernanda & Roberto, Compradores', estrelas: 5, data: '2026-01-01' }
].map(c => ({ ativo: true, ...c }));

async function getConteudos() {
  if (db) {
    const col = db.collection('conteudos');
    if (!(await db.collection('config').findOne({ _id: 'semente_conteudos' }))) {
      if (await col.countDocuments() === 0) await col.insertMany(CONTEUDOS_PADRAO.map(c => ({ ...c })));
      await db.collection('config').insertOne({ _id: 'semente_conteudos', em: new Date().toISOString() });
    }
    return col.find({}, { projection: { _id: 0 } }).sort({ data: -1 }).toArray();
  }
  return lerJson(CONTEUDOS_FILE, CONTEUDOS_PADRAO).sort((a, b) => String(b.data).localeCompare(String(a.data)));
}
const salvarConteudos = async (lista) => gravarJson(CONTEUDOS_FILE, lista);
async function cAdd(c) { if (db) return db.collection('conteudos').insertOne({ ...c }); const l = await getConteudos(); l.unshift(c); return salvarConteudos(l); }
async function cUpd(id, set) {
  if (db) return (await db.collection('conteudos').updateOne({ id: Number(id) }, { $set: set })).matchedCount > 0;
  const l = await getConteudos(); const x = l.find(c => String(c.id) === String(id));
  if (!x) return false; Object.assign(x, set); await salvarConteudos(l); return true;
}
async function cDel(id) {
  if (db) return (await db.collection('conteudos').deleteOne({ id: Number(id) })).deletedCount > 0;
  const l = await getConteudos(); const n = l.filter(c => String(c.id) !== String(id));
  await salvarConteudos(n); return n.length < l.length;
}
function limparConteudo(b) {
  const o = {};
  o.tipo = ['blog', 'noticia', 'depoimento'].includes(b.tipo) ? b.tipo : 'blog';
  o.titulo = s2(b.titulo, 200); o.categoria = s2(b.categoria, 60);
  o.data = /^\d{4}-\d{2}-\d{2}$/.test(b.data || '') ? b.data : new Date().toISOString().slice(0, 10);
  o.imagem = /^https?:\/\//i.test(b.imagem || '') ? s2(b.imagem, 500) : '';
  o.link = /^https?:\/\//i.test(b.link || '') ? s2(b.link, 500) : '';
  o.texto = s2(b.texto, 8000); o.autor = s2(b.autor, 120);
  o.estrelas = Math.min(5, Math.max(1, parseInt(b.estrelas, 10) || 5));
  o.ativo = b.ativo !== false;
  return o;
}
app.get('/api/conteudos', ah(async (req, res) => res.json((await getConteudos()).filter(c => c.ativo !== false))));
app.get('/api/admin/conteudos', exigirLogin, ah(async (req, res) => res.json(await getConteudos())));
app.post('/api/conteudos', exigirLogin, ah(async (req, res) => {
  const c = limparConteudo(req.body || {}); c.id = Date.now(); c.criadoEm = new Date().toISOString();
  if (c.tipo === 'depoimento' ? !c.texto : !c.titulo) return res.status(400).json({ success: false, error: 'Preencha o título (ou o texto do depoimento).' });
  await cAdd(c); res.json({ success: true });
}));
app.put('/api/conteudos/:id', exigirLogin, ah(async (req, res) => {
  const set = limparConteudo(req.body || {}); set.atualizadoEm = new Date().toISOString();
  const ok = await cUpd(req.params.id, set);
  res.status(ok ? 200 : 404).json({ success: ok });
}));
app.patch('/api/conteudos/:id', exigirLogin, ah(async (req, res) => res.json({ success: await cUpd(req.params.id, { ativo: (req.body || {}).ativo === true }) })));
app.delete('/api/conteudos/:id', exigirLogin, ah(async (req, res) => res.json({ success: await cDel(req.params.id) })));

// ===== ASSISTENTE DE IA (precisa da variável ANTHROPIC_API_KEY no Render) =====
const IA_MODELO = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const IA_SISTEMA = 'Você é o assistente de conteúdo da Joildo Brokers, consultoria imobiliária de alto padrão em São Paulo (CRECI 200298). Escreva em português do Brasil, tom elegante, claro e confiável, sem exageros. REGRA ABSOLUTA: nunca invente preço, metragem, prazo de entrega, nome de construtora, endereço ou qualquer dado que não esteja no que foi informado. Se faltar informação, escreva sem ela. Responda só com o texto pedido, sem comentários antes ou depois.';
app.post('/api/ia', exigirLogin, async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(503).json({ success: false, error: 'IA não configurada. No Render, adicione a variável ANTHROPIC_API_KEY.' });
  const { tarefa, dados, instrucao } = req.body || {};
  const ctx = String(JSON.stringify(dados || {})).slice(0, 8000);
  const ins = String(instrucao || '').slice(0, 4000);
  const pedidos = {
    apresentacao: `Escreva uma apresentação de 2 a 3 parágrafos curtos para o anúncio deste imóvel, usando SOMENTE estes dados:\n${ctx}\n${ins}`,
    post: `Escreva um texto (300 a 500 palavras, com subtítulos simples) sobre o tema abaixo, útil para quem quer comprar imóvel em São Paulo. Não cite números de mercado que você não possa garantir.\nPedido: ${ins}\nDados de apoio: ${ctx}`,
    revisar: `Revise e melhore o texto abaixo (correção, clareza e tom profissional), mantendo todos os fatos.\n${ins}`,
    titulos: `Sugira 5 títulos curtos e atraentes para este conteúdo, um por linha, sem numeração.\n${ins}\n${ctx}`,
    extrair: `Extraia do texto abaixo os dados do imóvel e responda APENAS um JSON válido, sem crases, com as chaves: titulo, preco, localizacao, area, dormitorios, vagas, diferencial, proximidade, apresentacao (resumo de 2 frases), lazer (array de strings). Use "" (ou []) para o que não estiver no texto. Não invente nada.\nTEXTO:\n${ins}`,
    livre: ins
  };
  const prompt = pedidos[tarefa];
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ success: false, error: 'Pedido inválido.' });
  try {
    const r = await axios.post('https://api.anthropic.com/v1/messages',
      { model: IA_MODELO, max_tokens: 1800, system: IA_SISTEMA, messages: [{ role: 'user', content: prompt }] },
      { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 60000 });
    const texto = (r.data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
    res.json({ success: true, texto });
  } catch (e) {
    console.error('Erro IA:', e.response ? JSON.stringify(e.response.data) : e.message);
    res.status(502).json({ success: false, error: 'A IA não respondeu (' + (e.response ? 'HTTP ' + e.response.status : e.code || e.message) + '). Confira a chave e o modelo.' });
  }
});


// ===== UPLOAD DE FOTOS E VÍDEOS (Cloudinary, assinado no servidor) =====
// No Render: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET
app.post('/api/upload', exigirLogin, async (req, res) => {
  const { tipo, arquivo } = req.body || {};
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
  if (!cloud || !key || !secret) return res.status(503).json({ success: false, error: 'Upload não configurado. No Render, defina CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET.' });
  const m = String(arquivo || '').match(/^data:(image|video)\//);
  if (!m) return res.status(400).json({ success: false, error: 'Envie uma foto ou um vídeo.' });
  const recurso = m[1];
  const pasta = 'joildobrokers/' + (tipo === 'planta' ? 'plantas' : recurso === 'video' ? 'videos' : 'fotos');
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHash('sha1').update(`folder=${pasta}&timestamp=${timestamp}${secret}`).digest('hex');
  try {
    const r = await axios.post(`https://api.cloudinary.com/v1_1/${cloud}/${recurso}/upload`,
      new URLSearchParams({ file: arquivo, api_key: key, timestamp: String(timestamp), folder: pasta, signature }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 120000 });
    res.json({ success: true, url: r.data.secure_url });
  } catch (e) {
    console.error('Erro no upload:', e.response ? JSON.stringify(e.response.data).slice(0, 300) : e.message);
    res.status(502).json({ success: false, error: 'O serviço de imagens recusou o arquivo. Confira o tamanho e o formato.' });
  }
});

// ===== SINCRONIZAÇÃO COM AOCUBO E ÓRULO (preço, estágio, área, dormitórios e vagas) =====
// Agende uma chamada a cada poucas horas: GET /api/sincronizar?chave=SYNC_KEY
let sincronizando = false;
const CAMPOS_SYNC = ['preco', 'estagio', 'area', 'dormitorios', 'vagas'];
async function buscarOrigem(i) {
  if (/(^|\.)orulo\.com\.br$/i.test(new URL(i.linkOrigem).hostname)) {
    const m = String(i.linkOrigem).match(/buildings\/(\d+)/i);
    if (!m) throw new Error('link da Órulo sem o número do empreendimento');
    return (await orulo.importar(m[1])).dados;
  }
  const r = await axios.get(i.linkOrigem, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36', 'Accept-Language': 'pt-BR,pt;q=0.9' }, timeout: 15000, maxRedirects: 3 });
  return extrairAoCubo(String(r.data), i.linkOrigem);
}
async function sincronizarImoveis() {
  const alvos = (await getImoveis()).filter(i => i.linkOrigem && i.sincronizar !== false);
  const rel = { total: alvos.length, atualizados: 0, semMudanca: 0, pausados: 0, erros: [] };
  for (const i of alvos) {
    const agora = new Date().toISOString();
    try {
      const novo = await buscarOrigem(i), set = {};
      CAMPOS_SYNC.forEach(k => { if (novo[k] && novo[k] !== i[k]) set[k] = novo[k]; });
      if (Object.keys(set).length) rel.atualizados++; else rel.semMudanca++;
      // atualizadoEm só muda quando a origem trouxe dado novo; conferir sem mudança grava só a data da conferência
      await updImovel(i.id, Object.keys(set).length ? { ...set, sincronizadoEm: agora, atualizadoEm: agora } : { sincronizadoEm: agora });
    } catch (e) {
      const st = e.response && e.response.status;
      // Só pausa quando a origem respondeu 404 (anúncio retirado). Erro de rede não pausa nada.
      if (st === 404) { if (i.ativo !== false) { await updImovel(i.id, { ativo: false, sincronizadoEm: agora }); rel.pausados++; } }
      else rel.erros.push({ ref: i.ref, erro: st ? `HTTP ${st}` : e.message });
    }
  }
  return rel;
}
const podeSincronizar = (req, res, next) =>
  ((process.env.SYNC_KEY && req.query.chave === process.env.SYNC_KEY) || tokenValido(req.headers['x-token'])) ? next()
  : res.status(401).json({ success: false, error: 'Não autorizado.' });
const rodarSincronizacao = async (req, res) => {
  if (sincronizando) return res.json({ success: false, error: 'A sincronização já está rodando. Aguarde terminar.' });
  sincronizando = true;
  try { res.json({ success: true, ...(await sincronizarImoveis()) }); }
  catch (e) { console.error('Erro na sincronização:', e.message); res.status(500).json({ success: false, error: 'Erro interno na sincronização.' }); }
  finally { sincronizando = false; }
};
app.get('/api/sincronizar', podeSincronizar, rodarSincronizacao);
app.post('/api/sincronizar', podeSincronizar, rodarSincronizacao);

// ===== ACESSOS POR IMÓVEL (alimenta o dashboard do Cpainel) =====
// Conta 1 visita por visitante a cada hora; grava em lote a cada minuto para não sobrecarregar o banco.
const visitasPend = new Map(), visitasVistas = new Map();
app.post('/api/imoveis/:id/visita', (req, res) => {
  const id = String(req.params.id);
  if (!/^\d{1,16}$/.test(id)) return res.json({ success: false });
  const quem = `${req.ip}|${id}`, agora = Date.now();
  if (!(visitasVistas.get(quem) > agora - 3600e3)) { visitasVistas.set(quem, agora); visitasPend.set(id, (visitasPend.get(id) || 0) + 1); }
  res.json({ success: true });
});
async function gravarVisitas() {
  const agora = Date.now();
  for (const [k, t] of visitasVistas) if (t < agora - 3600e3) visitasVistas.delete(k);
  if (!visitasPend.size) return;
  const lote = [...visitasPend]; visitasPend.clear();
  try {
    if (db) await db.collection('imoveis').bulkWrite(lote.map(([id, n]) => ({ updateOne: { filter: { id: Number(id) }, update: { $inc: { acessos: n } } } })));
    else { const l = lerJson(DATA_FILE, []); lote.forEach(([id, n]) => { const x = l.find(i => String(i.id) === id); if (x) x.acessos = (x.acessos || 0) + n; }); gravarJson(DATA_FILE, l); }
  } catch (e) { console.error('Erro gravando acessos:', e.message); lote.forEach(([id, n]) => visitasPend.set(id, (visitasPend.get(id) || 0) + n)); }
}
setInterval(gravarVisitas, 60e3).unref();
process.on('SIGTERM', () => gravarVisitas().finally(() => process.exit(0)));

const PORT = process.env.PORT || 10000;
iniciarBanco().then(() => app.listen(PORT, () => console.log(`🚀 Portal Joildo Brokers ativo na porta ${PORT} (banco: ${bancoStatus})`)));
