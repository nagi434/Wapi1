const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

class WhatsAppManager {
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.client = null;
        this.qrCode = null;
        this.authenticated = false;
        this.sessionPath = path.join(__dirname, 'sessions', `session-${sessionId}`);
        
        // Crear directorio de sesiones si no existe
        if (!fs.existsSync(path.join(__dirname, 'sessions'))) {
            fs.mkdirSync(path.join(__dirname, 'sessions'), { recursive: true });
        }
    }

    initialize() {
        return new Promise((resolve, reject) => {
            this.client = new Client({
                authStrategy: new LocalAuth({ clientId: this.sessionId }),
                puppeteer: { 
                    headless: true,
                    args: [
                        '--no-sandbox',
                        '--disable-setuid-sandbox',
                        '--disable-dev-shm-usage',
                        '--disable-accelerated-2d-canvas',
                        '--no-first-run',
                        '--no-zygote',
                        '--single-process',
                        '--disable-gpu'
                    ]
                },
                webVersionCache: {
                    type: 'remote',
                    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
                }
            });

            // Mostrar QR en terminal
            this.client.on('qr', qr => {
                this.qrCode = qr;
                
                // Limpiar la consola
                process.stdout.write('\x1B[2J\x1B[0f');
                
                console.log('\x1b[36m\x1b[1m\n=== ESCANEA ESTE CÓDIGO QR CON WHATSAPP ===\x1b[0m');
                console.log('\x1b[33m1. Abre WhatsApp en tu teléfono');
                console.log('2. Toca Menú → Dispositivos vinculados → Vincular un dispositivo');
                console.log('3. Escanea este código QR:\x1b[0m\n');
                
                const qrcode = require('qrcode-terminal');
                // Configuración optimizada para mejor escaneo
                qrcode.generate(qr, {
                    small: true,      // Tamaño más compacto
                    invert: true,     // Mejor contraste
                    scale: 1          // Escala mínima
                });
                
                console.log('\n\x1b[36m\x1b[1m=== Si no puedes escanear, prueba acercando el teléfono ===\x1b[0m\n');
            });

            this.client.on('authenticated', () => {
                this.authenticated = true;
                console.log('\n¡Autenticación exitosa!');
            });

            this.client.on('ready', () => {
                console.log('\n¡Cliente listo para enviar mensajes!');
                resolve(this.client);
            });

            this.client.on('disconnected', (reason) => {
                console.log('\nCliente desconectado:', reason);
                this.cleanupSession();
                reject(new Error('Sesión desconectada'));
            });

            this.client.on('auth_failure', (msg) => {
                console.error('\nError de autenticación:', msg);
                reject(new Error(msg));
            });

            this.client.initialize().catch(err => {
                console.error('Error inicializando cliente:', err);
                reject(err);
            });
        });
    }

    async sendTextMessage(number, text) {
        if (!text || text.trim() === '') return;
        
        const chatId = number.includes('@') ? number : `${number}@c.us`;
        await this.client.sendMessage(chatId, text);
    }
    
    async sendFileMessage(number, filePath, mimeType, caption = '') {
        const chatId = number.includes('@') ? number : `${number}@c.us`;
        const media = MessageMedia.fromFilePath(filePath);
        
        // Configurar el nombre del archivo si es un documento
        const isDocument = !mimeType.startsWith('image/') && 
                          !mimeType.startsWith('video/') && 
                          !mimeType.startsWith('audio/');
        
        const options = {
            caption: caption || '',
            sendMediaAsDocument: isDocument
        };
        
        await this.client.sendMessage(chatId, media, options);
    }
    
    // Método para enviar múltiples archivos
    async sendMultipleFiles(number, files, caption = '') {
        for (const file of files) {
            await this.sendFileMessage(number, file.path, file.mimetype, caption);
            // Pequeña pausa entre archivos
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    async generateQRImage(qr) {
        try {
            const qrImagePath = path.join(__dirname, 'sessions', `qr-${this.sessionId}.png`);
            await qrcode.toFile(qrImagePath, qr, {
                color: {
                    dark: '#000',
                    light: '#fff'
                },
                width: 300,
                margin: 1
            });
            console.log(`QR generado en: ${qrImagePath}`);
        } catch (err) {
            console.error('Error generando QR image:', err);
        }
    }

    async sendMessage(numbers, message, mediaPath = null, schedule = null) {
        if (!this.client || !this.client.info) {
            throw new Error('Cliente no inicializado o no autenticado');
        }

        const phoneNumbers = Array.isArray(numbers) ? numbers : numbers.split(',').map(num => num.trim());
        const scheduledTime = schedule ? new Date(schedule) : new Date();

        const sendToNumber = async (number) => {
            const chatId = number.includes('@') ? number : `${number}@c.us`;
            
            try {
                if (mediaPath) {
                    const media = MessageMedia.fromFilePath(mediaPath);
                    await this.client.sendMessage(chatId, media, { caption: message });
                } else {
                    await this.client.sendMessage(chatId, message);
                }
                console.log(`Mensaje enviado a ${number}`);
            } catch (error) {
                console.error(`Error enviando mensaje a ${number}:`, error);
                throw error;
            }
        };

        if (schedule) {
            const now = new Date();
            const delay = scheduledTime.getTime() - now.getTime();
            
            if (delay > 0) {
                return new Promise((resolve) => {
                    setTimeout(async () => {
                        for (const number of phoneNumbers) {
                            await sendToNumber(number);
                        }
                        resolve({ status: 'scheduled', scheduledTime });
                    }, delay);
                });
            }
        }

        // Envío inmediato
        for (const number of phoneNumbers) {
            await sendToNumber(number);
        }

        return { status: 'sent' };
    }

    async logout() {
        try {
            if (this.client) {
                await this.client.logout();
                await this.client.destroy();
            }
            this.cleanupSession();
            return true;
        } catch (error) {
            console.error('Error cerrando sesión:', error);
            throw error;
        }
    }

    cleanupSession() {
        try {
            // Eliminar archivos de sesión
            const sessionFiles = [
                path.join(__dirname, 'sessions', `session-${this.sessionId}`),
                path.join(__dirname, 'sessions', `qr-${this.sessionId}.png`)
            ];

            sessionFiles.forEach(filePath => {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            });
        } catch (error) {
            console.error('Error limpiando sesión:', error);
        }
    }

    getClientState() {
        if (!this.client) return 'uninitialized';
        if (!this.client.info) return 'authenticating';
        return this.client.info ? 'ready' : 'disconnected';
    }
}

module.exports = WhatsAppManager;