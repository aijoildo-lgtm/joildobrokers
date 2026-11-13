const express = require('express');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
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

// --- FUNÇÃO DE EXTRAÇÃO COM PUPPETEER (ROBÔ DE NAVEGAÇÃO) ---

async function extrairDadosOruloPuppeteer(url) {
    let browser = null;
    try {
        console.log(`🚀 Iniciando navegador headless para: ${url}`);

        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 3000));

        const dados = await page.evaluate(() => {
            const bodyText = document.body.innerText;
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

            const imgs = Array.from(document.querySelectorAll('img'))
                .map(img => img.src)
                .filter(src => src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon'))
                .slice(0, 10);

            return {
                nome_do_projeto: document.title || findValue(['Nome do Projeto', 'Imóvel']),
                construtora: findValue(['Construtora', 'Incorporadora']) || 'Não informada',
                localizacao: findValue(['Localização', 'Endereço', 'Bairro', 'Cidade']) || 'São Paulo',
                area_util: findValue(['Área útil', 'Área total', 'Metragem']) || 'A definir',
                dormitorios: findValue(['Dormitórios', 'Quartos']) || 'A definir',
                suites: findValue(['Suítes']) || 'A definir',
                banheiros: findValue(['Banheiros']) || 'A definir',
                vagas: findValue(['Vagas', 'Garagem']) || 'A definir',
                preco_a_partir: findValue(['Preço', 'Valor', 'Partida']) || 'Consulte',
                estagio: findValue(['Estágio', 'Estagio', 'Situação']) || 'outros',
                estoque: findValue(['Estoque']) || 'A definir',
                lancamento: findValue(['Lançamento']) || 'A definir',
                unidades_andar: findValue(['Unidades por andar', 'Unidades/andar']) || 'A definir',
                entrega: findValue(['Entrega']) || 'A definir',
                total_unidades: findValue(['Total de unidades', 'Unidades totais']) || 'A definir',
                numero_andares: findValue(['Número de andares', 'Andares']) || 'A definir',
                area_terreno: findValue(['Área do terreno']) || 'A definir',
                area_laje: findValue(['Área da laje']) || 'A definir',
                condominio: findValue(['Condomínio', 'Condominio']) || 'A definir',
                iptu: findValue(['IPTU']) || 'A definir',
                ri: findValue(['RI']) || 'A definir',
                fotos: imgs,
                tipologias: [{ tipo: "A definir", area: "A definir", dormitivos: "A definir", banheiros: "A definir", preco: "Consulte" }]
            };
        });

        await browser.close();
        return { success: true, dados };

    } catch (error) {
        console.error('❌ Erro na extração Puppeteer:', error.message);
        if (browser) await browser.close();
        return { success: false, error: error.message };
    }
}

// --- FUNÇÃO DE EXTRAÇÃO ESTÁTICA (FALLBACK) ---

async function extrairDadosOruloEstático(url) {
    try {
        console.log(`🔍 Iniciando extração estática (Fallback) para: ${url}`);

        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 15000
        });

        const $ = cheerio.load(response.data);

        // Helper de busca de valor por rótulo
        const findValue = (labels) => {
            const bodyText = $('body').text();
            const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

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

        const imgs = $('img')
            .map((i, el) => $(el).attr('src'))
            .get()
            .filter(src => src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon'))
            .slice(0, 10);

        const dados = {
            nome_do_projeto: $('h1').first().text().trim() || $('title').text().trim() || 'Imóvel Orulo',
            construtora: findValue(['Construtora', 'Incorporadora']) || 'Não informada',
            localizacao: findValue(['Localização', 'Endereço', 'Bairro', 'Cidade']) || 'São Paulo',
            area_util: findValue(['Área útil', 'Área total', 'Metragem']) || 'A definir',
            dormitorios: findValue(['Dormitórios', 'Quartos']) || 'A definir',
            suites: findValue(['Suítes']) || 'A definir',
            banheiros: findValue(['Banheiros']) || 'A definir',
            vagas: findValue(['Vagas', 'Garagem']) || 'A definir',
            preco_a_partir: findValue(['Preço', 'Valor', 'Partida']) || 'Consulte',
            estagio: findValue(['Estágio', 'Estagio', 'Situação']) || 'outros',
            estoque: findValue(['Estoque']) || 'A definir',
            lancamento: findValue(['Lançamento']) || 'A definir',
            unidades_andar: findValue(['Unidades por andar', 'Unidades/andar']) || 'A definir',
            entrega: findValue(['Entrega']) || 'A definir',
            total_unidades: findValue(['Total de unidades', 'Unidades totais']) || 'A definir',
            numero_andares: findValue(['Número de andares', 'Andares']) || 'A definir',
            area_terreno: findValue(['Área do terreno']) || 'A definir',
            area_laje: findValue(['Área da laje']) || 'A definir',
            condominio: findValue(['Condomínio', 'Condominio']) || 'A definir',
            iptu: findValue(['IPTU']) || 'A definir',
            ri: findValue(['RI']) || 'A definir',
            fotos: imgs,
            tipologias: [{ tipo: "A definir", area: "A definir", dormitivos: "A definir", banheiros: "A definir", preco: "Consulte" }]
        };

        return { success: true, dados };

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

    // 1. Tenta usar o Puppeteer (se houver Chrome instalado)
    let resultado = await extrairDadosOruloPuppeteer(url);

    // 2. Se falhar (ex: "Could not find Chrome"), faz o fallback para extração estática
    if (!resultado.success) {
        console.log('⚠️ Tentando fallback de extração estática...');
        resultado = await extrairDadosOruloEstático(url);
    }

    if (resultado.success) {
        const dados = resultado.dados;
        const imovel = {
            id: Date.now(),
            nome_do_projeto: dados.nome_do_projeto,
            construtora: dados.construtora,
            localizacao: dados.localizacao,
            area_util: dados.area_util,
            dormitorios: dados.dormitorios,
            suites: dados.suites,
            banheiros: dados.banheiros,
            vagas: dados.vagas,
            preco_a_partir: dados.preco_a_partir,
            estagio: dados.estagio,
            estoque: dados.estoque,
            lancamento: dados.lancamento,
            unidades_andar: dados.unidades_andar,
            entrega: dados.entrega,
            total_unidades: dados.total_unidades,
            numero_andares: dados.numero_andares,
            area_terreno: dados.area_terreno,
            area_laje: dados.area_laje,
            condominio: dados.condominio,
            iptu: dados.iptu,
            ri: dados.ri,
            foto_principal: dados.fotos && dados.fotos[0] ? dados.fotos[0] : 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=800&q=80',
            fotos_extras: dados.fotos.slice(1) || [],
            tipologias: dados.tipologias,
            youtube_url: "",
            tour_virtual_url: "",
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