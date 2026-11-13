const express = require('express');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
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

// --- FUNÇÃO DE EXTRAÇÃO COM PUPPETEER (ROBÔ DE NAVEGAÇÃO) ---

async function extrairDadosOrulo(url) {
    let browser = null;
    try {
        console.log(`🚀 Iniciando navegador headless para: ${url}`);

        browser = await puppeteer.launch({
            headless: true, // Roda em segundo plano
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage'
            ]
        });

        const page = await browser.newPage();
        
        // Configura User-Agent para parecer um navegador real
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Navega para a URL e espera o carregamento completo
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

        // Espera um tempo extra para carregar elementos dinâmicos (React/Vue)
        await new Promise(r => setTimeout(r, 3000));

        // Extrai os dados usando evaluate (injeta código JS na página)
        const dados = await page.evaluate(() => {
            const bodyText = document.body.innerText;
            const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            // Helper de busca por rótulo
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

            // Imagens
            const imgs = Array.from(document.querySelectorAll('img'))
                .map(img => img.src)
                .filter(src => src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon'))
                .slice(0, 10);

            // Tipologias (Tentativa de capturar linhas de tabela ou listas de unidades)
            const tipologias = [];
            document.querySelectorAll('table tr, .typology, .unit, [class*="typology"], [class*="unit"]').forEach(el => {
                const text = el.innerText;
                if (text.includes('m²') || text.includes('m2') || text.includes('R$')) {
                    const cols = Array.from(el.querySelectorAll('td, div, span')).map(c => c.innerText.trim());
                    if (cols.length >= 4) {
                        tipologias.push({
                            tipo: cols[0],
                            area: cols[1],
                            dormitivos: cols[2],
                            banheiros: cols[3],
                            preco: cols[4] || ''
                        });
                    }
                }
            });

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
                tipologias: tipologias.length > 0 ? tipologias : [{ tipo: "A definir", area: "A definir", dormitivos: "A definir", banheiros: "A definir", preco: "Consulte" }]
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

// API: Mineração de Dados do Orulo via Puppeteer
app.post('/api/minerar-orulo', async (req, res) => {
    const { url } = req.body;

    if (!url || !url.includes('orulo.com.br')) {
        return res.status(400).json({ success: false, error: 'URL inválida ou não pertence ao Orulo' });
    }

    const resultado = await extrairDadosOrulo(url);

    if (resultado.success) {
        const dados = resultado.dados;
        // Salva no JSON local
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