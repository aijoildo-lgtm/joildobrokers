const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

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
  email: 'joildo.contato@gmail.com', creci: 'CRECI 200298', parceiros: []
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
const TXT = ['ref','titulo','preco','foto','localizacao','estagio','destaque','area','dormitorios','vagas','youtube','tour360','transacao','categoria','tipo','apresentacao','diferencial','proximidade'];
const s2 = (v, n) => String(v == null ? '' : v).slice(0, n);
function limpar(b) {
  const o = {};
  TXT.forEach(k => { if (b[k] != null) o[k] = s2(b[k], k === 'apresentacao' ? 4000 : 500); });
  ['fotos', 'plantas'].forEach(k => { o[k] = (Array.isArray(b[k]) ? b[k] : []).map(u => s2(u, 500)).filter(u => /^https?:\/\//i.test(u)).slice(0, 100); });
  o.lazer = (Array.isArray(b.lazer) ? b.lazer : []).map(x => s2(x, 80)).filter(Boolean).slice(0, 60);
  o.tipologias = (Array.isArray(b.tipologias) ? b.tipologias : []).slice(0, 40).map(t => ({ nome: s2(t.nome, 80), area: s2(t.area, 40), dorm: s2(t.dorm, 20), suites: s2(t.suites, 20), vagas: s2(t.vagas, 20), preco: s2(t.preco, 40) })).filter(t => t.nome);
  o.infoTecnica = (Array.isArray(b.infoTecnica) ? b.infoTecnica : []).slice(0, 40).map(x => ({ k: s2(x.k, 80), v: s2(x.v, 200) })).filter(x => x.k);
  o.emDestaque = b.emDestaque === true;
  o.ativo = b.ativo !== false;
  if (b.demo === true) o.demo = true;
  return o;
}
const novaRef = () => `REF-${Math.floor(100000 + Math.random() * 900000)}`;

// APIs
app.get('/api/versao', (req, res) => res.json({ versao: '2026-11-14-j', banco: bancoStatus }));
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
app.delete('/api/imoveis/:id', exigirLogin, ah(async (req, res) => res.json({ success: await delImovel(req.params.id) })));
app.post('/api/duplicar-imovel/:id', exigirLogin, ah(async (req, res) => {
  const o = (await getImoveis()).find(i => String(i.id) === String(req.params.id));
  if (!o) return res.status(404).json({ success: false, error: 'Imóvel não encontrado.' });
  const agora = new Date().toISOString(), c = { ...o };
  delete c._id; delete c.demo;
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
app.post('/api/minerar-orulo', exigirLogin, async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/orulo\.com\.br/i.test(url)) return res.status(400).json({ success: false, error: 'URL inválida do Órulo.' });
  const cookie = lerJson(SESSION_FILE, {}).cookie || '';
  try {
    const r = await axios.get(url, {
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 10000, maxRedirects: 5
    });
    const $ = cheerio.load(r.data);
    const og = (p) => $(`meta[property="${p}"]`).attr('content') || '';
    let titulo = (og('og:title') || $('h1').first().text()).replace(/\|?\s*-?\s*Órulo/i, '').trim();
    const urlFinal = (r.request && r.request.res && r.request.res.responseUrl) || url;
    const temSenha = $('input[type=password]').length > 0;
    const pareceLogin = temSenha || /login|sign_in|entrar|session/i.test(urlFinal) || /^\s*(login|entrar)/i.test($('title').text());
    const diag = `HTTP ${r.status} | url final: ${urlFinal} | titulo: ${$('title').text().trim().slice(0, 80)} | campo senha: ${temSenha ? 'sim' : 'nao'} | cookie enviado: ${cookie ? cookie.length + ' caracteres' : 'nao'} | inicio da pagina: ${$('body').text().replace(/\s+/g, ' ').trim().slice(0, 200)}`;
    console.log('ORULO DIAG:', diag);
    const fotos = [og('og:image')].filter(Boolean);
    $('img').each((i, el) => {
      const s = $(el).attr('src') || $(el).attr('data-src');
      if (s && s.startsWith('http') && !/logo|icon|avatar/i.test(s) && !fotos.includes(s)) fotos.push(s);
    });
    const dados = pareceLogin ? {} : { ...extrairDoTexto($('body').text()), titulo, foto: fotos[0] || '' };
    if (pareceLogin) {
      return res.json({ success: false, precisaTexto: true,
        diag,
        error: 'O Órulo exige login e não libera a leitura automática. Abra o imóvel no Órulo logado, aperte Ctrl+A e Ctrl+C, e cole o texto no campo abaixo.' });
    }
    const faltando = ['titulo', 'preco', 'area', 'dormitorios', 'foto'].filter(k => !dados[k]);
    res.json({ success: true, dados, faltando, precisaTexto: faltando.length > 1 });
  } catch (e) {
    res.json({ success: false, precisaTexto: true, error: `Não consegui abrir o link (${e.response ? 'HTTP ' + e.response.status : e.code || e.message}). Cole o texto da página no campo abaixo.` });
  }
});

const PORT = process.env.PORT || 10000;
iniciarBanco().then(() => app.listen(PORT, () => console.log(`🚀 Portal Joildo Brokers ativo na porta ${PORT} (banco: ${bancoStatus})`)));
