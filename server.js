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
app.disable('x-powered-by'); // não anuncia que o servidor é Express
// Cabeçalhos de segurança (não alteram nenhuma função do site)
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Cross-Origin-Opener-Policy': 'same-origin'
  });
  next();
});
// CORS: por padrão só o próprio site fala com a API. Para liberar outro endereço, defina CORS_ORIGIN no Render.
if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(',').map(x => x.trim()) }));
app.use(express.json({ limit: '30mb' }));

const DATA_FILE = path.join(__dirname, 'imoveis.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const SESSION_FILE = path.join(__dirname, 'orulo-session.json');
const ADMIN_USER = process.env.ADMIN_USER || 'adm';
const ADMIN_PASS = process.env.ADMIN_PASS || '1234';
if (!process.env.ADMIN_PASS) console.warn('⚠️  Defina ADMIN_USER e ADMIN_PASS nas variáveis de ambiente.');

const DEFAULT_FIN = {
  ativo: true, estagios: ['prontos', 'usados'],
  titulo: 'Simule o financiamento',
  texto: 'Ajuste entrada, prazo e juros e veja a parcela na hora. Um consultor compara as condições dos bancos para você.',
  fonteRotulo: 'Taxa média ao ano por banco', referencia: 'SFH · out/2026', fonte: 'Fonte: Banco Central',
  bancos: [
    { nome: 'Banco do Brasil', taxa: '10,56', logo: '' }, { nome: 'Bradesco', taxa: '11,78', logo: '' },
    { nome: 'Itaú', taxa: '11,86', logo: '' }, { nome: 'Santander', taxa: '11,86', logo: '' }
  ],
  entradaPadrao: 40, entradaMin: 20, entradaMax: 80, prazoPadrao: 35, prazoMin: 5, prazoMax: 35, jurosMin: 6, jurosMax: 16,
  itbi: 3, escritura: 1.28, registro: 0.771, comprometimento: 30,
  notaFgts: 'Pode usar o FGTS na entrada. Tabela SAC: a parcela começa maior e diminui todo mês.',
  aviso: 'Valores estimados, sujeitos à análise de crédito e às condições de cada banco.',
  botao: 'Fale com um consultor'
};

const DEFAULT_RAIOX = {
  ativo: true, estagios: ['lancamentos', 'construcao', 'prontos', 'usados'],
  titulo: 'Raio-X do preço', metodo: 'media', comparar: 'bairro', mesmoTipo: false, minimo: 3, tolerancia: 3,
  referencias: '', rotuloM2: 'm² deste imóvel', rotuloFaixa: 'Faixa típica dos semelhantes',
  rodape: 'Comparação feita com os imóveis anunciados em nosso site. O valor por m² é calculado pelo preço e pela área informados em cada anúncio.'
};

const DEFAULT_CONFIG = {
  raiox: DEFAULT_RAIOX,
  financiamento: DEFAULT_FIN,
  logoUrl: '', autorizacaoModelo: '', slogan: 'Ética e dedicação para tornar seus sonhos realidade',
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

// Freio contra tentativa de senha em massa: 8 erros por IP a cada 15 minutos
const tentativas = new Map();
const igual = (a, b) => { const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(x, y); };
setInterval(() => { const agora = Date.now(); for (const [ip, t] of tentativas) if (t.ate < agora) tentativas.delete(ip); }, 600e3).unref();
app.post('/api/login', (req, res) => {
  const { user, pass } = req.body || {};
  const reg = tentativas.get(req.ip), agora = Date.now();
  if (reg && reg.ate > agora && reg.n >= 8) return res.status(429).json({ success: false, error: 'Muitas tentativas. Aguarde alguns minutos.' });
  if (igual(user, ADMIN_USER) && igual(pass, ADMIN_PASS)) {
    tentativas.delete(req.ip);
    const exp = Date.now() + 7 * 24 * 3600 * 1000;
    return res.json({ success: true, token: `${exp}.${assinar(exp)}` });
  }
  const t = reg && reg.ate > agora ? reg : { n: 0, ate: agora + 15 * 60e3 };
  t.n++; tentativas.set(req.ip, t);
  res.status(401).json({ success: false, error: 'Acesso negado.' });
});

// PÁGINAS (só arquivos públicos, config.json e server.js NÃO ficam expostos)
const enviar = (f) => (req, res) => res.sendFile(path.join(__dirname, f));
app.get('/', enviar('index.html'));
// o painel antigo (admin) foi substituído pelo Cpainel; o arquivo antigo continua em /admin-antigo
// O painel nunca é indexado. Com ADMIN_PATH definido no Render (ex.: ADMIN_PATH=entrada-x7k2q9), ele só abre nesse
// endereço e /cpainel e /admin passam a responder "não encontrado". Sem a variável, continua em /cpainel como antes.
const painel = (req, res) => { res.set({ 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Cache-Control': 'no-store' }); res.sendFile(path.join(__dirname, 'cpainel.html')); };
const ADMIN_PATH = String(process.env.ADMIN_PATH || '').replace(/[^a-zA-Z0-9_-]/g, '');
if (ADMIN_PATH) app.get('/' + ADMIN_PATH, painel);
else app.get(['/cpainel', '/cpainel.html', '/admin', '/admin.html'], (req, res, next) => req.path.startsWith('/admin') ? res.redirect('/cpainel') : painel(req, res, next));
app.get('/style.css', enviar('style.css'));
app.get('/taxonomia.js', enviar('taxonomia.js'));
// LOGOS E ÍCONE DO SITE (lista fixa de arquivos públicos)
['logo-joildo.svg', 'logo-joildo.png', 'logo-joildo-header.svg', 'logo-joildo-footer.svg', 'favicon.svg'].forEach(f => app.get('/' + f, (req, res) => { res.set('Cache-Control', 'public, max-age=86400'); res.sendFile(path.join(__dirname, f)); }));
app.get('/favicon.ico', (req, res) => res.redirect(301, '/favicon.svg'));

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
const TXT = ['ref','titulo','preco','foto','localizacao','estagio','destaque','area','dormitorios','vagas','youtube','tour360','transacao','categoria','tipo','apresentacao','diferencial','proximidade','origem','linkOrigem','videoArquivo','sincronizadoEm','construtora','precoM2','seoTitulo','seoDescricao','seoPalavras','cep','logradouro','numero','complemento','visibilidade','iptu','condominio','taxas','obsValores','areaTotal','areaPrivativa','areaConstruida','perfil','mobilia','banheiros','suites','salas','lavabos','modoCadastro'];
const s2 = (v, n) => String(v == null ? '' : v).slice(0, n);
// Tarjas do imóvel: só as da lista oficial, até 3 por imóvel
const TARJAS_VALIDAS = new Set(["breve", "lancamento", "obras", "pronto", "mudeja", "ultimas", "visitedecorado", "ultimosdecorado", "oportunidade", "exclusivo", "condespeciais", "desc10", "desc15", "desc20", "desc25", "docgratis", "ato1000", "entradafacil", "fgts", "financia100", "finandireto", "semanalise", "permuta", "carroentrada", "metro", "shortstay", "temporada", "his1", "his2", "hmp", "r2v", "nr"]);
function limpar(b) {
  const o = {};
  TXT.forEach(k => { if (b[k] != null) o[k] = s2(b[k], k === 'apresentacao' ? 4000 : 500); });
  o.fotos = (Array.isArray(b.fotos) ? b.fotos : []).map(u => s2(u, 500)).filter(u => /^https?:\/\//i.test(u)).slice(0, 100);
  // plantas: texto (link) ou objeto { nome, url }
  o.plantas = (Array.isArray(b.plantas) ? b.plantas : []).map(p => (p && typeof p === 'object') ? { nome: s2(p.nome, 120), area: s2(p.area, 40), url: s2(p.url, 500) } : s2(p, 500))
    .filter(p => /^https?:\/\//i.test(typeof p === 'string' ? p : p.url)).slice(0, 100);
  o.lazer = (Array.isArray(b.lazer) ? b.lazer : []).map(x => s2(x, 80)).filter(Boolean).slice(0, 60);
  o.proximidades = (Array.isArray(b.proximidades) ? b.proximidades : []).map(x => s2(x, 80)).filter(Boolean).slice(0, 60);
  const pv = b.privado && typeof b.privado === 'object' ? b.privado : {};
  o.privado = {}; ['proprietario','corretor','exclusividade','autorizacao','averbado','escriturado','placa','chave','ondeChave','obs'].forEach(k => { o.privado[k] = s2(pv[k], k === 'obs' ? 2000 : 200); });
  o.espelharMidia = b.espelharMidia !== false;
  o.caracteristicasUnidade = (Array.isArray(b.caracteristicasUnidade) ? b.caracteristicasUnidade : []).map(x => s2(x, 80)).filter(Boolean).slice(0, 60);
  o.tipologias = (Array.isArray(b.tipologias) ? b.tipologias : []).slice(0, 40).map(t => ({ nome: s2(t.nome, 80), area: s2(t.area, 40), dorm: s2(t.dorm, 20), suites: s2(t.suites, 20), vagas: s2(t.vagas, 20), preco: s2(t.preco, 40) })).filter(t => t.nome);
  o.infoTecnica = (Array.isArray(b.infoTecnica) ? b.infoTecnica : []).slice(0, 40).map(x => ({ k: s2(x.k, 80), v: s2(x.v, 200) })).filter(x => x.k);
  o.emDestaque = b.emDestaque === true;
  o.sincronizar = b.sincronizar !== false;
  const coord = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) && Math.abs(n) <= 180 ? n : null; };
  o.lat = coord(b.lat); o.lng = coord(b.lng);
  o.ativo = b.ativo !== false;
  if (b.demo === true) o.demo = true;
  o.destaques = (Array.isArray(b.destaques) ? b.destaques : []).map(x => s2(x, 40)).filter(x => TARJAS_VALIDAS.has(x)).filter((x, n, a) => a.indexOf(x) === n).slice(0, 3);
  o.destaque = o.destaques[0] || 'none';
  return o;
}
const novaRef = () => `REF-${Math.floor(100000 + Math.random() * 900000)}`;

const escA = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const precoNumSrv = (v) => { const m = String(v || '').match(/(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?/); return m ? parseInt(m[1].replace(/\./g, ''), 10) : 0; };
app.get('/cadastre', enviar('index.html'));
app.get('/imovel/:ref/:slug?', ah(async (req, res) => {
  // imóveis pausados (ainda não publicados) também podem ser abertos por este link direto, para
  // quem está editando revisar como vai ficar; eles não entram no sitemap nem são indexados (noindex).
  const i = (await getImoveis()).find(x => String(x.ref).toLowerCase() === String(req.params.ref).toLowerCase());
  let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  if (i) {
    const base = `${req.protocol}://${req.get('host')}`, url = `${base}/imovel/${i.ref}/${slug(i.titulo)}`;
    const titulo = i.seoTitulo || `${i.titulo} | ${i.tipo || 'Imóvel'} à venda em ${i.localizacao}`;
    const desc = i.seoDescricao || [i.titulo, i.localizacao, i.area, i.dormitorios, i.vagas, i.preco && `a partir de ${i.preco}`].filter(Boolean).join(' · ');
    const img = i.foto || (i.fotos || [])[0] || '';
    const semIndexar = i.ativo === false ? '<meta name="robots" content="noindex,nofollow">' : '';
    const preco = precoNumSrv(i.preco);
    // Dados estruturados (schema.org): é o que permite ao Google entender preço, local e fotos
    // automaticamente, sem adivinhar a partir do texto solto da página.
    const jsonLd = {
      '@context': 'https://schema.org', '@type': 'RealEstateListing', name: i.titulo,
      description: desc, url,
      image: [i.foto, ...(i.fotos || [])].filter(Boolean).slice(0, 10),
      address: { '@type': 'PostalAddress', addressLocality: i.localizacao, addressCountry: 'BR' },
      ...(preco ? { offers: { '@type': 'Offer', price: preco, priceCurrency: 'BRL', availability: i.ativo === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' } } : {})
    };
    html = html.replace('<link rel="canonical" href="/">', '')
      .replace(/<title>[\s\S]*?<\/title>/, `<title>${escA(titulo)}</title>`)
      .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escA(desc)}">`)
      .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${escA(titulo)}"><meta property="og:description" content="${escA(desc)}"><meta property="og:url" content="${escA(url)}">${img ? `<meta property="og:image" content="${escA(img)}">` : ''}<link rel="canonical" href="${escA(url)}">${i.seoPalavras ? `<meta name="keywords" content="${escA(i.seoPalavras)}">` : ''}${semIndexar}<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`);
  }
  res.type('html').send(html);
}));
app.get('/robots.txt', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('text').send(`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${base}/sitemap.xml`);
});
app.get('/sitemap.xml', ah(async (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const urls = (await getImoveis()).filter(i => i.ativo !== false && i.demo !== true).map(i => `<url><loc>${escA(base + '/imovel/' + i.ref + '/' + slug(i.titulo))}</loc><lastmod>${String(i.atualizadoEm || i.criadoEm || '').slice(0, 10)}</lastmod></url>`);
  res.type('xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${base}/</loc></url>${urls.join('')}</urlset>`);
}));
// APIs
app.get('/api/versao', (req, res) => res.json({ ok: true }));
const publico = (i) => { const { privado, linkOrigem, origem, sincronizar, espelharMidia, historico, sincronizadoEm, ...r } = i; return r; };
app.get('/api/imoveis', ah(async (req, res) => res.json((await getImoveis()).filter(i => i.ativo !== false).map(publico))));
app.get('/api/admin/imoveis', exigirLogin, ah(async (req, res) => res.json(await getImoveis())));
app.get('/api/config', ah(async (req, res) => res.json(await getConfig())));
app.post('/api/config', exigirLogin, ah(async (req, res) => { await saveConfig(req.body); res.json({ success: true, message: 'Configurações atualizadas!' }); }));

// CADASTRE SEU IMÓVEL (público): fica pendente. Só é publicado depois da autorização assinada e da revisão no painel.
app.post('/api/cadastro-cliente', ah(async (req, res) => {
  const b = req.body || {};
  const nome = s2(b.nome, 120).trim(), tel = s2(b.telefone, 40).trim(), email = s2(b.email, 120).trim();
  const titulo = s2(b.titulo, 200).trim(), bairro = s2(b.bairro, 120).trim(), preco = s2(b.preco, 60).trim();
  if (!nome || !tel || !titulo || !bairro || !preco) return res.status(400).json({ success: false, error: 'Preencha nome, WhatsApp, nome do imóvel, bairro e valor.' });
  const cidade = s2(b.cidade, 80).trim() || 'São Paulo';
  const links = s2(b.fotos, 3000).split(/\s+/).filter(u => /^https?:\/\//i.test(u)).slice(0, 30);
  const video = s2(b.video, 500).trim();
  const i = limpar({
    titulo, localizacao: `${bairro}, ${cidade} - SP`, preco, tipo: s2(b.tipo, 60), area: s2(b.area, 40),
    dormitorios: s2(b.dormitorios, 40), vagas: s2(b.vagas, 40), apresentacao: s2(b.descricao, 4000), fotos: links
  });
  if (/youtu/i.test(video)) i.youtube = video.slice(0, 500); else if (video) i.tour360 = video.slice(0, 500);
  const agora = new Date().toISOString();
  i.id = Date.now(); i.ref = novaRef(); i.estagio = 'usados'; i.transacao = 'Vender Imóvel'; i.categoria = 'Residencial';
  i.origem = 'cliente'; i.pendente = true; i.autorizacaoRecebida = false; i.ativo = false; i.criadoEm = agora; i.atualizadoEm = agora;
  i.privado = { proprietario: nome, corretor: '', exclusividade: 'Não', autorizacao: 'Não', averbado: '', escriturado: '', placa: '', chave: '', ondeChave: '',
    obs: `WhatsApp: ${tel}${email ? ` · E-mail: ${email}` : ''}${b.fotos ? `\nFotos informadas: ${s2(b.fotos, 500)}` : ''}` };
  await addImovel(i);
  res.json({ success: true, ref: i.ref });
}));
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
  if ('colecaoExclusiva' in b) set.colecaoExclusiva = b.colecaoExclusiva === true;
  if ('oportunidadeVenda' in b) set.oportunidadeVenda = b.oportunidadeVenda === true;
  if ('mcmvVitrine' in b) set.mcmvVitrine = b.mcmvVitrine === true;
  if ('autorizacaoRecebida' in b) set.autorizacaoRecebida = b.autorizacaoRecebida === true;
  if (b.ativo === true) {
    const atual = (await getImoveis()).find(x => String(x.id) === String(req.params.id));
    if (atual && atual.origem === 'cliente') {
      const midia = (atual.fotos || []).length || atual.youtube || atual.tour360;
      if (atual.autorizacaoRecebida !== true || !midia)
        return res.status(400).json({ success: false, error: 'Para publicar: confirme a autorização assinada recebida e tenha ao menos fotos, vídeo ou tour.' });
    }
    set.pendente = false;
  }
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
// Seção 5 do texto colado: tipologias, lazer, informações técnicas e localização em destaque (leitura direta)
function extrairSecao5(t) {
  const L = String(t || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const tipologias = [];
  L.forEach(l => {
    if (!/R\$\s*[\d.]+/.test(l) || !/m²/i.test(l)) return;
    if (l.includes('|')) { const p = l.split('|').map(x => x.trim()); if (p.length >= 6 && p[0]) tipologias.push({ nome: p[0], area: p[1], dorm: p[2], suites: p[3], vagas: p[4], preco: p[5] }); return; }
    const iM2 = l.search(/m²/i) + 2, iR = l.search(/R\$/);
    const nome = l.slice(0, Math.max(0, l.search(/\d/))).replace(/[:\-–\s]+$/, '').trim();
    const area = (l.slice(0, iM2).match(/(\d{1,4}(?:[.,]\d+)?)\s*m²/i) || [])[1];
    const nums = (l.slice(iM2, iR).match(/\d+/g) || []);
    const preco = (l.slice(iR).match(/R\$\s*[\d.]+(?:,\d{2})?/) || [''])[0];
    if (nome && area && iR > iM2) tipologias.push({ nome, area: area + ' m²', dorm: nums[0] || '', suites: nums[1] || '', vagas: nums[2] || '', preco });
  });
  let lazer = [];
  const iL = L.findIndex(l => /^(caracter[ií]sticas condominiais|[áa]reas? de (conv[ií]vio e )?lazer|lazer e comodidades)/i.test(l));
  if (iL >= 0) {
    for (let i = iL + 1; i < L.length && lazer.length < 60; i++) {
      const l = L[i];
      if (/^(caracter[ií]sticas da unidade|tipologias|endere[çc]o|localiza|sobre|informa[çc][õo]es|conhe[çc]a|como [ée] morar|alguma informa)/i.test(l)) break;
      if (l.length < 60 && !/\d|R\$|nenhum/i.test(l)) lazer.push(l);
    }
  }
  const infoTecnica = [];
  [['Previsão de entrega', /previs[ãa]o de entrega\s*[:\-]?\s*(\d{1,2}\/\d{4}|\d{4}|[^\n]{1,30})/i], ['Número de torres', /n[úu]mero de torres\s*[:\-]?\s*(\d+)/i], ['Total de unidades', /total de unidades\s*[:\-]?\s*(\d+)/i], ['Estoque', /estoque\s*[:\-]?\s*(\d+)/i]]
    .forEach(([k, re]) => { const m = String(t || '').match(re); if (m) infoTecnica.push({ k, v: m[1].trim() }); });
  const prox = ((String(t || '').match(/\d+\s*min\.?\s*(?:a p[ée] |de |do |da )?[^\n.]{0,50}?(?:metr[ôo]|esta[çc][ãa]o|parque|shopping)[^\n.]{0,30}/i)) || [''])[0].trim();
  return { tipologias, lazer, infoTecnica, proximidade: prox };
}
async function extrairComIA(texto) {
  if (!iaProvedor()) return {};
  try {
    const txt = (await chamarIA(
      'Você extrai dados de imóveis a partir de texto colado de uma página. Responda APENAS um JSON válido, sem crases e sem comentários. Não invente nada: use "" ou [] quando o texto não trouxer a informação.',
      `Retorne um JSON com as chaves: titulo, preco, localizacao, area, dormitorios, vagas, diferencial, proximidade, apresentacao (2 frases), lazer (array de strings), tipologias (array de objetos com nome, area, dorm, suites, vagas, preco), infoTecnica (array de objetos com k e v). Preços no formato "R$ 284.176". Texto:\n${texto}`,
      1800)).replace(/```json|```/g, '');
    return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  } catch (e) { console.error('Extração por IA falhou:', e.message); return {}; }
}
function mesclarExtracao(base, s5, ia) {
  const v = (a, b) => (a && String(a).trim()) ? String(a) : String(b || '');
  const arr = (a, b) => (Array.isArray(a) && a.length) ? a : (Array.isArray(b) ? b : []);
  const tipologias = arr(s5.tipologias, ia.tipologias).map(t => ({ nome: s2(t.nome, 80), area: s2(t.area, 40), dorm: s2(t.dorm, 10), suites: s2(t.suites, 10), vagas: s2(t.vagas, 10), preco: s2(t.preco, 40) })).filter(t => t.nome).slice(0, 40);
  return {
    titulo: v(base.titulo, ia.titulo), preco: v(base.preco, ia.preco), localizacao: v(base.localizacao, ia.localizacao),
    area: v(base.area, ia.area), dormitorios: v(base.dormitorios, ia.dormitorios), vagas: v(base.vagas, ia.vagas),
    diferencial: v(ia.diferencial, ''), proximidade: v(s5.proximidade, ia.proximidade), apresentacao: v(ia.apresentacao, ''),
    tipologias,
    lazer: arr(s5.lazer, ia.lazer).map(x => s2(x, 80)).filter(Boolean).slice(0, 60),
    infoTecnica: arr(s5.infoTecnica, ia.infoTecnica).map(x => ({ k: s2(x.k, 80), v: s2(x.v, 200) })).filter(x => x.k).slice(0, 40)
  };
}
async function extrairDadosDoTexto(textoBruto) {
  const texto = String(textoBruto || '').slice(0, 30000);
  const base = extrairDoTexto(texto), s5 = extrairSecao5(texto);
  const falta = !s5.tipologias.length || !s5.lazer.length || !s5.infoTecnica.length || !base.titulo || !base.preco;
  const ia = (falta && texto.trim().length > 80) ? await extrairComIA(texto) : {};
  return { dados: mesclarExtracao(base, s5, ia), porIA: Object.keys(ia).length > 0 };
}
app.post('/api/extrair-texto', exigirLogin, ah(async (req, res) => {
  const r = await extrairDadosDoTexto((req.body || {}).texto);
  res.json({ success: true, ...r });
}));

// ROTA ALTERNATIVA: PDF do empreendimento (salvo da página da Órulo ou baixado nela) -> texto -> mesmo extrator do Assistente
app.post('/api/extrair-pdf', exigirLogin, async (req, res) => {
  try {
    const b64 = String((req.body || {}).pdf || '').replace(/^data:application\/pdf;base64,/, '');
    if (!b64) return res.json({ success: false, error: 'Envie o arquivo PDF.' });
    const buf = Buffer.from(b64, 'base64');
    if (buf.slice(0, 5).toString() !== '%PDF-') return res.json({ success: false, error: 'Esse arquivo não é um PDF válido.' });
    const { PDFParse } = require('pdf-parse');
    const leitor = new PDFParse({ data: buf });
    let lido;
    try { lido = await leitor.getText(); } finally { await leitor.destroy().catch(() => {}); }
    const texto = String(lido.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (texto.length < 80) return res.json({ success: false, error: 'O PDF não tem texto legível (parece ser imagem escaneada). Salve a página da Órulo como PDF pelo navegador (Ctrl+P, Salvar como PDF) ou use o texto copiado.' });
    const r = await extrairDadosDoTexto(texto);
    res.json({ success: true, paginas: lido.total, ...r });
  } catch (e) {
    console.error('Erro PDF:', e.message);
    res.json({ success: false, error: 'Não consegui ler esse PDF (' + (e.message || 'erro') + ').' });
  }
});

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
const CAMPOS_IMPORT = [['titulo','título'],['preco','preço'],['localizacao','localização'],['area','área'],['dormitorios','dormitórios'],['vagas','vagas'],['tipo','tipo'],['estagio','estágio'],['construtora','construtora'],['foto','foto de capa'],['apresentacao','apresentação'],['tipologias','tipologias e valores'],['lazer','lazer'],['infoTecnica','informações técnicas']];
const camposFaltando = d => CAMPOS_IMPORT.filter(([k]) => !(Array.isArray(d[k]) ? d[k].length : d[k])).map(([, n]) => n);
async function importarAoCubo(url, res) {
  try {
    const r = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36', 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html' },
      timeout: 15000, maxRedirects: 3
    });
    const dados = extrairAoCubo(String(r.data), url);
    if (!dados.titulo && !dados.preco) return res.json({ success: false, precisaTexto: true, error: 'Abri a página, mas não encontrei os dados do imóvel. Use a aba Assistente IA: cole o texto da página e a IA preenche o cadastro.' });
    const faltando = camposFaltando(dados);
    res.json({ success: true, dados, faltando, precisaTexto: faltando.length > 0, fonte: 'AoCubo' });
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
    return res.json({ success: false, precisaTexto: true, error: 'Falta ligar a API da Órulo: defina ORULO_CLIENT_ID e ORULO_CLIENT_SECRET no Render. Enquanto isso, envie o PDF do empreendimento (botão abaixo) ou cole o texto da página.' });
  try {
    const { dados, diag } = await orulo.importar(m[1]);
    console.log('ORULO API:', diag);
    const faltando = camposFaltando(dados);
    res.json({ success: true, dados, faltando, precisaTexto: faltando.length > 0, fonte: 'Órulo', diag: faltando.length > 1 ? diag : undefined });
  } catch (e) {
    const st = e.response && e.response.status;
    console.error('Erro Órulo API:', st, e.response ? JSON.stringify(e.response.data).slice(0, 300) : e.message);
    const msg = st === 401 || st === 400 ? 'A Órulo recusou as credenciais (confira ORULO_CLIENT_ID e ORULO_CLIENT_SECRET).'
      : st === 403 || st === 404 ? 'Esse empreendimento não está liberado para a sua conta na Órulo.'
      : `Não consegui falar com a API da Órulo (${st ? 'HTTP ' + st : e.code || e.message}).`;
    res.json({ success: false, precisaTexto: true, error: msg + ' Você pode usar a aba Assistente IA com o texto da página.' });
  }
});

// BUSCA NO ÓRULO (filtros) para escolher o empreendimento e importar
app.post('/api/orulo/buscar', exigirLogin, async (req, res) => {
  if (!process.env.ORULO_CLIENT_ID || !process.env.ORULO_CLIENT_SECRET)
    return res.json({ success: false, error: 'Falta ligar a API da Órulo: defina ORULO_CLIENT_ID e ORULO_CLIENT_SECRET no Render.' });
  try {
    const feitos = (await getImoveis()).map(i => (String(i.linkOrigem || '').match(/buildings\/(\d+)/) || [])[1]).filter(Boolean);
    const r = await orulo.listar(req.body || {});
    res.json({ success: true, itens: r.itens.map(x => ({ ...x, jaImportado: feitos.includes(String(x.id)) })), pagina: r.pagina });
  } catch (e) {
    const st = e.response && e.response.status;
    console.error('Erro busca Órulo:', st, e.message);
    res.json({ success: false, error: `Não consegui consultar a Órulo (${st ? 'HTTP ' + st : e.code || e.message}). Use o link do empreendimento.` });
  }
});

// ===== CONTEÚDOS (blog, notícias e depoimentos editáveis pelo painel) =====
const CONTEUDOS_FILE = path.join(__dirname, 'conteudos.json');
const VISITAS_FILE = path.join(__dirname, 'visitas-site.json');
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

// ===== ASSISTENTE DE IA =====
// Funciona com Gemini (GEMINI_API_KEY) ou Claude (ANTHROPIC_API_KEY). Se as duas existirem, usa o Gemini;
// para forçar um, crie IA_PROVEDOR = claude ou gemini. As chaves ficam SÓ nas variáveis de ambiente do Render.
const IA_MODELO = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
const GEMINI_MODELO = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const iaProvedor = () => {
  const p = String(process.env.IA_PROVEDOR || '').toLowerCase();
  if (p === 'claude' && process.env.ANTHROPIC_API_KEY) return 'claude';
  if (p === 'gemini' && process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  return '';
};
async function chamarIA(system, prompt, maxTokens = 1800) {
  const prov = iaProvedor();
  if (!prov) { const e = new Error('IA não configurada'); e.semChave = true; throw e; }
  if (prov === 'gemini') {
    const r = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODELO}:generateContent`, {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens * 3, temperature: 0.7 }
    }, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'content-type': 'application/json' }, timeout: 60000 });
    const partes = (((r.data.candidates || [])[0] || {}).content || {}).parts || [];
    return partes.map(p => p.text || '').join('').trim();
  }
  const r = await axios.post('https://api.anthropic.com/v1/messages',
    { model: IA_MODELO, max_tokens: maxTokens, system, messages: [{ role: 'user', content: prompt }] },
    { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, timeout: 60000 });
  return (r.data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}
const IA_SISTEMA = 'Você é o assistente de conteúdo da Joildo Brokers, consultoria imobiliária de alto padrão em São Paulo (CRECI 200298). Escreva em português do Brasil, tom elegante, claro e confiável, sem exageros. REGRA ABSOLUTA: nunca invente preço, metragem, prazo de entrega, nome de construtora, endereço ou qualquer dado que não esteja no que foi informado. Se faltar informação, escreva sem ela. Responda só com o texto pedido, sem comentários antes ou depois.';

// limite simples de uso por hora (protege seu crédito). Mude com IA_LIMITE_HORA.
const iaUso = { janela: 0, n: 0 };
function iaDentroDoLimite() {
  const h = Math.floor(Date.now() / 3600000);
  if (iaUso.janela !== h) { iaUso.janela = h; iaUso.n = 0; }
  return ++iaUso.n <= (+process.env.IA_LIMITE_HORA || 120);
}
app.get('/api/ia/status', exigirLogin, (req, res) => res.json({ ativa: !!iaProvedor(), provedor: iaProvedor() }));
app.post('/api/ia', exigirLogin, async (req, res) => {
  if (!iaProvedor()) return res.status(503).json({ success: false, error: 'IA não configurada. No Render, adicione GEMINI_API_KEY ou ANTHROPIC_API_KEY em Environment.' });
  if (!iaDentroDoLimite()) return res.status(429).json({ success: false, error: 'Limite de pedidos por hora atingido. Tente mais tarde.' });
  const { tarefa, dados, instrucao } = req.body || {};
  const ctx = String(JSON.stringify(dados || {})).slice(0, 8000);
  const ins = String(instrucao || '').slice(0, 6000);
  const pedidos = {
    apresentacao: `Escreva uma apresentação de 2 a 3 parágrafos curtos para o anúncio deste imóvel, usando SOMENTE estes dados:\n${ctx}\n${ins}`,
    post: `Escreva um texto (300 a 500 palavras, com subtítulos simples) sobre o tema abaixo, útil para quem quer comprar imóvel em São Paulo. Não cite números de mercado que você não possa garantir.\nPedido: ${ins}\nDados de apoio: ${ctx}`,
    revisar: `Revise e melhore o texto abaixo (correção, clareza e tom profissional), mantendo todos os fatos. Devolva só o texto revisado.\n${ins}`,
    titulos: `Sugira 5 títulos curtos e atraentes para este conteúdo, um por linha, sem numeração, sem aspas.\n${ins}\n${ctx}`,
    diferencial: `Escreva UM diferencial curto (até 60 caracteres) que resuma o que há de mais forte neste imóvel, usando SOMENTE os dados abaixo. Só a frase, sem ponto final.\n${ctx}`,
    seo: `Gere o SEO do Google para este imóvel, usando SOMENTE os dados abaixo. Responda APENAS um JSON válido, sem crases, com as chaves: seoTitulo (até 60 caracteres, pois o Google corta títulos maiores), seoDescricao (até 160 caracteres, convidativa, sem inventar nada) e seoPalavras (5 a 8 palavras-chave separadas por vírgula, até 120 caracteres).\n${ctx}`,
    social: `Escreva dois textos para divulgar este imóvel, usando SOMENTE os dados abaixo. Formato exato:\nINSTAGRAM:\n(legenda de 3 a 5 linhas, com 5 hashtags no final)\nWHATSAPP:\n(mensagem curta e cordial de 3 a 4 linhas, convidando para uma visita)\n${ctx}`,
    resposta: `Escreva uma resposta cordial e objetiva, em nome do corretor Joildo, para a mensagem de cliente abaixo. Use SOMENTE os dados do imóvel quando citar algo dele; se a pergunta exigir um dado que não está aí, diga que vai confirmar e retornar. Convide para uma conversa ou visita.\nMENSAGEM DO CLIENTE:\n${ins}\nDADOS DO IMÓVEL:\n${ctx}`,
    extrair: `Extraia do texto abaixo os dados do imóvel e responda APENAS um JSON válido, sem crases, com as chaves: titulo, preco, localizacao, area, dormitorios, vagas, diferencial, proximidade, apresentacao (resumo de 2 frases), lazer (array de strings). Use "" (ou []) para o que não estiver no texto. Não invente nada.\nTEXTO:\n${ins}`,
    livre: ins
  };
  const prompt = pedidos[tarefa];
  if (!prompt || !String(prompt).trim()) return res.status(400).json({ success: false, error: 'Pedido inválido.' });
  try {
    const texto = await chamarIA(IA_SISTEMA, prompt, 1800);
    if (!texto) return res.status(502).json({ success: false, error: 'A IA devolveu uma resposta vazia. Tente de novo.' });
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
  // trim(): um espaço copiado junto com a chave muda a assinatura e a Cloudinary recusa tudo sem dizer o motivo
  const cloud = (process.env.CLOUDINARY_CLOUD_NAME || '').trim(), key = (process.env.CLOUDINARY_API_KEY || '').trim(), secret = (process.env.CLOUDINARY_API_SECRET || '').trim();
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
    // Mostra o motivo real que a Cloudinary devolveu (antes a mensagem era sempre a mesma)
    const status = e.response ? e.response.status : 0;
    const motivo = (e.response && e.response.data && e.response.data.error && e.response.data.error.message) || e.message || 'sem detalhe';
    console.error(`Erro no upload (HTTP ${status}):`, motivo);
    let error;
    if (!e.response) error = 'Não consegui falar com a Cloudinary (sem conexão ou tempo esgotado). Tente de novo.';
    else if (/cloud_name/i.test(motivo)) error = 'Nome da conta Cloudinary incorreto: confira CLOUDINARY_CLOUD_NAME no Render, sem espaços.';
    else if (/signature/i.test(motivo)) error = 'Chave secreta da Cloudinary incorreta: confira CLOUDINARY_API_SECRET no Render, sem espaços.';
    else if (/api[_ ]key/i.test(motivo)) error = 'Chave de API da Cloudinary incorreta: confira CLOUDINARY_API_KEY no Render, sem espaços.';
    else if (/file size|too large|maximum/i.test(motivo)) error = 'Arquivo maior que o limite da conta Cloudinary. Reduza a imagem e tente de novo.';
    else if (/invalid image|unsupported|format/i.test(motivo)) error = 'A Cloudinary não aceitou este formato. Tente JPEG, PNG ou WebP.';
    else error = 'A Cloudinary recusou o arquivo: ' + motivo;
    res.status(502).json({ success: false, error });
  }
});

// ===== SINCRONIZAÇÃO COM AOCUBO E ÓRULO (preço, estágio, área, dormitórios e vagas) =====
// Agende uma chamada a cada poucas horas: GET /api/sincronizar?chave=SYNC_KEY
let sincronizando = false;
const CAMPOS_SYNC = ['preco', 'precoM2', 'estagio', 'area', 'dormitorios', 'vagas'];
const CAMPOS_LISTA = ['tipologias', 'infoTecnica'];       // condições comerciais
const CAMPOS_MIDIA = ['foto', 'fotos', 'plantas', 'lazer']; // espelho de mídia (desliga com espelharMidia=false)
const vazio = (v) => Array.isArray(v) ? !v.length : !v;
function mesclarPlantas(novas, atuais) {
  // mantém nome e metragem digitados à mão quando a planta (mesmo link) continua na origem
  const por = new Map((atuais || []).filter(p => p && typeof p === 'object').map(p => [p.url, p]));
  return (novas || []).map(p => { const o = typeof p === 'string' ? { url: p } : p, a = por.get(o.url); return a ? { ...o, nome: a.nome || o.nome, area: a.area || o.area } : o; });
}
function diferencas(i, novo) {
  const set = {}, campos = [...CAMPOS_SYNC, ...CAMPOS_LISTA, ...(i.espelharMidia === false ? [] : CAMPOS_MIDIA)];
  campos.forEach(k => {
    if (vazio(novo[k])) return;                       // origem sem o dado: nunca apaga o que já existe
    const v = k === 'plantas' ? mesclarPlantas(novo[k], i[k]) : novo[k];
    if (JSON.stringify(v) !== JSON.stringify(i[k] == null ? (Array.isArray(v) ? [] : '') : i[k])) set[k] = v;
  });
  return set;
}
async function buscarOrigem(i) {
  if (/(^|\.)orulo\.com\.br$/i.test(new URL(i.linkOrigem).hostname)) {
    const m = String(i.linkOrigem).match(/buildings\/(\d+)/i);
    if (!m) throw new Error('link da Órulo sem o número do empreendimento');
    return (await orulo.importar(m[1])).dados;
  }
  const r = await axios.get(i.linkOrigem, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36', 'Accept-Language': 'pt-BR,pt;q=0.9' }, timeout: 15000, maxRedirects: 3 });
  return extrairAoCubo(String(r.data), i.linkOrigem);
}
async function sincronizarImoveis(somenteId) {
  const alvos = (await getImoveis()).filter(i => i.linkOrigem && i.sincronizar !== false && (!somenteId || String(i.id) === String(somenteId)));
  const rel = { total: alvos.length, atualizados: 0, semMudanca: 0, pausados: 0, erros: [] };
  for (const i of alvos) {
    const agora = new Date().toISOString();
    try {
      const novo = await buscarOrigem(i), set = diferencas(i, novo), mudou = Object.keys(set);
      if (mudou.length) rel.atualizados++; else rel.semMudanca++;
      // atualizadoEm só muda quando a origem trouxe dado novo; conferir sem mudança grava só a data da conferência
      const historico = [{ em: agora, campos: mudou }, ...(i.historico || [])].slice(0, 20);
      await updImovel(i.id, mudou.length ? { ...set, sincronizadoEm: agora, atualizadoEm: agora, historico } : { sincronizadoEm: agora });
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
  const somenteId = req.params && req.params.id;
  if (sincronizando) return res.json({ success: false, error: 'A sincronização já está rodando. Aguarde terminar.' });
  sincronizando = true;
  try { res.json({ success: true, ...(await sincronizarImoveis(somenteId)) }); }
  catch (e) { console.error('Erro na sincronização:', e.message); res.status(500).json({ success: false, error: 'Erro interno na sincronização.' }); }
  finally { sincronizando = false; }
};
app.get('/api/sincronizar', podeSincronizar, rodarSincronizacao);
app.post('/api/sincronizar', podeSincronizar, rodarSincronizacao);
app.post('/api/sincronizar/:id', exigirLogin, rodarSincronizacao);
// Espelho automático: roda sozinho a cada SYNC_HORAS (padrão 6). No Render gratuito o servidor dorme; agende também um ping em /api/sincronizar?chave=SYNC_KEY.
const SYNC_MS = Math.max(1, Number(process.env.SYNC_HORAS) || 6) * 3600e3;
setInterval(async () => { if (sincronizando) return; sincronizando = true; try { console.log('Sincronização automática:', JSON.stringify(await sincronizarImoveis())); } catch (e) { console.error('Sync automática falhou:', e.message); } finally { sincronizando = false; } }, SYNC_MS).unref();

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

// ===== VISITAS DO SITE (total por dia, para o gráfico do dashboard) =====
// Conta 1 visita por visitante por dia (qualquer página: home, imóvel, blog). Guarda só a contagem
// por dia (ex.: "2026-11-17": 42), nunca dados pessoais do visitante.
const diaHoje = () => new Date().toISOString().slice(0, 10);
const siteVistos = new Map(); // "ip|dia" -> true, limpa sozinho
// Origem da visita (de onde o visitante veio): só uma palavra de uma lista fixa, nunca dados pessoais.
const ORIGENS = ['instagram', 'facebook', 'google', 'whatsapp', 'youtube', 'tiktok', 'direto', 'outros'];
const VISITAS_ORIGEM_FILE = path.join(__dirname, 'visitas-origem.json');
const origemVistos = new Map(); // "ip|dia|origem" -> true
async function contarOrigem(req, dia) {
  let o = String((req.body && req.body.origem) || 'direto').toLowerCase().replace(/[^a-z]/g, '').slice(0, 20);
  if (!ORIGENS.includes(o)) o = 'outros';
  const k = `${req.ip}|${dia}|${o}`;
  if (origemVistos.has(k)) return;
  origemVistos.set(k, true);
  const chave = `${dia}|${o}`;
  try {
    if (db) await db.collection('visitas_origem').updateOne({ _id: chave }, { $inc: { n: 1 } }, { upsert: true });
    else { const m = lerJson(VISITAS_ORIGEM_FILE, {}); m[chave] = (m[chave] || 0) + 1; gravarJson(VISITAS_ORIGEM_FILE, m); }
  } catch (e) { console.error('Erro gravando origem da visita:', e.message); }
}
app.post('/api/visita-site', async (req, res) => {
  const dia = diaHoje(), quem = `${req.ip}|${dia}`;
  res.json({ success: true }); // responde logo; grava em segundo plano
  contarOrigem(req, dia);
  if (siteVistos.has(quem)) return;
  siteVistos.set(quem, true);
  try {
    if (db) await db.collection('visitas_site').updateOne({ _id: dia }, { $inc: { n: 1 } }, { upsert: true });
    else { const m = lerJson(VISITAS_FILE, {}); m[dia] = (m[dia] || 0) + 1; gravarJson(VISITAS_FILE, m); }
  } catch (e) { console.error('Erro gravando visita do site:', e.message); }
});
app.get('/api/stats/visitas-site', exigirLogin, ah(async (req, res) => {
  let mapa = {};
  if (db) { const docs = await db.collection('visitas_site').find({}).toArray(); docs.forEach(d => mapa[d._id] = d.n); }
  else mapa = lerJson(VISITAS_FILE, {});
  res.json(mapa);
}));
app.get('/api/stats/origens', exigirLogin, ah(async (req, res) => {
  let mapa = {};
  if (db) { const docs = await db.collection('visitas_origem').find({}).toArray(); docs.forEach(d => mapa[d._id] = d.n); }
  else mapa = lerJson(VISITAS_ORIGEM_FILE, {});
  res.json(mapa);
}));
setInterval(() => { const hoje = diaHoje(); for (const k of siteVistos.keys()) if (!k.endsWith('|' + hoje)) siteVistos.delete(k); for (const k of origemVistos.keys()) if (!k.includes('|' + hoje + '|')) origemVistos.delete(k); }, 3600e3).unref();
setInterval(gravarVisitas, 60e3).unref();
process.on('SIGTERM', () => gravarVisitas().finally(() => process.exit(0)));

const PORT = process.env.PORT || 10000;
iniciarBanco().then(() => app.listen(PORT, () => console.log(`🚀 Portal Joildo Brokers ativo na porta ${PORT} (banco: ${bancoStatus})`)));
