const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const fs = require('fs-extra');
const path = require('path');
const whatsapp = require('./whatsapp');
const scheduler = require('./scheduler');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const multer = require('multer');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../storage/uploads');
    fs.ensureDirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.jpg', '.jpeg', '.png', '.gif', '.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no permitido. Solo se aceptan imágenes (JPG, PNG, GIF) y PDFs.'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // Límite de 10MB
  }
});

// Configuración
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rutas
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.post('/send-message', async (req, res) => {
  if (!whatsapp.checkAuth()) {
    return res.status(401).json({ success: false, error: 'No autenticado con WhatsApp' });
  }

  try {
    const { numbers, content, type, date, time } = req.body;
    
    if (date && time) {
      // Mensaje programado
      const result = scheduler.scheduleMessage({
        date, time, numbers, content, type
      });
      return res.json(result);
    } else {
      // Mensaje inmediato
      const client = whatsapp.getClient();
      for (const number of numbers) {
        const chatId = number.includes('@') ? number : `${number}@c.us`;
        await client.sendMessage(chatId, content);
      }
      return res.json({ success: true });
    }
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Ruta para enviar medios
app.post('/send-media', upload.single('media'), async (req, res) => {
  if (!whatsapp.checkAuth()) {
    return res.status(401).json({ success: false, error: 'No autenticado con WhatsApp' });
  }

  try {
    const data = JSON.parse(req.body.data);
    const { numbers, content, type, date, time } = data;
    const mediaPath = req.file.path;
    
    // Obtener la extensión del archivo original
    const originalExt = path.extname(req.file.originalname).toLowerCase();
    const newPath = `${mediaPath}${originalExt}`;
    
    // Renombrar el archivo temporal para incluir la extensión correcta
    await fs.rename(mediaPath, newPath);

    if (date && time) {
      // Mensaje programado
      const result = scheduler.scheduleMessage({
        date, 
        time, 
        numbers, 
        content, 
        type, 
        media: { path: newPath }
      });
      return res.json(result);
    } else {
      // Mensaje inmediato
      const MessageMedia = whatsapp.getMessageMedia();
      const client = whatsapp.getClient();
      const media = await MessageMedia.fromFilePath(newPath);
      
      for (const number of numbers) {
        const chatId = number.includes('@') ? number : `${number}@c.us`;
        await client.sendMessage(chatId, media, { caption: content });
      }
      
      // Eliminar archivo temporal después de enviar
      await fs.unlink(newPath);
      return res.json({ success: true });
    }
  } catch (error) {
    console.error('Error enviando media:', error);
    // Asegurarse de eliminar archivos temporales en caso de error
    if (req.file && req.file.path) {
      try {
        await fs.unlink(req.file.path).catch(() => {});
        await fs.unlink(`${req.file.path}${path.extname(req.file.originalname)}`).catch(() => {});
      } catch (cleanupError) {
        console.error('Error limpiando archivos temporales:', cleanupError);
      }
    }
    return res.status(500).json({ success: false, error: error.message });
  }
});

// Ruta para desvincular
app.post('/logout', async (req, res) => {
  try {
    await whatsapp.logout();
    res.json({ success: true });
  } catch (error) {
    console.error('Error al desvincular:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Ruta para obtener mensajes programados
app.get('/scheduled-messages', (req, res) => {
  res.json(scheduler.getScheduledMessages());
});

// Ruta para cancelar mensaje programado
app.post('/cancel-scheduled', (req, res) => {
  const { jobId } = req.body;
  res.json(scheduler.cancelScheduledMessage(jobId));
});

// Inicializar WhatsApp y programador
whatsapp.init(io);
scheduler.init(whatsapp.getClient());

// Socket.io para comunicación en tiempo real
io.on('connection', (socket) => {
  console.log('Cliente conectado');
  
  socket.on('disconnect', () => {
    console.log('Cliente desconectado');
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`El puerto ${PORT} ya está en uso. Intenta reiniciar la aplicación.`);
    process.exit(1);
  } else {
    console.error('Error al iniciar el servidor:', err);
  }
});