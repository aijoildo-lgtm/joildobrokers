const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, 'imoveis.json');

// Garante que o arquivo JSON existe
const getImoveis = () => {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
            return [];
        }
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (error) {
        console.error("Erro ao ler imoveis.json:", error);
        return [];
    }
};

const saveImoveis = (imoveis) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(imoveis, null, 2));
};

// --- FUNÇÕES DE PARSE E EXTRAÇÃO AUTOMÁTICA DO ORULO ---

function extrairConstrutora($) {
    const text = $('*').filter(function() {
        const txt = $(this).text();
        return txt.includes('Construtora') || txt.includes('Incorporadora');
    }).first();

    if (text.length) {
        const parent = text.parent();
        const fullText = parent.text();
        const match = fullText.match(/(?:Construtora|Incorporadora)[:\s]+([^\n\r]+)/i);
        if (match) return match[1].trim();
    }
    return 'Não informada';
}

function parseCharacteristics($) {
    const chars = {};
    // Varre toda a página buscando rótulos e valores comuns de imóveis
    $('dt, td, .characteristic-item, li, span, div').each((i, el) => {
        const label = $(el).text().trim().toLowerCase();
        let value = '';

        // Tenta achar o valor associado
        if (el.tagName === 'dt') {
            const dd = $(el).next('dd');
            if (dd.length) value = dd.text().trim();
        } else if ($(el).is('td')) {
            const nextTd = $(el).next('td');
            if (nextTd.length) value = nextTd.text().trim();
        } else {
            const parent = $(el).parent();
            const valueEl = parent.find('.value, .characteristic-value, td:last-child, span:last-child');
            if (valueEl.length) value = valueEl.text().trim();
        }

        if (value && value.length < 100) { // Evite pegar textos enormes
            if (label.includes('área útil') || label.includes('area util') || label.includes('área') && label.includes('m²')) chars.area_util = value;
            else if (label.includes('dormitório') || label.includes('dormitorios') || label.includes('quartos')) chars.dormitorios = value;
            else if (label.includes('suíte') || label.includes('suites')) chars.suites = value;
            else if (label.includes('banheiro') || label.includes('banheiros')) chars.banheiros = value;
            else if (label.includes('vaga') || label.includes('garagem')) chars.vagas = value;
            else if (label.includes('preço') || label.includes('valor') || label.includes('partida')) chars.preco_a_partir = value;
            else if (label.includes('estágio') || label.includes('estagio')) chars.estagio = value;
            else if (label.includes('estoque')) chars.estoque = value;
            else if (label.includes('lançamento') || label.includes('lancamento')) chars.lancamento = value;
            else if (label.includes('unidades por andar') || label.includes('unidades/andar')) chars.unidades_andar = value;
            else if (label.includes('entrega')) chars.entrega = value;
            else if (label.includes('total de unidades') || label.includes('unidades totais')) chars.total_unidades = value;
            else if (label.includes('número de andares') || label.includes('numero de andares') || label.includes('andares')) chars.numero_andares = value;
            else if (label.includes('área do terreno') || label.includes('area do terreno')) chars.area_terreno = value;
            else if (label.includes('área da laje') || label.includes('area da laje')) chars.area_laje = value;
            else if (label.includes('condomínio') || label.includes('condominio') && !label.includes('valor')) chars.condominio = value;
            else if (label.includes('iptu')) chars.iptu = value;
            else if (label.includes('ri')) chars.ri = value;
        }
    });
    return chars;
}

function extrairLazer($) {
    const lazerItems = [];
    $('.lazer-item, .amenity-item, [class*="lazer"] span, [class*="amenity"]').each((i, el) => {
        const text = $(el).text().trim();
        if (text && lazerItems.indexOf(text) === -1) {
            lazerItems.push(text);
        }
    });
    const header = $('h3, h4, .section-title').filter(function() {
        return $(this).text().toLowerCase().includes('lazer') || $(this).text().toLowerCase().includes('condomínio');
    });
    if (header.length) {
        header.next().find('li, span, .item').each((i, el) => {
            const text = $(el).text().trim();
            if (text && lazerItems.indexOf(text) === -1) lazerItems.push(text);
        });
    }
    return lazerItems.join(', ');
}

function extrairTipologias($) {
    const tipologias = [];
    $('.typology-item, .unit-type, table.units tr').each((i, el) => {
        const tipo = $(el).find('.type, .unit-name').first().text().trim();
        const area = $(el).find('.area').first().text().trim();
        const dorm = $(el).find('.bedrooms, .rooms').first().text().trim();
        const ban = $(el).find('.bathrooms').first().text().trim();
        const prec = $(el).find('.price').first().text().trim();
        if (tipo || prec) {
            tipologias.push({ tipo, area, dormitivos: dorm, banheiros: ban, preco: prec });
        }
    });
    return tipologias;
}

