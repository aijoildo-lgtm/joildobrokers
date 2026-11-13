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

// --- FUNÇÃO DE EXTRAÇÃO INTELIGENTE DO ORULO ---

function extrairDadosOrulo($) {
    const dados = {
        nome_do_projeto: '',
        construtora: '',
        localizacao: '',
        area_util: '',
        dormitorios: '',
        suites: '',
        banheiros: '',
        vagas: '',
        preco_a_partir: '',
        lazer: '',
        tipologias: [],
        estagio: '',
        estoque: '',
        lancamento: '',
        unidades_andar: '',
        entrega: '',
        total_unidades: '',
        numero_andares: '',
        area_terreno: '',
        area_laje: '',
        condominio: '',
        iptu: '',
        ri: ''
    };

    // 1. Título Principal
    dados.nome_do_projeto = $('h1').first().text().trim() || $('title').text().trim();

    // Coleta todo o texto da página em linhas limpas para busca por palavras-chave
    const bodyText = $('body').text();
    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // Helper de busca de valor por rótulo
    const findValueByLabel = (labels) => {
        for (let line of lines) {
            const lowerLine = line.toLowerCase();
            for (let label of labels) {
                if (lowerLine.includes(label.toLowerCase())) {
                    // Se a linha contém os dois (ex: "Área útil: 80m²")
                    const parts = line.split(':');
                    if (parts.length > 1) {
                        return parts.slice(1).join(':').trim();
                    } else {
                        // Se for apenas o rótulo, pega a próxima linha
                        const idx = lines.indexOf(line);
                        if (idx >= 0 && idx + 1 < lines.length) {
                            return lines[idx + 1].trim();
                        }
                    }
                }
            }
        }
        return '';
    };

    // Aplica os mapeamentos de rótulos comuns do Orulo
    dados.construtora = findValueByLabel(['Construtora', 'Incorporadora']) || 'Não informada';
    dados.localizacao = findValueByLabel(['Localização', 'Endereço', 'Cidade', 'Bairro']) || 'Localização não informada';
    dados.area_util = findValueByLabel(['Área útil', 'Área total', 'Metragem', 'Área']) || 'A definir';
    dados.dormitorios = findValueByLabel(['Dormitórios', 'Quartos', 'Dormitorios']) || 'A definir';
    dados.suites = findValueByLabel(['Suítes', 'Suites']) || 'A definir';
    dados.banheiros = findValueByLabel(['Banheiros', 'Banheiro']) || 'A definir';
    dados.vagas = findValueByLabel(['Vagas', 'Garagem']) || 'A definir';
    dados.preco_a_partir = findValueByLabel(['Preço a partir de', 'Valor de', 'Preço', 'Valor']) || 'Consulte';
    dados.estagio = findValueByLabel(['Estágio', 'Estagio']) || 'outros';
    dados.estoque = findValueByLabel(['Estoque']) || 'A definir';
    dados.lancamento = findValueByLabel(['Lançamento']) || 'A definir';
    dados.unidades_andar = findValueByLabel(['Unidades por andar', 'Unidades/andar']) || 'A definir';
    dados.entrega = findValueByLabel(['Entrega']) || 'A definir';
    dados.total_unidades = findValueByLabel(['Total de unidades', 'Unidades totais']) || 'A definir';
    dados.numero_andares = findValueByLabel(['Número de andares', 'Andares']) || 'A definir';
    dados.area_terreno = findValueByLabel(['Área do terreno', 'Área do terreno']) || 'A definir';
    dados.area_laje = findValueByLabel(['Área da laje', 'Laje']) || 'A definir';
    dados.condominio = findValueByLabel(['Condomínio', 'Condominio']) || 'A definir';
    dados.iptu = findValueByLabel(['IPTU']) || 'A definir';
    dados.ri = findValueByLabel(['RI']) || 'A definir';

    // 2. Extração de Lazer / Características do Condomínio
    // Procura por elementos listados sob cabeçalhos de "Lazer" ou "Condomínio"
    const lazerItems = [];
    $('h2, h3, h4, .section-title, .title, .header-title').each(function() {
        const headerText = $(this).text().trim().toLowerCase();
        if (headerText.includes('lazer') || headerText.includes('condomínio') || headerText.includes('amenities')) {
            $(this).next().find('li, span, .item, a, .amenity-item').each(function() {
                const itemText = $(this).text().trim();
                if (itemText && itemText.length < 50 && lazerItems.indexOf(itemText) === -1) {
                    lazerItems.push(itemText);
                }
            });
        }
    });
    if (lazerItems.length > 0) {
        dados.lazer = lazerItems.join(', ');
    }

    // 3. Extração de Tipologias (Tabelas ou listas de unidades)
    $('table tr, .typology-row, .unit-item, .row-unit').each(function() {
        const rowText = $(this).text().trim();
        // Tipologias geralmente possuem área (m²) e preço (R$)
        if (rowText.includes('m²') || rowText.includes('m2') || rowText.includes('R$')) {
            const cols = $(this).find('td, div, span');
            if (cols.length >= 4) {
                dados.tipologias.push({
                    tipo: $(cols[0]).text().trim(),
                    area: $(cols[1]).text().trim(),
                    dormitivos: $(cols[2]).text().trim(),
                    banheiros: $(cols[3]).text().trim(),
                    preco: $(cols[4]) ? $(cols[4]).text().trim() : ''
                });
            }
        }
    });

    return dados;
}

// --- ROTAS DE SISTEMA ---

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

// API: Mineração de Dados do Orulo
app.post('/api/minerar-orulo', async (req, res) => {
    const { url } = req.body;

    if (!url || !url.includes('orulo.com.br')) {
        return res.status(400).json({ success: false, error: 'URL inválida ou não pertence ao Orulo' });
    }

    try {
        console.log(`🔍 Iniciando extração inteligente para: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 20000
        });

        const $ = cheerio.load(response.data);
        const dadosExtraidos = extrairDadosOrulo($);

        // Busca a foto principal
        let foto_principal = '';
        $('img').each((i, el) => {
            const src = $(el).attr('src');
            if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon') && !src.includes('placeholder') && !foto_principal) {
                foto_principal = src;
            }
        });

        const resultado = {
            ...dadosExtraidos,
            foto_principal: foto_principal || 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=800&q=80',
            youtube_url: "",
            tour_virtual_url: "",
            fotos_extras: []
        };

        console.log('✅ Dados extraídos com sucesso:', resultado);
        res.json({ success: true, dados: resultado });

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

    imovel.estagio = imovel.estagio || "outros";
    imovel.id = Date.now();
    imovel.data_extracao = new Date().toISOString();
    imoveis.push(imovel);
    
    saveImoveis(imoveis);
    res.json({ success: true, imovel });
});

// API: Excluir imóvel por ID
app.delete('/api/imoveis/:id', (req, res) => {
    const id = parseInt(req.params.id);
    let imoveis = getImoveis();
    
    const imoveisFiltrados = imoveis.filter(imovel => imovel.id !== id);
    
    if (imoveisFiltrados.length === imoveis.length) {
        return res.status(404).json({ success: false, error: 'Imóvel não encontrado' });
    }
    
    saveImoveis(imoveisFiltrados);
    res.json({ success: true, message: 'Imóvel excluído com sucesso!' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Joildo Brokers rodando na porta ${PORT}`);
});