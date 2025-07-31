require('dotenv').config();
const express = require('express');
const socketIO = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const session = require('express-session');
const WhatsAppManager = require('./whatsapp.js');
const mime = require('mime-types');

const app = express();
const port = process.env.PORT || 3000;

// Configuración de sesiones
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// Configuración de multer para subir archivos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        'image/jpeg', 
        'image/png', 
        'image/gif',
        'image/webp',
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
        'audio/mpeg',
        'video/mp4',
        'application/zip'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Tipo de archivo no soportado'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { 
        fileSize: 25 * 1024 * 1024 // 25MB
    }
});

// Configuración del servidor
const server = app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
    // Crear directorios necesarios
    const dirs = ['uploads', 'server/sessions'];
    dirs.forEach(dir => {
        const fullPath = path.join(__dirname, dir);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
    });
});

// Configuración de Socket.io
const io = socketIO(server, {
    pingTimeout: 60000,
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Objeto para almacenar los managers de WhatsApp por sesión
const whatsappClients = {};

// Middleware para manejar sesiones de Socket.io
io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, next);
});

const sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'your-secret-key',
    resave: false,
    saveUninitialized: true
});

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Ruta para obtener el estado de la sesión
app.get('/session-status', (req, res) => {
    const sessionId = req.session.id;
    const whatsappManager = whatsappClients[sessionId];
    
    if (!whatsappManager) {
        return res.json({ status: 'disconnected' });
    }
    
    res.json({ status: whatsappManager.getClientState() });
});

// Inicializar cliente de WhatsApp
app.post('/init', (req, res) => {
    const sessionId = req.session.id;
    
    if (whatsappClients[sessionId]) {
        return res.status(400).json({ error: 'Ya hay una sesión activa' });
    }

    const whatsappManager = new WhatsAppManager(sessionId);
    whatsappClients[sessionId] = whatsappManager;

    whatsappManager.initialize()
        .then(() => {
            io.to(sessionId).emit('ready');
        })
        .catch(err => {
            console.error('Error inicializando WhatsApp:', err);
            delete whatsappClients[sessionId];
        });

    // El QR ya se muestra en terminal, no necesitamos emitirlo al cliente web
    res.json({ 
        status: 'initializing', 
        sessionId,
        message: 'Revisa la terminal para escanear el QR' 
    });
});

// Desconectar cliente
app.post('/logout', async (req, res) => {
    const sessionId = req.session.id;
    const whatsappManager = whatsappClients[sessionId];
    
    if (whatsappManager) {
        try {
            await whatsappManager.logout();
            delete whatsappClients[sessionId];
            req.session.destroy();
            res.json({ status: 'logged out' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    } else {
        res.status(400).json({ error: 'No hay sesión activa' });
    }
});

// Enviar mensaje con soporte para múltiples archivos
app.post('/send-message', upload.array('files', 10), async (req, res) => {
    const sessionId = req.session.id;
    const whatsappManager = whatsappClients[sessionId];
    
    if (!whatsappManager) {
        return res.status(400).json({ error: 'No hay sesión activa' });
    }

    const { numbers, message, schedule } = req.body;
    const files = req.files || [];

    try {
        // Validar números
        if (!numbers || numbers.trim() === '') {
            throw new Error('Debe proporcionar al menos un número');
        }

        const phoneNumbers = numbers.split(',').map(num => num.trim().replace(/\D/g, ''));
        if (phoneNumbers.length === 0) {
            throw new Error('Números de teléfono no válidos');
        }

        // Validar programación
        let scheduledTime = null;
        if (schedule) {
            scheduledTime = new Date(schedule);
            if (isNaN(scheduledTime.getTime())) {
                throw new Error('Fecha de programación no válida');
            }
        }

        // Función para enviar mensajes con archivos
        const sendMessages = async () => {
            const results = [];
            
            for (const number of phoneNumbers) {
                try {
                    // Enviar mensaje de texto si existe
                    if (message && message.trim() !== '') {
                        await whatsappManager.sendTextMessage(number, message);
                        results.push({ number, status: 'text_sent' });
                    }
                    
                    // Enviar archivos si existen
                    for (const file of files) {
                        const fileType = mime.lookup(file.path) || 'application/octet-stream';
                        await whatsappManager.sendFileMessage(
                            number, 
                            file.path, 
                            fileType,
                            message
                        );
                        results.push({ 
                            number, 
                            status: 'file_sent',
                            fileName: file.originalname,
                            fileType 
                        });
                    }
                    
                    // Pequeña pausa entre mensajes para evitar bloqueos
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } catch (error) {
                    console.error(`Error enviando a ${number}:`, error);
                    results.push({ 
                        number, 
                        status: 'error',
                        error: error.message 
                    });
                }
            }
            
            return results;
        };

        // Programar mensaje si es necesario
        if (scheduledTime) {
            const now = new Date();
            const delay = scheduledTime.getTime() - now.getTime();
            
            if (delay > 0) {
                setTimeout(async () => {
                    try {
                        await sendMessages();
                    } catch (error) {
                        console.error('Error enviando mensajes programados:', error);
                    } finally {
                        // Limpiar archivos después de enviar
                        cleanUpFiles(files);
                    }
                }, delay);
                
                return res.json({ 
                    status: 'scheduled', 
                    scheduledTime: scheduledTime.toISOString(),
                    totalNumbers: phoneNumbers.length,
                    totalFiles: files.length
                });
            }
        }

        // Envío inmediato
        const results = await sendMessages();
        res.json({ 
            status: 'sent',
            results,
            totalNumbers: phoneNumbers.length,
            totalFiles: files.length
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    } finally {
        // Limpiar archivos si hay error
        cleanUpFiles(files);
    }
});

// Función para limpiar archivos temporales
function cleanUpFiles(files = []) {
    files.forEach(file => {
        try {
            if (fs.existsSync(file.path)) {
                fs.unlinkSync(file.path);
            }
        } catch (err) {
            console.error(`Error eliminando archivo ${file.path}:`, err);
        }
    });
}

// Configuración de Socket.io
io.on('connection', (socket) => {
    const sessionId = socket.request.session.id;
    socket.join(sessionId);
    
    // Verificar estado de la sesión
    socket.on('check-status', () => {
        const whatsappManager = whatsappClients[sessionId];
        if (whatsappManager) {
            const state = whatsappManager.getClientState();
            socket.emit('status-update', state);
        } else {
            socket.emit('status-update', 'disconnected');
        }
    });
    
    socket.on('disconnect', () => {
        socket.leave(sessionId);
    });
});

// Manejo de errores
app.use((err, req, res, next) => {
    console.error(err.stack);
    
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ 
            error: 'Error subiendo archivo',
            details: err.message 
        });
    }
    
    res.status(500).json({ 
        error: 'Algo salió mal',
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Exportar para pruebas
module.exports = { app, server, whatsappClients };
