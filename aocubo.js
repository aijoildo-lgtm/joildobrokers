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
  const entrega = depois('Entrega estimada');
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

  const tipologias = lerTipologias(linhas, tipo);
  const img = imagens(html, urlPagina);
  const infoTecnica = [];
  if (entrega && estagio && estagio !== 'prontos') infoTecnica.push({ k: 'Previsão de entrega', v: entrega });

  return {
    titulo, preco: preco ? `R$ ${preco}` : '',
    area: area ? `${area}m²` : '',
    dormitorios: dorm ? `${dorm} Dormitório${+dorm > 1 ? 's' : ''}${suites && +suites > 0 ? ` (${suites} suíte${+suites > 1 ? 's' : ''})` : ''}` : '',
    vagas: vagas && vagas !== '0' ? `${vagas} vaga${+vagas > 1 ? 's' : ''}` : '',
    localizacao, estagio, tipo, categoria: tipo ? 'Residencial' : '',
    foto: img.fotos[0] || img.og || '', fotos: img.fotos, plantas: img.plantas,
    lazer, infoTecnica, apresentacao, tipologias
  };
}
module.exports = { extrairAoCubo, lerTipologias, linhasDoHtml };
