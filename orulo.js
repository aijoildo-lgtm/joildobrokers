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

const K_AREA = ['private_area', 'useful_area', 'area', 'min_area', 'total_area'];
const K_PRECO = ['min_price', 'price', 'initial_price', 'sale_price', 'value', 'total_price'];
const K_BANH = ['bathrooms', 'bathroom', 'toilets', 'lavatories'];
const K_VAGA = ['parking', 'parking_spaces', 'garage', 'vacancies', 'parking_lots'];
// Quando o empreendimento não traz tipologias prontas, agrupa as unidades (mesma metragem e dormitórios) e usa o menor preço
function agruparUnidades(us) {
  const m = new Map();
  us.forEach(u => {
    const a = num(pega(u, ...K_AREA)), d = pega(u, 'bedrooms', 'dorms'), su = pega(u, 'suites'), bn = pega(u, ...K_BANH), vg = pega(u, ...K_VAGA), pr = num(pega(u, ...K_PRECO));
    if (!a && !d) return;
    const k = [a, d, su, bn, vg].join('|'), x = m.get(k);
    if (!x) m.set(k, { name: texto(pega(u, 'typology', 'type', 'name', 'title')), private_area: a || '', bedrooms: d, suites: su, bathrooms: bn, parking: vg, min_price: pr || '' });
    else if (pr && (!x.min_price || pr < x.min_price)) x.min_price = pr;
  });
  return [...m.values()];
}
function mapear(b, imgs, plantas, tipsApi, unidades) {
  const end = b.address || {};
  let tip = lista(b.typologies || b.types || []);
  if (!tip.length) tip = lista(tipsApi, 'typologies', 'items', 'results', 'data');
  if (!tip.length) tip = agruparUnidades(lista(unidades, 'units', 'items', 'results', 'data'));
  const dorms = [num(b.bedrooms), ...tip.map(t => num(t.bedrooms))].filter(n => n != null);
  const areas = [num(b.min_area), num(b.max_area), ...tip.map(t => num(pega(t, ...K_AREA)))].filter(n => n != null && n > 0);
  const precos = [num(pega(b, 'min_price', 'price')), ...tip.map(t => num(pega(t, ...K_PRECO)))].filter(n => n != null && n > 0);
  const vagasN = [num(pega(b, 'parking', 'parking_spaces', 'garage')), ...tip.map(t => num(pega(t, ...K_VAGA)))].filter(n => n != null && n > 0);
  const faixa = (arr, fmt, un) => { if (!arr.length) return ''; const a = Math.min(...arr), z = Math.max(...arr); return a === z ? fmt(a) + un : `${fmt(a)} a ${fmt(z)}${un}`; };
  const estTxt = texto(pega(b, 'status', 'stage', 'construction_status', 'situation'));
  const estagio = (ESTAGIOS.find(([re]) => re.test(estTxt)) || [])[1] || '';
  const entregaRaw = texto(pega(b, 'delivery_date', 'expected_delivery_date', 'completion_date', 'finish_date'));
  const dt = entregaRaw.match(/^(\d{4})-(\d{2})/);
  const entrega = dt ? `${dt[2]}/${dt[1]}` : entregaRaw;
  const fotos = lista(imgs, 'images', 'items').map(urlDe).filter(Boolean).slice(0, 30);
  const pl = lista(plantas, 'floor_plans', 'items').map(p => ({ nome: texto(pega(p, 'name', 'title', 'description', 'label')), area: num(pega(p, 'private_area', 'area')) ? fmtN(num(pega(p, 'private_area', 'area'))) + ' m²' : '', url: urlDe(p) })).filter(p => p.url).slice(0, 20);
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
  const extra = [['Andares', 'floors', 'number_of_floors', 'total_floors'], ['Unidades por andar', 'units_per_floor', 'apartments_per_floor'], ['Área do terreno', 'land_area', 'ground_area', 'terrain_area'], ['Lançamento', 'launch_date', 'launched_at'], ['Início das obras', 'construction_start', 'work_start_date', 'start_date'], ['Andamento da obra', 'progress', 'construction_progress', 'work_progress']];
  extra.forEach(([rot, ...ks]) => { const v = texto(pega(b, ...ks)); if (v) info.push({ k: rot, v: /area/i.test(ks[0]) && num(v) ? fmtN(num(v)) + ' m²' : /progress/i.test(ks[0]) && num(v) != null && !/%/.test(v) ? v + '%' : v }); });
  const dmin = dorms.length ? Math.min(...dorms) : 0, dmax = dorms.length ? Math.max(...dorms) : 0;
  // valor por m²: usa o campo do Órulo se existir; senão calcula pelo tipo de menor preço (preço ÷ área)
  let pm2 = num(pega(b, 'min_price_per_square_meter', 'price_per_square_meter', 'price_per_m2', 'square_meter_price'));
  if (!pm2) { const c = tip.map(t => ({ p: num(pega(t, ...K_PRECO)), a: num(pega(t, ...K_AREA)) })).filter(x => x.p > 0 && x.a > 0).sort((x, y) => x.p - y.p)[0]; if (c) pm2 = c.p / c.a; }
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
    tipologias: tip.map(t => {
      const area = num(pega(t, ...K_AREA)), preco = num(pega(t, ...K_PRECO)), dorm = String(pega(t, 'bedrooms', 'dorms'));
      return { nome: texto(pega(t, 'name', 'title', 'typology', 'type', 'description')) || (dorm ? `${dorm} dormitório${dorm === '1' ? '' : 's'}` : 'Apartamento'), area: area ? fmtN(area) + ' m²' : '', dorm, suites: String(pega(t, 'suites')), banh: String(pega(t, ...K_BANH)), vagas: String(pega(t, ...K_VAGA)), preco: preco ? brl(preco) : '' };
    }).filter(t => t.area || t.preco || t.dorm).slice(0, 40)
  };
  const diag = `campos do empreendimento: ${Object.keys(b).join(', ')} | imagens: ${fotos.length} | plantas: ${pl.length}`;
  return { dados, diag };
}

