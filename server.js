const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DB_PATH = path.join(__dirname, 'imoveis.json');

let imoveis = [];
if (fs.existsSync(DB_PATH)) {
    try {
        imoveis = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) {
        imoveis = [];
    }
}

function saveDB() {
    fs.writeFileSync(DB_PATH, JSON.stringify(imoveis, null, 2));
}

// Rota raiz - Serve o index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota admin - Serve o admin.html
app.get('/admin', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Rota para buscar todos os imóveis (público)
app.get('/api/imoveis', (req, res) => {
    res.json(imoveis);
});

// Rota de mineração
app.post('/api/importar-orulo', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL vazia' });

    try {
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);

        const novoImovel = {
            id: Date.now(),
            titulo: $('h1').first().text().trim(),
            preco: $('.price').first().text().trim() || 'Sob Consulta',
            foto: $('meta[property="og:image"]').attr('content'),
            localizacao: $('.location').first().text().trim(),
            urlOriginal: url,
            dataPublicacao: new Date().toISOString()
        };

        imoveis.push(novoImovel);
        saveDB();
        res.json({ success: true, imovel: novoImovel });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao minerar: ' + error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});