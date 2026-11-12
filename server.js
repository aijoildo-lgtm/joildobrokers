// Adicione esta rota ao seu server.js para processar as listas
app.post('/api/analisar-lista', async (req, res) => {
    const { url } = req.body;
    try {
        const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(data);
        const links = [];

        // Seletor genérico para os links de edifícios no Órulo
        $('.building-card a, .card a, a[href*="/buildings/"]').each((i, el) => {
            const link = $(el).attr('href');
            if (link && link.startsWith('/buildings/')) {
                links.push('https://www.orulo.com.br' + link);
            }
        });

        // Remove duplicados e retorna a lista limpa
        const linksUnicos = [...new Set(links)];
        res.json({ success: true, total: linksUnicos.length, links: linksUnicos });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao ler a lista.' });
    }
});