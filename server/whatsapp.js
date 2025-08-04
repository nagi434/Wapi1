const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const fs = require('fs-extra');
const path = require('path');

let client;
let qrCode = null;
let isAuthenticated = false;

const init = (io) => {
  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: path.join(__dirname, '../storage/sessions')
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });

  client.on('qr', async (qr) => {
    // Convierte el QR a una URL de imagen
    const qrImage = await qrcode.toDataURL(qr);
    // Emite el QR a través de Socket.IO
    io.emit('qr', qrImage);
    console.log('Por favor, escanea el código QR desde la interfaz web');
  });

  client.on('authenticated', () => {
    isAuthenticated = true;
    qrCode = null;
    io.emit('authenticated');
  });

  client.on('auth_failure', () => {
    isAuthenticated = false;
    io.emit('auth_failure');
  });

  client.on('disconnected', (reason) => {
    isAuthenticated = false;
    // Eliminar sesión al desconectarse
    fs.removeSync(path.join(__dirname, '../storage/sessions'));
    io.emit('disconnected', reason);
  });

  client.on('ready', () => {
    isAuthenticated = true;
    io.emit('ready');
  });

  client.initialize();
};

const getClient = () => client;
const getMessageMedia = () => MessageMedia;
const getQrCode = () => qrCode;
const checkAuth = () => isAuthenticated;

const logout = async () => {
  if (client) {
    await client.logout();
  }
};

module.exports = {
  init,
  getClient,
  getMessageMedia,
  getQrCode,
  checkAuth,
  logout
};