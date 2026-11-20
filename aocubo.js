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

  // "Opções de planta": 37 m² · 2 Quartos · 0 vagas · 1 banheiros (cada grupo começa pela metragem)
  const tipologias = [];
  const iPl = linhas.findIndex(l => /^Op[çc][õo]es de planta$/i.test(l));
  if (iPl >= 0) {
    let atual = null;
    for (const l of linhas.slice(iPl + 1, iPl + 25)) {
      const a = l.match(/^(\d{1,4}(?:[.,]\d+)?)\s*m²$/i), q = l.match(/^(\d+)\s*quartos?$/i), v = l.match(/^(\d+)\s*vagas?$/i), b = l.match(/^(\d+)\s*banheiros?$/i), su = l.match(/^(\d+)\s*su[ií]tes?$/i);
      if (a) { if (atual) tipologias.push(atual); atual = { nome: tipo || 'Apartamento', area: `${a[1]} m²`, dorm: '', suites: '', banh: '', vagas: '', preco: '' }; }
      else if (atual && q) atual.dorm = q[1];
      else if (atual && su) atual.suites = su[1];
      else if (atual && v) atual.vagas = v[1];
      else if (atual && b) atual.banh = b[1];
      else if (atual) break;
    }
    if (atual) tipologias.push(atual);
  }
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
module.exports = { extrairAoCubo };
