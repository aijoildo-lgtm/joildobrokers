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
const ADMIN_USER = process.env.ADMIN_USER || 'adm';
const ADMIN_PASS = process.env.ADMIN_PASS || '1234';
if (!process.env.ADMIN_PASS) console.warn('⚠️  Defina ADMIN_USER e ADMIN_PASS nas variáveis de ambiente.');

const DEFAULT_CONFIG = {
  logoUrl: '', slogan: 'Ética e dedicação para tornar seus sonhos realidade',
  linkedin: 'https://www.linkedin.com/in/joildo-costa-0154a29b/',
  instagram: '', facebook: '', youtube: '',
  whatsapp: '5511951377033', telefone: '(11) 95137-7033',
  email: 'joildo.contato@gmail.com', creci: 'CRECI 200298'
};

const lerJson = (file, fallback) => {
  try {
    if (!fs.existsSync(file)) { fs.writeFileSync(file, JSON.stringify(fallback, null, 2)); return fallback; }
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { console.error('Erro lendo', file, e.message); return fallback; }
};
const gravarJson = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2));

// AUTENTICAÇÃO (token em memória)
const tokens = new Set();
const exigirLogin = (req, res, next) =>
  tokens.has(req.headers['x-token']) ? next() : res.status(401).json({ success: false, error: 'Não autorizado.' });

app.post('/api/login', (req, res) => {
  const { user, pass } = req.body || {};
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    const t = crypto.randomBytes(24).toString('hex');
    tokens.add(t);
    return res.json({ success: true, token: t });
  }
  res.status(401).json({ success: false, error: 'Acesso negado.' });
});

// PÁGINAS (só arquivos públicos, config.json e server.js NÃO ficam expostos)
const enviar = (f) => (req, res) => res.sendFile(path.join(__dirname, f));
app.get('/', enviar('index.html'));
app.get(['/admin', '/admin.html'], enviar('admin.html'));
app.get('/style.css', enviar('style.css'));

// APIs
app.get('/api/imoveis', (req, res) => res.json(lerJson(DATA_FILE, [])));
app.get('/api/config', (req, res) => res.json({ ...DEFAULT_CONFIG, ...lerJson(CONFIG_FILE, DEFAULT_CONFIG) }));
app.post('/api/config', exigirLogin, (req, res) => {
  gravarJson(CONFIG_FILE, req.body);
  res.json({ success: true, message: 'Configurações atualizadas!' });
});

app.post('/api/adicionar-imovel', exigirLogin, (req, res) => {
  const imovel = req.body;
  const imoveis = lerJson(DATA_FILE, []);
  imovel.id = imovel.id || Date.now();
  imovel.ref = imovel.ref || `REF-${Math.floor(100000 + Math.random() * 900000)}`;
  imoveis.unshift(imovel);
  gravarJson(DATA_FILE, imoveis);
  res.json({ success: true, ref: imovel.ref });
});

// EXTRAÇÃO POR TEXTO COLADO (funciona sempre, sem depender do login do Órulo)
function extrairDoTexto(texto) {
  const t = String(texto || '');
  const pega = (re) => { const m = t.match(re); return m ? m[1] : ''; };
  const precos = [...t.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/g)]
    .map(m => ({ s: m[1], n: parseFloat(m[1].replace(/\./g, '').replace(',', '.')) }))
    .filter(p => p.n >= 50000).sort((a, b) => a.n - b.n);
  const area = pega(/(\d{2,4}(?:[.,]\d+)?)\s*m²/i);
  const dorm = pega(/(\d+)\s*(?:dormit[óo]rios?|quartos?|dorms?)/i);
  const suites = pega(/(\d+)\s*su[ií]tes?/i);
  const vagas = pega(/(\d+)\s*vagas?/i);
  return {
    titulo: (t.split('\n').map(l => l.trim()).find(l => l.length > 3 && l.length < 80) || ''),
    preco: precos.length ? `R$ ${precos[0].s}` : '',
    area: area ? `${area}m²` : '',
    dormitorios: dorm ? `${dorm} Dormitório${dorm > 1 ? 's' : ''}${suites ? ` (${suites} suíte${suites > 1 ? 's' : ''})` : ''}` : '',
    vagas: vagas ? `${vagas} vaga${vagas > 1 ? 's' : ''}` : ''
  };
}
app.post('/api/extrair-texto', exigirLogin, (req, res) => res.json({ success: true, dados: extrairDoTexto(req.body.texto) }));

// MINERAÇÃO DO ÓRULO (dados reais ou nenhum, nunca valores inventados)
app.post('/api/minerar-orulo', exigirLogin, async (req, res) => {
  const { url } = req.body || {};
  if (!url || !/orulo\.com\.br/i.test(url)) return res.status(400).json({ success: false, error: 'URL inválida do Órulo.' });
  try {
    const r = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeout: 10000, maxRedirects: 5
    });
    const $ = cheerio.load(r.data);
    const og = (p) => $(`meta[property="${p}"]`).attr('content') || '';
    let titulo = (og('og:title') || $('h1').first().text()).replace(/\|?\s*-?\s*Órulo/i, '').trim();
    const pareceLogin = /login|entrar|acesse sua conta/i.test(titulo + $('title').text()) || $('input[type=password]').length > 0;
    const fotos = [og('og:image')].filter(Boolean);
    $('img').each((i, el) => {
      const s = $(el).attr('src') || $(el).attr('data-src');
      if (s && s.startsWith('http') && !/logo|icon|avatar/i.test(s) && !fotos.includes(s)) fotos.push(s);
    });
    const dados = pareceLogin ? {} : { ...extrairDoTexto($('body').text()), titulo, foto: fotos[0] || '' };
    if (pareceLogin) {
      return res.json({ success: false, precisaTexto: true,
        error: 'O Órulo exige login para mostrar este imóvel. Abra o link logado, copie o texto da página e cole no campo abaixo.' });
    }
    const faltando = ['titulo', 'preco', 'area', 'dormitorios', 'foto'].filter(k => !dados[k]);
    res.json({ success: true, dados, faltando, precisaTexto: faltando.length > 1 });
  } catch (e) {
    res.json({ success: false, precisaTexto: true, error: `Não consegui abrir o link (${e.response ? 'HTTP ' + e.response.status : e.code || e.message}). Cole o texto da página no campo abaixo.` });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Portal Joildo Brokers ativo na porta ${PORT}`));
