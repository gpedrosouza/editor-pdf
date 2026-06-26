import express from 'express';
import cors from 'cors';
import extractRoute from './routes/extract.js';
import editRoute from './routes/edit.js';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

app.use('/extract-text', extractRoute);
app.use('/edit', editRoute);

app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
});