// --- ROTAS ---

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/imoveis', (req, res) => {
    res.json(getImoveis());
});

// API: Mineração Detalhada do Orulo
app.post('/api/minerar-orulo', async (req, res) => {
    const { url } = req.body;

    if (!url || !url.includes('orulo.com.br')) {
        return res.status(400).json({ success: false, error: 'URL inválida ou não pertence ao Orulo' });
    }

    try {
        console.log(`🔍 Iniciando mineração detalhada para: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 20000
        });

        const $ = cheerio.load(response.data);

        const nome_do_projeto = $('h1').first().text().trim() || $('title').text().trim() || 'Imóvel Orulo';
        const construtora = extrairConstrutora($);
        const incorporadora = construtora; // Mantém sincronizado
        const localizacao = $('.olx-dsorg__location, .address, [class*="location"], [class*="address"]').first().text().trim() || 'Localização não informada';

        let foto_principal = '';
        $('img').each((i, el) => {
            const src = $(el).attr('src');
            if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon') && !src.includes('placeholder') && !foto_principal) {
                foto_principal = src;
            }
        });

        const chars = parseCharacteristics($);
        const lazer = extrairLazer($);
        const tipologias = extrairTipologias($);

        const dadosExtraidos = {
            nome_do_projeto,
            construtora,
            incorporadora,
            localizacao,
            foto_principal: foto_principal || 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=800&q=80',
            youtube_url: "",
            tour_virtual_url: "",
            fotos_extras: [],
            area_util: chars.area_util || "A definir",
            dormitorios: chars.dormitorios || "A definir",
            suites: chars.suites || "A definir",
            banheiros: chars.banheiros || "A definir",
            vagas: chars.vagas || "A definir",
            preco_a_partir: chars.preco_a_partir || "Consulte",
            lazer: lazer || "A definir",
            tipologias: tipologias.length > 0 ? tipologias : [{ tipo: "A definir", area: "A definir", dormitivos: "A definir", banheiros: "A definir", preco: "Consulte" }],
            estagio: chars.estagio || "A definir",
            estoque: chars.estoque || "A definir",
            lancamento: chars.lancamento || "A definir",
            unidades_andar: chars.unidades_andar || "A definir",
            entrega: chars.entrega || "A definir",
            total_unidades: chars.total_unidades || "A definir",
            numero_andares: chars.numero_andares || "A definir",
            area_terreno: chars.area_terreno || "A definir",
            area_laje: chars.area_laje || "A definir",
            condominio: chars.condominio || "A definir",
            iptu: chars.iptu || "A definir",
            ri: chars.ri || "A definir"
        };

        console.log('✅ Dados detalhados extraídos:', dadosExtraidos);
        res.json({ success: true, dados: dadosExtraidos });

    } catch (error) {
        console.error('Erro ao processar mineração detalhada:', error.message);
        res.status(500).json({ success: false, error: 'Não foi possível acessar a URL do Orulo no momento.' });
    }
});

// API: Adicionar imóvel com verificação de duplicidade
app.post('/api/adicionar-imovel', (req, res) => {
    const imovel = req.body;
    const imoveis = getImoveis();

    // --- BLOCO DE VERIFICAÇÃO DE DUPLICATAS ---
    const duplicate = imoveis.find(imob => {
        const sameName = imovel.nome_do_projeto && imob.nome_do_projeto && 
            imovel.nome_do_projeto.toLowerCase().trim() === imob.nome_do_projeto.toLowerCase().trim();
        
        const sameBuilder = (imovel.construtora && imob.construtora && 
            imovel.construtora.toLowerCase().trim() === imob.construtora.toLowerCase().trim()) ||
            (imovel.incorporadora && imob.incorporadora && 
            imovel.incorporadora.toLowerCase().trim() === imob.incorporadora.toLowerCase().trim());

        return sameName && sameBuilder;
    });

    if (duplicate) {
        console.log(`⚠️ Tentativa de publicar duplicata: ${imovel.nome_do_projeto} (${imovel.construtora})`);
        return res.status(409).json({ 
            success: false, 
            error: `Este imóvel já está publicado no sistema! Já existe um cadastro para o projeto "${duplicate.nome_do_projeto}" da construtora/incorporadora "${duplicate.construtora || duplicate.incorporadora}".`,
            duplicate_id: duplicate.id
        });
    }

    imovel.id = Date.now();
    imovel.data_extracao = new Date().toISOString();
    imoveis.push(imovel);
    
    saveImoveis(imoveis);
    res.json({ success: true, imovel });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Joildo Brokers rodando na porta ${PORT}`);
});