// Importação pela API oficial da Órulo (OAuth client_credentials). Docs: https://documento.orulo.com.br
const axios = require('axios');
const BASE = process.env.ORULO_BASE || 'https://www.orulo.com.br';
let cache = { token: '', ate: 0 };

async function obterToken(forcar) {
  if (!forcar && cache.token && cache.ate > Date.now()) return cache.token;
  const body = new URLSearchParams({ client_id: process.env.ORULO_CLIENT_ID, client_secret: process.env.ORULO_CLIENT_SECRET, grant_type: 'client_credentials' });
  const r = await axios.post(BASE + '/oauth/token', body.toString(), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
  cache = { token: r.data.access_token, ate: Date.now() + Math.max(60, (r.data.expires_in || 3600) - 60) * 1000 };
  return cache.token;
}
async function chamar(caminho, params) {
  for (let t = 0; t < 2; t++) {
    const tk = await obterToken(t === 1);
    try { return (await axios.get(BASE + '/api/v2' + caminho, { headers: { Authorization: 'Bearer ' + tk }, params, timeout: 20000 })).data; }
    catch (e) { if (!(e.response && e.response.status === 401 && t === 0)) throw e; }
  }
}

// ---- mapeamento tolerante: usa o que existir, nunca inventa ----
const pega = (o, ...chaves) => { for (const k of chaves) { const v = k.split('.').reduce((a, p) => (a == null ? a : a[p]), o); if (v != null && v !== '' && !(Array.isArray(v) && !v.length)) return v; } return ''; };
const texto = (v) => (v && typeof v === 'object' ? (v.name || v.title || v.description || '') : String(v == null ? '' : v)).trim();
const num = (v) => { const n = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')); return isNaN(n) ? null : n; };
const brl = (n) => 'R$ ' + Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const fmtN = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
const lista = (x, ...chaves) => Array.isArray(x) ? x : (chaves.map(k => x && x[k]).find(Array.isArray) || []);
function urlDe(item) {
  if (typeof item === 'string') return /^https?:\/\//i.test(item) ? item : '';
  if (!item || typeof item !== 'object') return '';
  const achadas = [];
  (function varre(o, chave) { if (typeof o === 'string' && /^https?:\/\//i.test(o)) achadas.push([chave, o]); else if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => varre(v, k)); })(item, '');
  const pref = achadas.find(([k]) => /1024|large|big|original|full|url/i.test(k));
  return (pref || achadas[0] || [])[1] || '';
}
const ESTAGIOS = [[/pronto|entregue/i, 'prontos'], [/constru|obra/i, 'construcao'], [/lan[cç]amento|breve|planta/i, 'lancamentos']];

function mapear(b, imgs, plantas) {
  const end = b.address || {};
  const tip = lista(b.typologies || b.types || []);
  const dorms = [num(b.bedrooms), ...tip.map(t => num(t.bedrooms))].filter(n => n != null);
  const areas = [num(b.min_area), num(b.max_area), ...tip.map(t => num(pega(t, 'private_area', 'area', 'min_area')))].filter(n => n != null && n > 0);
  const precos = [num(pega(b, 'min_price', 'price')), ...tip.map(t => num(pega(t, 'min_price', 'price')))].filter(n => n != null && n > 0);
  const vagasN = [num(pega(b, 'parking', 'parking_spaces', 'garage')), ...tip.map(t => num(pega(t, 'parking', 'parking_spaces', 'garage')))].filter(n => n != null && n > 0);
  const faixa = (arr, fmt, un) => { if (!arr.length) return ''; const a = Math.min(...arr), z = Math.max(...arr); return a === z ? fmt(a) + un : `${fmt(a)} a ${fmt(z)}${un}`; };
  const estTxt = texto(pega(b, 'status', 'stage', 'construction_status', 'situation'));
  const estagio = (ESTAGIOS.find(([re]) => re.test(estTxt)) || [])[1] || '';
  const entregaRaw = texto(pega(b, 'delivery_date', 'expected_delivery_date', 'completion_date', 'finish_date'));
  const dt = entregaRaw.match(/^(\d{4})-(\d{2})/);
  const entrega = dt ? `${dt[2]}/${dt[1]}` : entregaRaw;
  const fotos = lista(imgs, 'images', 'items').map(urlDe).filter(Boolean).slice(0, 30);
  const pl = lista(plantas, 'floor_plans', 'items').map(p => ({ nome: texto(pega(p, 'name', 'title', 'description', 'label')), url: urlDe(p) })).filter(p => p.url).slice(0, 20);
  const capa = urlDe(b.default_image) || fotos[0] || '';
  if (capa && !fotos.includes(capa)) fotos.unshift(capa);
  const bairro = texto(pega(end, 'area', 'neighborhood')), cidade = texto(end.city), uf = texto(end.state);
  const tipo = texto(pega(b, 'type', 'building_type', 'property_type'));
  const info = [];
  if (entrega && estagio !== 'prontos') info.push({ k: 'Previsão de entrega', v: entrega });
  const unid = pega(b, 'total_units', 'number_of_units'), torres = pega(b, 'number_of_towers', 'towers');
  if (torres) info.push({ k: 'Número de torres', v: String(torres) });
  if (unid) info.push({ k: 'Total de unidades', v: String(unid) });
  const est = pega(b, 'stock', 'available_units', 'units_available'); if (est) info.push({ k: 'Estoque', v: String(est) });
  const dmin = dorms.length ? Math.min(...dorms) : 0, dmax = dorms.length ? Math.max(...dorms) : 0;
  // valor por m²: usa o campo do Órulo se existir; senão calcula pelo tipo de menor preço (preço ÷ área)
  let pm2 = num(pega(b, 'min_price_per_square_meter', 'price_per_square_meter', 'price_per_m2', 'square_meter_price'));
  if (!pm2) { const c = tip.map(t => ({ p: num(pega(t, 'min_price', 'price')), a: num(pega(t, 'private_area', 'area', 'min_area')) })).filter(x => x.p > 0 && x.a > 0).sort((x, y) => x.p - y.p)[0]; if (c) pm2 = c.p / c.a; }
  const dados = {
    titulo: texto(b.name),
    preco: precos.length ? brl(Math.min(...precos)) : '',
    precoM2: pm2 ? brl(pm2) : '',
    area: faixa(areas, fmtN, 'm²'),
    dormitorios: dorms.length ? (dmin === dmax ? `${dmin} Dormitório${dmin > 1 ? 's' : ''}` : `${dmin} a ${dmax} Dormitórios`) : '',
    vagas: vagasN.length ? faixa(vagasN, String, '').replace(/^(\S+)$/, (m) => `${m} vaga${m === '1' ? '' : 's'}`) : '',
    localizacao: [bairro, [cidade, uf].filter(Boolean).join(' - ')].filter(Boolean).join(', '),
    estagio, tipo, categoria: /comercial/i.test(texto(b.finality)) ? 'Comercial' : 'Residencial',
    foto: capa, fotos, plantas: pl, construtora: texto(pega(b, 'developer', 'company', 'builder', 'developer_name', 'company_name')),
    lazer: lista(b.features).map(texto).filter(Boolean).slice(0, 60),
    infoTecnica: info,
    apresentacao: texto(pega(b, 'description', 'presentation')).slice(0, 3000),
    tipologias: tip.map(t => ({ nome: texto(pega(t, 'name', 'title')), area: pega(t, 'private_area', 'area', 'min_area') ? fmtN(num(pega(t, 'private_area', 'area', 'min_area'))) + ' m²' : '', dorm: String(pega(t, 'bedrooms')), suites: String(pega(t, 'suites')), vagas: String(pega(t, 'parking', 'parking_spaces')), preco: num(pega(t, 'min_price', 'price')) ? brl(num(pega(t, 'min_price', 'price'))) : '' })).filter(t => t.nome).slice(0, 40)
  };
  const diag = `campos do empreendimento: ${Object.keys(b).join(', ')} | imagens: ${fotos.length} | plantas: ${pl.length}`;
  return { dados, diag };
}

async function importar(id) {
  const b = await chamar('/buildings/' + id);
  const [imgs, plantas] = await Promise.all([
    chamar(`/buildings/${id}/images`, { width: 1200, height: 900 }).catch(() => []),
    chamar(`/buildings/${id}/floor_plans`, { width: 1200, height: 900 }).catch(() => [])
  ]);
  return mapear(b, imgs, plantas);
}
module.exports = { importar, mapear };
