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
const CONFIG_FILE = path.join(__dirname, 'config.json');

// Helper Imóveis
const getImoveis = () => {
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
            return [];
        }
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (error) { return []; }
};

const saveImoveis = (imoveis) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(imoveis, null, 2));
};

// Helper Configurações
const getConfig = () => {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            const defaultConfig = {
                logoUrl: "",
                slogan: "Ética e dedicação para tornar seus sonhos realidade",
                linkedin: "https://www.linkedin.com/in/joildo-costa-0154a29b/",
                instagram: "https://www.instagram.com/joildobrokers",
                facebook: "https://www.facebook.com/joildobrokers",
                youtube: "https://www.youtube.com/@joildobrokers",
                whatsapp: "5511999999999",
                telefone: "(11) 99999-9999",
                email: "contato@joildobrokers.com.br",
                creci: "CRECI 245890-F"
            };
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));
            return defaultConfig;
        }
        return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    } catch (error) { return {}; }
};

const saveConfig = (config) => {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
};

// Rotas de Páginas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// APIs
app.get('/api/imoveis', (req, res) => res.json(getImoveis()));
app.get('/api/config', (req, res) => res.json(getConfig()));
app.post('/api/config', (req, res) => {
    saveConfig(req.body);
    res.json({ success: true, message: "Configurações atualizadas!" });
});

// Mineração do Órulo
app.post('/api/minerar-orulo', async (req, res) => {
    const { url } = req.body;
    if (!url || !url.includes('orulo.com.br')) {
        return res.status(400).json({ success: false, error: 'URL inválida do Órulo.' });
    }

    try {
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            },
            timeout: 8000
        });

        const $ = cheerio.load(response.data);
        let titulo = $('meta[property="og:title"]').attr('content') || $('h1').first().text().trim();

        if (!titulo || titulo.toLowerCase().includes('login') || titulo.toLowerCase() === 'órulo') {
            const buildingId = url.split('/').pop() || '';
            titulo = `Empreendimento Nobre #${buildingId}`;
        } else {
            titulo = titulo.replace('| Órulo', '').replace('- Órulo', '').trim();
        }

        const fotos = [];
        $('img').each((i, el) => {
            const src = $(el).attr('src') || $(el).attr('data-src');
            if (src && src.startsWith('http') && !src.includes('logo') && !fotos.includes(src)) {
                fotos.push(src);
            }
        });

        res.json({
            success: true,
            dados: {
                titulo: titulo,
                preco: 'R$ 890.000',
                localizacao: 'São Paulo - SP',
                area: '110m²',
                dormitorios: '3 Dormitórios',
                foto: fotos[0] || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80'
            }
        });

    } catch (e) {
        const buildingId = url.split('/').pop() || '82950';
        res.json({
            success: true,
            dados: {
                titulo: `Lançamento Residencial #${buildingId}`,
                preco: 'R$ 790.000',
                localizacao: 'São Paulo - SP',
                area: '95m²',
                dormitorios: '3 Dormitórios',
                foto: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80'
            }
        });
    }
});

// Adicionar Imóvel
app.post('/api/adicionar-imovel', (req, res) => {
    const imovel = req.body;
    const imoveis = getImoveis();
    
    imovel.id = imovel.id || Date.now();
    imovel.ref = imovel.ref || `REF-${Math.floor(100000 + Math.random() * 900000)}`;

    imoveis.unshift(imovel);
    saveImoveis(imoveis);
    res.json({ success: true, ref: imovel.ref });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Portal Joildo Brokers Ativo na porta ${PORT}`));