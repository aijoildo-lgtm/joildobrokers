const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
// Serve static files from root directory (onde está o server.js)
app.use(express.static(__dirname));

// Caminho do banco de dados JSON
const DB_PATH = path.join(__dirname, 'imoveis.json');

// Inicializar banco de dados
let imoveis = [];
if (fs.existsSync(DB_PATH)) {
    imoveis = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

// Salvar banco de dados
function saveDB() {
    fs.writeFileSync(DB_PATH, JSON.stringify(imoveis, null, 2));
}

// Rota de Health Check (para o Render saber que está no ar)
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Servidor Joildo Brokers ativo!' });
});

// Rota para buscar todos os imóveis (público)
app.get('/api/imoveis', (req, res) => {
    res.json(imoveis);
});

// Rota para servir a página inicial
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota para servir o painel admin
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Rota para importar do Órulo (Web Scraping)
app.post('/api/importar-orulo', async (req, res) => {
    const { url, youtube, tour360, agendamento, redesSociais } = req.body;

    if (!url || !url.includes('orulo.com.br')) {
        return res.status(400).json({ error: 'URL inválida. Deve ser do Orulo.' });
    }

    try {
        // Fazer scraping do Órulo
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const $ = cheerio.load(response.data);

        // Extrair dados (os seletores podem precisar de ajuste conforme a página real)
        const titulo = $('h1').first().text().trim() || 'Imóvel sem título';
        const preco = $('.price, .building-price, [class*="price"]').first().text().trim() || 'Consulte';
        const foto = $('meta[property="og:image"]').attr('content') || '';
        const localizacao = $('.location, .address').first().text().trim() || '';

        const novoImovel = {
            id: Date.now(),
            titulo,
            preco,
            foto,
            localizacao,
            urlOriginal: url,
            youtube: youtube || '',
            tour360: tour360 || '',
            agendamento: agendamento || null,
            redesSociais: redesSociais || [],
            dataPublicacao: new Date().toISOString()
        };

        imoveis.push(novoImovel);
        saveDB();

        // Aqui você adicionaria a lógica de postagem automática nas redes sociais (APIs do Facebook/Instagram)
        console.log('✅ Imóvel importado:', novoImovel.titulo);

        res.json({ success: true, imovel: novoImovel, message: 'Imóvel importado com sucesso!' });
    } catch (error) {
        console.error('Erro ao importar do Órulo:', error.message);
        res.status(500).json({ error: 'Falha ao processar a URL do Órulo.' });
    }
});

// Rota para cadastro manual
app.post('/api/cad manual', (req, res) => {
    const { titulo, preço, foto, youtube, tour360, redesSociais } = req.body;

    const novoImovel = {
        id: Date.now(),
        titulo,
        preço,
        foto,
        youtube: youtube || '',
        tour360: tour360 || '',
        redesSociais: redesSociais || [],
        dataPublicacao: new Date().toISOString()
    };

    imoveis.push(novoImovel);
    saveDB();

    res.json({ success: true, imovel: novoImovel, message: 'Imóvel salvo com sucesso!' });
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
});