app.post('/api/minerar-orulo', async (req, res) => {
    const { url } = req.body;
    try {
        const { data } = await axios.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36' 
            }
        });
        
        const $ = cheerio.load(data);

        // EXTRAÇÃO PRECISA
        const titulo = $('h1.building-name').text().trim() || $('h1').first().text().trim();
        const preco = $('.price-value').first().text().trim() || 'Sob consulta';
        const localizacao = $('.address').first().text().trim();
        
        // Extrai a primeira imagem da galeria (a principal)
        const foto = $('.gallery-image img').attr('src') || $('img').first().attr('src');
        
        // Extrai metragem e quartos (geralmente em elementos de texto ou spans)
        const area = $('.highlight-item:contains("m²")').text().trim() || 'Sob consulta';
        const quartos = $('.highlight-item:contains("quartos")').text().trim() || 'Sob consulta';

        const novoImovel = {
            titulo,
            preco,
            foto,
            localizacao,
            area,
            dormitorios: quartos,
            lazer: ['Vaga disponível', 'Área comum completa']
        };

        // LOG PARA VOCÊ VER NO RENDER
        console.log("DADOS EXTRAÍDOS COM SUCESSO:", novoImovel);

        res.json({ success: true, dados: novoImovel });
    } catch (e) {
        console.error("Erro na mineração:", e.message);
        res.status(500).json({ error: "Não foi possível extrair. Verifique se a URL está correta." });
    }
});