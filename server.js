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

// --- FUNÇÃO DE EXTRAÇÃO ESTÁTICA INTELIGENTE DO ORULO ---

async function extrairDadosOrulo(url) {
    try {
        console.log(`🔍 Iniciando extração estática para: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 20000
        });

        const $ = cheerio.load(response.data);

        // 1. Busca o JSON de estado do Next.js (contém todos os dados técnicos)
        let stateJson = null;
        $('script').each((i, el) => {
            const html = $(el).html();
            if (html && html.includes('__NEXT_DATA__')) {
                try {
                    const parsed = JSON.parse(html);
                    stateJson = parsed.props?.pageProps || parsed;
                } catch (e) {
                    // Tentativa alternativa de regex para JSON inline
                    const match = html.match(/window\.__INITIAL_STATE__\s*=\s*({.*});/s);
                    if (match) {
                        try {
                            stateJson = JSON.parse(match[1]);
                        } catch (err) {}
                    }
                }
            }
        });

        // Função auxiliar para buscar valores no texto da página (fallback)
        const bodyText = $('body').text();
        const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const findValue = (labels) => {
            for (let line of lines) {
                const lower = line.toLowerCase();
                for (let label of labels) {
                    if (lower.includes(label.toLowerCase())) {
                        const parts = line.split(':');
                        if (parts.length > 1) return parts.slice(1).join(':').trim();
                        const idx = lines.indexOf(line);
                        if (idx >= 0 && idx + 1 < lines.length) return lines[idx + 1].trim();
                    }
                }
            }
            return '';
        };

        // 2. Mapeamento dos Dados
        let projectData = stateJson?.project || stateJson?.building || stateJson || {};
        let nome_do_projeto = projectData.name || $('h1').first().text().trim() || findValue(['Nome do Projeto', 'Imóvel']);
        let construtora = projectData.builder?.name || projectData.constructionCompany || findValue(['Construtora', 'Incorporadora']) || 'Não informada';
        let localizacao = projectData.address?.neighborhood || projectData.address?.city || findValue(['Localização', 'Endereço', 'Bairro', 'Cidade']) || 'São Paulo';
        let area_util = projectData.usefulArea || projectData.area || findValue(['Área útil', 'Área total', 'Metragem']) || 'A definir';
        let dormitorios = projectData.bedrooms || projectData.quartos || findValue(['Dormitórios', 'Quartos']) || 'A definir';
        let suites = projectData.suites || findValue(['Suítes']) || 'A definir';
        let banheiros = projectData.bathrooms || findValue(['Banheiros']) || 'A definir';
        let vagas = projectData.vacancies || projectData.garage || findValue(['Vagas', 'Garagem']) || 'A definir';
        let preco_a_partir = projectData.price || findValue(['Preço', 'Valor', 'Partida']) || 'Consulte';

        // Estágio do imóvel (para filtragem)
        let situacao = projectData.status || projectData.stage || '';
        let estagio = 'outros';
        if (situacao.toLowerCase().includes('pronto') || situacao.toLowerCase().includes('entregue')) {
            estagio = 'prontos';
        } else if (situacao.toLowerCase().includes('construção') || situacao.toLowerCase().includes('obra') || situacao.toLowerCase().includes('em obras')) {
            estagio = 'construção';
        } else if (situacao.toLowerCase().includes('lançamento') || situacao.toLowerCase().includes('lancamento') || situacao.toLowerCase().includes('novo')) {
            estagio = 'lancamentos';
        } else if (situacao.toLowerCase().includes('promo') || situacao.toLowerCase().includes('desconto') || situacao.toLowerCase().includes('oportunidade')) {
            estagio = 'oportunidades';
        }

        // 3. Extração de Tipologias (Unidades)
        let tipologias = [];
        if (stateJson?.units && Array.isArray(stateJson.units)) {
            stateJson.units.forEach(u => {
                tipologias.push({
                    tipo: u.type || u.name || 'Unidade',
                    area: u.area || u.usefulArea || 'A definir',
                    dormitivos: u.bedrooms || 'A definir',
                    banheiros: u.bathrooms || 'A definir',
                    preco: u.price || 'Consulte'
                });
            });
        } else if (stateJson?.tipologias && Array.isArray(stateJson.tipologias)) {
            tipologias = stateJson.tipologias;
        } else {
            tipologias = [{ tipo: "A definir", area: area_util, dormitivos: dormitorios, banheiros: banheiros, preco: preco_a_partir }];
        }

        // 4. Extração de Imagens
        let fotos = [];
        if (stateJson?.images && Array.isArray(stateJson.images)) {
            stateJson.images.forEach(img => {
                const url = typeof img === 'string' ? img : img.url || img.src;
                if (url && url.startsWith('http')) fotos.push(url);
            });
        }
        if (fotos.length === 0) {
            $('img').each((i, el) => {
                const src = $(el).attr('src');
                if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon') && fotos.length < 5) {
                    fotos.push(src);
                }
            });
        }

        const dadosExtraidos = {
            nome_do_projeto,
            construtora,
            incorporadora: construtora,
            localizacao,
            area_util,
            dormitorios,
            suites,
            banheiros,
            vagas,
            preco_a_partir,
            estagio,
            estoque: projectData.estoque || findValue(['Estoque']) || 'A definir',
            lancamento: projectData.lancamento || findValue(['Lançamento']) || 'A definir',
            unidades_andar: projectData.unidades_andar || findValue(['Unidades por andar', 'Unidades/andar']) || 'A definir',
            entrega: projectData.entrega || findValue(['Entrega']) || 'A definir',
            total_unidades: projectData.total_unidades || findValue(['Total de unidades', 'Unidades totais']) || 'A definir',
            numero_andares: projectData.andares || projectData.numero_andares || findValue(['Número de andares', 'Andares']) || 'A definir',
            area_terreno: projectData.area_terreno || findValue(['Área do terreno']) || 'A definir',
            area_laje: projectData.area_laje || findValue(['Área da laje']) || 'A definir',
            condominio: projectData.condominio || findValue(['Condomínio', 'Condominio']) || 'A definir',
            iptu: projectData.iptu || findValue(['IPTU']) || 'A definir',
            ri: projectData.ri || findValue(['RI']) || 'A definir',
            fotos,
            tipologias,
            youtube_url: "",
            tour_virtual_url: "",
            fotos_extras: fotos.slice(1)
        };

        console.log('✅ Dados extraídos com sucesso:', dadosExtraidos);
        return { success: true, dados: dadosExtraidos };

    } catch (error) {
        console.error('❌ Erro na extração estática:', error.message);
        return { success: false, error: error.message };
    }
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

    const resultado = await extrairDadosOrulo(url);

    if (resultado.success) {
        const dados = resultado.dados;
        const imovel = {
            id: Date.now(),
            ...dados,
            foto_principal: dados.fotos && dados.fotos[0] ? dados.fotos[0] : 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=800&q=80',
            data_extracao: new Date().toISOString()
        };

        const imoveis = getImoveis();
        imoveis.push(imovel);
        saveImoveis(imoveis);

        res.json({ success: true, dados: imovel });
    } else {
        res.status(500).json({ success: false, error: resultado.error });
    }
});

// API: Adicionar imóvel manualmente
app.post('/api/adicionar-imovel', (req, res) => {
    const imovel = req.body;
    const imoveis = getImoveis();

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