async function importar(id) {
  const b = await chamar('/buildings/' + id);
  const [imgs, plantas, tipsApi, unidades] = await Promise.all([
    chamar(`/buildings/${id}/images`, { width: 1200, height: 900 }).catch(() => []),
    chamar(`/buildings/${id}/floor_plans`, { width: 1200, height: 900 }).catch(() => []),
    lista(b.typologies || b.types || []).length ? null : chamar(`/buildings/${id}/typologies`).catch(() => null),
    lista(b.typologies || b.types || []).length ? null : chamar(`/buildings/${id}/units`, { results_per_page: 200 }).catch(() => null)
  ]);
  return mapear(b, imgs, plantas, tipsApi, unidades);
}
// Lista empreendimentos com filtros. Os filtros vão para a API e também são aplicados aqui, porque os nomes
// dos parâmetros aceitos dependem da sua conta Órulo (confira em documento.orulo.com.br).
async function listar(f) {
  const q = { page: Math.max(1, +f.pagina || 1), results_per_page: 24 };
  if (f.q) q.name = f.q; if (f.estado) q.state = f.estado; if (f.cidade) q.city = f.cidade;
  const d = await chamar('/buildings', q);
  const arr = Array.isArray(d) ? d : lista(d, 'buildings', 'items', 'results');
  const low = (v) => String(v || '').toLowerCase();
  let itens = arr.map(b => {
    const end = b.address || {}, est = texto(pega(b, 'status', 'stage', 'construction_status', 'situation'));
    return { id: b.id, nome: texto(b.name), bairro: texto(pega(end, 'area', 'neighborhood')), cidade: texto(end.city), estado: texto(end.state),
      estagio: (ESTAGIOS.find(([re]) => re.test(est)) || [])[1] || '', preco: num(pega(b, 'min_price', 'price')), foto: urlDe(b.default_image) };
  });
  if (f.q) itens = itens.filter(x => low(x.nome).includes(low(f.q)));
  if (f.bairro) itens = itens.filter(x => low(x.bairro).includes(low(f.bairro)));
  if (f.cidade) itens = itens.filter(x => low(x.cidade).includes(low(f.cidade)));
  if (f.estagio) itens = itens.filter(x => x.estagio === f.estagio);
  if (+f.precoMax) itens = itens.filter(x => !x.preco || x.preco <= +f.precoMax);
  return { itens: itens.map(x => ({ ...x, precoTxt: x.preco ? brl(x.preco) : '' })), pagina: q.page };
}
module.exports = { importar, mapear, listar };
