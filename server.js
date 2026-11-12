const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const DB_PATH = path.join(__dirname, 'imoveis.json');

// Função para ler o banco de dados
function getDB() {
    if (!fs.existsSync(DB_PATH)) return [];
    try {
        return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    } catch (e) { return []; }
}

// ROTA DE MINERAÇÃO (Limpa e Extrai do Zero)
app.post('/api/pre-minerar', async (req, res) => {
    const { url } = req.body;
    try {
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);
        
        // Extração precisa do Órulo
        const dados = {
            titulo: $('h1').first().text().trim(),
            preco: $('.price, .building-price').first().text().trim() || 'Sob Consulta',
            localizacao: $('.address, .location').first().text().trim(),
            foto: $('meta[property="og:image"]').attr('content'),
            resumo: $('.description').text().trim().substring(0, 200) + '...',
            url: url
        };
        res.json({ success: true, dados });
    } catch (e) { 
        res.status(500).json({ error: 'Erro ao minerar: ' + e.message }); 
    }
});

// Rota de Publicação (Salva no JSON)
app.post('/api/publicar-final', (req, res) => {
    const novoImovel = req.body;
    const db = getDB();
    // Adiciona no topo da lista
    db.unshift({ ...novoImovel, id: Date.now() });
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    res.json({ success: true });
});

app.get('/api/imoveis', (req, res) => { res.json(getDB()); });
app.listen(10000, () => console.log('Servidor OK'));