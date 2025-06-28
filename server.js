
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let lessons = []; // Temporary in-memory storage

app.post('/api/lessons', (req, res) => {
    const lesson = req.body;
    lessons.push(lesson);
    res.status(201).json({ message: 'Lesson saved', lesson });
});

app.get('/api/lessons', (req, res) => {
    res.json(lessons);
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
