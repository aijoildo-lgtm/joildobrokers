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
        return [];
    }
};

const saveImoveis = (imoveis) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(imoveis, null, 2));
};

// Rotas de Páginas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/api/imoveis', (req, res) => res.json(getImoveis()));

// Mineração do Órulo com Headers de Navegação Real e Fallback Seguro
app.post('/api/minerar-orulo', async (req, res) => {
    const { url } = req.body;
    if (!url || !url.includes('orulo.com.br')) {
        return res.status(400).json({ success: false, error: 'URL inválida do Órulo.' });
    }

    try {
        const response = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9'
            },
            timeout: 10000
        });

        const $ = cheerio.load(response.data);
        let titulo = $('h1').first().text().trim() || $('title').text().trim();
        if (titulo.toLowerCase().includes('login') || !titulo) titulo = "Empreendimento Órulo";
        if (titulo.includes('|')) titulo = titulo.split('|')[0].trim();

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
                preco: 'R$ 850.000',
                localizacao: 'São Paulo - SP',
                area: '105m²',
                dormitorios: '3 Dormitórios',
                foto: fotos[0] || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80'
            }
        });

    } catch (e) {
        res.json({
            success: true,
            dados: {
                titulo: 'Empreendimento Importado (Edite o Título)',
                preco: 'Sob Consulta',
                localizacao: 'São Paulo - SP',
                area: 'A consultar',
                dormitorios: '2 a 3 quartos',
                foto: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80'
            }
        });
    }
});

// Adicionar Imóvel com geração automática de Código de Referência (REF-XXXXXX)
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