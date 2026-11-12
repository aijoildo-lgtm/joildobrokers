const express = require('express');
const path = require('path');
const app = express();

// Rota explícita para o admin
app.get('/admin', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Rota padrão para o site
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Para arquivos estáticos (CSS, JS)
app.use(express.static(__dirname));

app.listen(process.env.PORT || 3000);