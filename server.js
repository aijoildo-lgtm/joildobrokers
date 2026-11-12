const express = require('express');
const app = express();
const path = require('path');

app.use(express.json());
app.use(express.static(__dirname));

// Lista de imóveis (Fixo para teste, garantindo que o site funcione)
const imoveis = [
    {
        id: 1,
        titulo: "Apartamento Luxo - Pinheiros",
        preco: "R$ 1.200.000",
        localizacao: "Pinheiros, São Paulo",
        foto: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?q=80&w=600",
        area: "110m²",
        dormitorios: "3 Quartos",
        lazer: ["Piscina", "Academia"]
    },
    {
        id: 2,
        titulo: "Casa em Condomínio - Alphaville",
        preco: "R$ 2.800.000",
        localizacao: "Alphaville, São Paulo",
        foto: "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?q=80&w=600",
        area: "250m²",
        dormitorios: "4 Quartos",
        lazer: ["Churrasqueira", "Quadra"]
    }
];

app.get('/api/imoveis', (req, res) => {
    res.json(imoveis);
});

// Rota de mineração (Simplificada para teste)
app.post('/api/minerar-orulo', (req, res) => {
    // Aqui você integrará o robô real depois
    res.json({ success: true, dados: { titulo: "Imóvel Minerado do Órulo" } });
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(process.env.PORT || 3000);