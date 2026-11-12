app.post('/api/minerar-orulo', async (req, res) => {
    const { url } = req.body;
    try {
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const $ = cheerio.load(data);

        // O Órulo usa h1 para o título do empreendimento
        const titulo = $('h1').first().text().trim() || 'Imóvel sem título';
        const preco = $('.price').first().text().trim() || 'Sob consulta';
        const foto = $('img').first().attr('src');

        const novoImovel = {
            id: Date.now(),
            titulo: titulo,
            preco: preco,
            foto: foto,
            localizacao: 'São Paulo', // Ajustaremos depois
            area: 'A definir',
            dormitorios: 'A definir'
        };

        const imoveis = JSON.parse(fs.readFileSync('imoveis.json', 'utf-8'));
        imoveis.push(novoImovel);
        fs.writeFileSync('imoveis.json', JSON.stringify(imoveis, null, 2));

        res.json({ success: true, dados: novoImovel });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});