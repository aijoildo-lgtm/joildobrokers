app.post('/api/minerar-orulo', async (req, res) => {
    const { url } = req.body;
    try {
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
        });
        const $ = cheerio.load(data);

        // Tentativa agressiva de pegar o título
        const titulo = $('h1').text().trim() || $('title').text().trim();
        
        console.log("Título extraído:", titulo);

        const novoImovel = {
            id: Date.now(),
            titulo: titulo, // Se isso vier vazio, é porque o site está bloqueando
            preco: "R$ A consultar",
            foto: "https://images.unsplash.com/photo-1560518883-ce09059eeffa",
            localizacao: "São Paulo",
            area: "0",
            dormitorios: "0"
        };

        // Salva no JSON
        const imoveis = JSON.parse(fs.readFileSync('imoveis.json', 'utf-8'));
        imoveis.push(novoImovel);
        fs.writeFileSync('imoveis.json', JSON.stringify(imoveis, null, 2));

        res.json({ success: true, dados: novoImovel });
    } catch (e) {
        console.error("Erro completo:", e);
        res.status(500).json({ error: e.message });
    }
});