const express = require('express');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();

app.use(express.json());
app.use(express.static(__dirname));

// Rota para ler os imóveis (usada pelo index.html)
app.get('/api/imoveis', (req, res) => {
    const data = fs.readFileSync('imoveis.json', 'utf-8');
    res.json(JSON.parse(data));
});

// Rota para salvar novo imóvel (usada pelo admin.html)
app.post('/api/salvar-imovel', (req, res) => {
    const novoImovel = req.body;
    const imoveis = JSON.parse(fs.readFileSync('imoveis.json', 'utf-8'));
    novoImovel.id = imoveis.length + 1;
    imoveis.push(novoImovel);
    fs.writeFileSync('imoveis.json', JSON.stringify(imoveis, null, 2));
    res.json({ success: true });
});

// Rota para mineração do Orulo (a nova funcionalidade)
app.post('/api/minerar-orulo', async (req, res) => {
    const { url } = req.body;
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        // Extração de dados do Orulo (ajuste os seletores conforme o site mude)
        const imovel = {
            id: Date.now(),
            titulo: $('h1').text().trim(),
            preco: $('.price').text().trim() || 'Sob consulta',
            foto: $('img').first().attr('src'),
            localizacao: $('.address').text().trim(),
            area: 'A definir',
            dormitorios: 'A definir'
        };

        // Salva no arquivo JSON
        const imoveis = JSON.parse(fs.readFileSync('imoveis.json', 'utf-8'));
        imoveis.push(imovel);
        fs.writeFileSync('imoveis.json', JSON.stringify(imoveis, null, 2));

        res.json({ success: true, dados: imovel });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(3000, () => console.log('Servidor rodando em http://localhost:3000'));