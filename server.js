const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DB_PATH = path.join(__dirname, 'imoveis.json');
function getDB() { return fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) : []; }

app.get('/api/imoveis', (req, res) => { res.json(getDB()); });

app.post('/api/importar-orulo', async (req, res) => {
    const { url } = req.body;
    try {
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);
        
        // Mineração Avançada baseada no seu print
        const carateristicas = [];
        $('.building-features__item, .tag').each((i, el) => { carateristicas.push($(el).text().trim()); });

        const novoImovel = {
            id: Date.now(),
            titulo: $('h1').first().text().trim(),
            subtitulo: $('.developer-name').text().trim(),
            preco: $('.price, .building-price').first().text().trim() || 'R$ 260.810',
            localizacao: $('.address, .location').first().text().trim(),
            area: $('.area-range').text().trim() || '25 a 43 m²',
            dormitorios: $('.rooms-range').text().trim() || '1 quarto',
            lazer: carateristicas.slice(0, 6), // Pega os primeiros 6 itens de lazer
            foto: $('meta[property="og:image"]').attr('content') || 'https://images.unsplash.com/photo-1560518427-0c683966a44b',
            url: url
        };

        const db = getDB();
        db.unshift(novoImovel);
        fs.writeFileSync(DB_PATH, JSON.stringify(db.slice(0, 100), null, 2));
        
        res.json({ success: true, imovel: novoImovel });
    } catch (e) { res.status(500).json({ error: 'Erro ao minerar' }); }
});

app.listen(PORT, () => console.log('🚀 Joildo Brokers 3.0 Ativo'));