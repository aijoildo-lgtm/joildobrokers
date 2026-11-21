// Leitor de páginas do AoCubo (aocubo.com). Extrai só o que está na página; nada é inventado.
const ENT = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&lt;': '<', '&gt;': '>' };
const decodificar = (s) => s.replace(/&(?:amp|quot|nbsp|lt|gt|#39);/g, m => ENT[m]).replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));
const tira = (s) => decodificar(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function linhasDoHtml(html) {
  return decodificar(html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, '\n'))
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
const meta = (html, prop) => {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i'));
  return m ? decodificar(m[1]) : '';
};

function imagens(html, urlPagina) {
  let h = html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
  h = h.replace(/https?%3A%2F%2F[^&"'\s<>)]+/gi, m => { try { return decodeURIComponent(m); } catch (e) { return m; } });
  const todas = [...new Set((h.match(/https?:\/\/[^"'\s<>)\\,&]*corretoraocubo-production[^"'\s<>)\\,&]*/g) || []))];
  const og = meta(html, 'og:image');
  const idImovel = (og.match(/properties(?:%2F|\/)(\d+)(?:%2F|\/)/) || [])[1];
  const idUnidade = (String(urlPagina).match(/\/U(\d+)\/?(?:[?#].*)?$/) || [])[1];
  const doImovel = (u) => (idImovel && new RegExp(`properties(?:%2F|/)${idImovel}(?:%2F|/)`).test(u)) || (idUnidade && new RegExp(`property_units(?:%2F|/)${idUnidade}(?:%2F|/)`).test(u));
  const lista = (idImovel || idUnidade) ? todas.filter(doImovel) : todas;
  const ehPlanta = (u) => /property_units|planta/i.test(decodeURIComponent(u).replace(/%2F/gi, '/'));
  return { fotos: lista.filter(u => !ehPlanta(u)).slice(0, 30), plantas: lista.filter(ehPlanta).slice(0, 10), og };
}

const ESTAGIOS = [[/pronto/i, 'prontos'], [/constru|obra/i, 'construcao'], [/lan[cç]amento|breve/i, 'lancamentos'], [/usado/i, 'usados']];
const TIPOS = { studio: 'Studio', apartamento: 'Apartamento', cobertura: 'Cobertura', loft: 'Loft', flat: 'Flat', kitnet: 'Kitnet', duplex: 'Duplex', garden: 'Garden', casa: 'Casa', sobrado: 'Sobrado' };


// "Opções de planta": cada opção começa pela metragem e traz quartos, suítes, vagas, banheiros (e valor, se houver).
// Funciona com as informações em linhas separadas ou juntas na mesma linha.
function lerTipologias(linhas, tipo) {
  const i = linhas.findIndex(l => /^Op[çc][õo]es de planta/i.test(l));
  if (i < 0) return [];
  const f = linhas.findIndex((l, k) => k > i && /^(Descri[çc][ãa]o|[ÁA]reas de Conv|Como [ée] morar|Endere[çc]o|Localiza[çc]|Entrega|Im[óo]veis Semelhantes|Gostou|Est[áa]gio|Informa[çc][õo]es)/i.test(l));
  const bloco = linhas.slice(i + 1, f > 0 ? f : i + 45).join(' | ');
  const out = [], vistos = new Set();
  bloco.split(/(?<![\d.,])(?=\d{1,4}(?:[.,]\d+)?\s*m[²2](?!\d))/).forEach(parte => {
    const a = parte.match(/^(\d{1,4}(?:[.,]\d+)?)\s*m[²2](?!\d)/);
    if (!a) return;
    const q = parte.match(/(\d+)\s*quartos?/i), su = parte.match(/(\d+)\s*su[ií]tes?/i), v = parte.match(/(\d+)\s*vagas?/i), bn = parte.match(/(\d+)\s*banheiros?/i), pr = parte.match(/R\$\s*([\d.]+(?:,\d{2})?)/);
    if (!q && !v && !bn) return;
    const t = { nome: tipo || 'Apartamento', area: `${a[1]} m²`, dorm: q ? q[1] : '', suites: su ? su[1] : '', banh: bn ? bn[1] : '', vagas: v ? v[1] : '', preco: pr ? `R$ ${pr[1]}` : '' };
    const k = [t.area, t.dorm, t.suites, t.banh, t.vagas].join('|');
    if (!vistos.has(k)) { vistos.add(k); out.push(t); }
  });
  return out.slice(0, 40);
}

const MESES = { janeiro: 1, fevereiro: 2, 'março': 3, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
// "Dezembro de 2023", "dez/2023", "2023-12-01", "12/2023" -> "12/2023". Qualquer outro texto fica como veio.
function normalizarData(t) {
  t = String(t || '').trim(); if (!t) return '';
  let m = t.match(/^(\d{4})-(\d{2})(?:-\d{2})?/); if (m) return `${m[2]}/${m[1]}`;
  m = t.match(/(?:^|\D)(\d{1,2})\/(\d{4})\b/); if (m) return `${m[1].padStart(2, '0')}/${m[2]}`;
  m = t.match(/\b([a-zçã]{3,9})\.?\s*(?:de|\/|-)?\s*(\d{4})\b/i);
  if (m) { const k = Object.keys(MESES).find(n => n === m[1].toLowerCase() || (m[1].length === 3 && n.startsWith(m[1].toLowerCase()))); if (k) return `${String(MESES[k]).padStart(2, '0')}/${m[2]}`; }
  return t.slice(0, 40);
}

// Plano B: algumas páginas trazem as opções de planta dentro de um JSON embutido (script) em vez de texto visível.
// Procura objetos que tenham metragem + quartos e monta as tipologias, sem inventar nada.
function tipologiasDeJson(html, tipo) {
  const achados = [];
  const blocos = [...html.matchAll(/<script[^>]*(?:type=["']application\/(?:ld\+)?json["']|id=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  const num = (v) => { const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
  const pick = (o, re) => { const k = Object.keys(o).find(x => re.test(x) && o[x] != null && typeof o[x] !== 'object' && o[x] !== ''); return k ? o[k] : null; };
  const varre = (o, prof) => {
    if (!o || typeof o !== 'object' || prof > 12) return;
    if (!Array.isArray(o)) {
      const a = pick(o, /^(private_?area|useful_?area|area|metragem|size|square_?meters?|area_?privativa)$/i), q = pick(o, /^(bedrooms?|quartos?|dormit[oó]rios?|rooms)$/i);
      if (a != null && q != null && num(a) > 8 && num(a) < 2000 && num(q) >= 0 && num(q) < 12) {
        const su = pick(o, /^(suites?|su[ií]tes?)$/i), bn = pick(o, /^(bathrooms?|banheiros?)$/i), v = pick(o, /^(parking(_spaces)?|garage|vagas?|parking_lots)$/i), pr = pick(o, /^(price|min_price|valor|preco|preço)$/i);
        achados.push({ nome: tipo || 'Apartamento', area: `${String(num(a)).replace('.', ',')} m²`, dorm: String(q), suites: su != null ? String(su) : '', banh: bn != null ? String(bn) : '', vagas: v != null ? String(v) : '', preco: pr && num(pr) > 50000 ? 'R$ ' + Number(num(pr)).toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '' });
      }
    }
    (Array.isArray(o) ? o : Object.values(o)).forEach(x => varre(x, prof + 1));
  };
  blocos.forEach(b => { try { varre(JSON.parse(b), 0); } catch (e) {} });
  const vistos = new Set();
  return achados.filter(t => { const k = [t.area, t.dorm, t.suites, t.banh, t.vagas].join('|'); if (vistos.has(k)) return false; vistos.add(k); return true; }).slice(0, 40);
}

// Texto limpo da página (da ficha até antes dos "imóveis semelhantes"), para a IA ler quando a leitura direta falha
function textoParaIA(html) {
  const l = linhasDoHtml(html), fim = l.findIndex(x => /^(Im[óo]veis Semelhantes|Gostou do im[óo]vel)/i.test(x));
  return (fim > 0 ? l.slice(0, fim) : l).join('\n').slice(0, 9000);
}

function extrairAoCubo(html, urlPagina) {
  const linhas = linhasDoHtml(html);
  const fim = linhas.findIndex(l => /^(Im[óo]veis Semelhantes|Gostou do im[óo]vel)/i.test(l));
  const topo = (fim > 0 ? linhas.slice(0, fim) : linhas).join('\n');
  const depois = (rotulo) => { const i = linhas.findIndex(l => l.toLowerCase() === rotulo.toLowerCase()); return i >= 0 ? (linhas[i + 1] || '') : ''; };

  const h1 = tira((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  const ogTitulo = meta(html, 'og:title');
  const titulo = (h1 ? h1.split(/\s[—–-]\s/)[0] : ogTitulo.split(' | ')[0]).trim();

  const porPreco = topo.match(/\bpor\s*R\$\s*([\d.]+(?:,\d{2})?)/i);
  const descPreco = meta(html, 'og:description').match(/R\$\s*([\d.]+(?:,\d{2})?)/);
  const qualquer = [...topo.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/g)].map(m => m[1]).find(v => parseFloat(v.replace(/\./g, '').replace(',', '.')) >= 50000);
  const preco = porPreco ? porPreco[1] : descPreco ? descPreco[1] : qualquer || '';

  const area = (topo.match(/(\d{1,4}(?:[.,]\d+)?)\s*m²/i) || [])[1];
  const dorm = (topo.match(/(\d+)\s*quartos?/i) || [])[1];
  const suites = (topo.match(/(\d+)\s*su[ií]tes?/i) || [])[1];
  const vagas = (topo.match(/(\d+)\s*vagas?/i) || [])[1];

  const partes = depois('Localização').split(/\s+-\s+/).map(x => x.trim());
  const doH1 = h1.match(/\sem\s+(.+?),\s*([^,]+)$/i);
  const bairro = (partes.length >= 3 ? partes[partes.length - 2] : '') || (doH1 ? doH1[1] : '');
  const cidade = doH1 ? doH1[2] : 'São Paulo';
  const uf = /^[A-Z]{2}$/.test(partes[partes.length - 1] || '') ? partes[partes.length - 1] : 'SP';
  const localizacao = bairro ? `${bairro}, ${cidade} - ${uf}` : '';

  const estagioTxt = depois('Estágio da Obra');
  const estagio = (ESTAGIOS.find(([re]) => re.test(estagioTxt)) || [])[1] || '';
  const entregaTxt = depois('Entrega estimada') || depois('Entrega') || depois('Data de entrega');
  const entrega = normalizarData(entregaTxt);
  const endereco = depois('Endereço e localização') && !/^Conhe[çc]a/i.test(depois('Endereço e localização')) ? depois('Endereço e localização') : depois('Localização');
  const tipoM = (h1 || ogTitulo).match(new RegExp(`\\b(${Object.keys(TIPOS).join('|')})\\b`, 'i'));
  const tipo = tipoM ? TIPOS[tipoM[1].toLowerCase()] : '';

  const iLazer = linhas.findIndex(l => /^[ÁA]reas de Conv[ií]vio e Lazer$/i.test(l));
  let lazer = [];
  if (iLazer >= 0) {
    const iFim = linhas.findIndex((l, i) => i > iLazer && /^(Endere[çc]o e localiza|Conhe[çc]a a regi|Como [ée] morar)/i.test(l));
    lazer = linhas.slice(iLazer + 1, iFim > 0 ? iFim : iLazer + 40).filter(l => l.length < 60);
  }
  const iMorar = linhas.findIndex(l => /^Como [ée] morar/i.test(l));
  let apresentacao = '';
  if (iMorar >= 0 && iLazer > iMorar) { const t = linhas.slice(iMorar + 1, iLazer).join(' '); if (t.length > 60) apresentacao = t.slice(0, 3000); }

  let tipologias = lerTipologias(linhas, tipo);
  if (!tipologias.length) tipologias = tipologiasDeJson(html, tipo);
  const img = imagens(html, urlPagina);
  const infoTecnica = [];
  // imóvel pronto: a data é a em que foi entregue; os demais, a previsão
  if (entrega) infoTecnica.push({ k: estagio === 'prontos' ? 'Entregue em' : 'Previsão de entrega', v: entrega });

  return {
    titulo, preco: preco ? `R$ ${preco}` : '',
    area: area ? `${area}m²` : '',
    dormitorios: dorm ? `${dorm} Dormitório${+dorm > 1 ? 's' : ''}${suites && +suites > 0 ? ` (${suites} suíte${+suites > 1 ? 's' : ''})` : ''}` : '',
    vagas: vagas && vagas !== '0' ? `${vagas} vaga${+vagas > 1 ? 's' : ''}` : '',
    localizacao, estagio, tipo, categoria: tipo ? 'Residencial' : '',
    foto: img.fotos[0] || img.og || '', fotos: img.fotos, plantas: img.plantas,
    lazer, infoTecnica, apresentacao, tipologias, endereco: endereco.slice(0, 200), entrega
  };
}
module.exports = { extrairAoCubo, lerTipologias, linhasDoHtml, textoParaIA, normalizarData, tipologiasDeJson };
