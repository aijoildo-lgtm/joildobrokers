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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/api/imoveis', (req, res) => res.json(getImoveis()));

app.post('/api/minerar-orulo', async (req, res) => {
    const { url } = req.body;
    try {
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(response.data);
        let titulo = $('h1').first().text().trim() || $('title').text().trim() || 'Empreendimento Órulo';
        
        const imgs = [];
        $('img').each((i, el) => {
            const src = $(el).attr('src');
            if (src && src.startsWith('http') && !imgs.includes(src)) imgs.push(src);
        });

        res.json({
            success: true,
            dados: {
                id: Date.now(),
                nome_do_projeto: titulo,
                construtora: 'Construtora Órulo',
                localizacao: 'São Paulo - SP',
                area_util: '100m²',
                dormitorios: '3',
                suites: '1',
                banheiros: '2',
                vagas: '2',
                preco_a_partir: 'R$ 850.000',
                estagio: 'lancamentos',
                foto_principal: imgs[0] || 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80',
                fotos_extras: imgs.slice(1, 5),
                lazer: 'Piscina, Academia, Salão de festas',
                tipologias: [{ tipo: "Tipo", area: "100m²", dormitivos: "3", banheiros: "2", preco: "R$ 850.000" }]
            }
        });
    } catch (e) {
        res.json({
            success: true,
            dados: {
                id: Date.now(),
                nome_do_projeto: "Imóvel Importado (Editar)",
                construtora: 'Não informada',
                localizacao: 'São Paulo - SP',
                area_util: 'A definir',
                dormitorios: '2',
                suites: '1',
                banheiros: '2',
                vagas: '1',
                preco_a_partir: 'Consulte',
                estagio: 'lancamentos',
                foto_principal: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&w=800&q=80',
                fotos_extras: [],
                lazer: 'Completo',
                tipologias: [{ tipo: "Padrão", area: "N/D", dormitivos: "N/D", banheiros: "N/D", preco: "Consulte" }]
            }
        });
    }
});

app.post('/api/adicionar-imovel', (req, res) => {
    const imovel = req.body;
    const imoveis = getImoveis();
    imovel.id = imovel.id || Date.now();
    imoveis.unshift(imovel);
    saveImoveis(imoveis);
    res.json({ success: true });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Servidor rodando na porta ${PORT}`));