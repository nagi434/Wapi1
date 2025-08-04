const cron = require('node-cron');
const moment = require('moment');

let client;
let messageMedia;
const scheduledMessages = {};

const init = (whatsappClient) => {
  client = whatsappClient;
  messageMedia = require('whatsapp-web.js').MessageMedia;
};

const scheduleMessage = (message) => {
  const { date, time, numbers, content, type, media } = message;
  const datetime = moment(`${date} ${time}`, 'YYYY-MM-DD HH:mm:ss');
  const now = moment();
  const diffInSeconds = datetime.diff(now, 'seconds');

  if (diffInSeconds <= 0) {
    return { success: false, error: 'La fecha y hora deben ser futuras' };
  }

  const jobId = `job_${Date.now()}`;
  const timeoutId = setTimeout(async () => {
    try {
      for (const number of numbers) {
        const chatId = number.includes('@') ? number : `${number}@c.us`;
        
        if (type === 'media') {
          const mediaData = messageMedia.fromFilePath(media.path);
          await client.sendMessage(chatId, mediaData, { caption: content });
        } else {
          await client.sendMessage(chatId, content);
        }
      }
      delete scheduledMessages[jobId];
    } catch (error) {
      console.error('Error enviando mensaje programado:', error);
    }
  }, diffInSeconds * 1000);

  scheduledMessages[jobId] = {
    id: jobId,
    timeoutId,
    scheduledFor: datetime.format('YYYY-MM-DD HH:mm:ss'),
    numbers,
    content,
    type
  };

  return { success: true, jobId };
};

const cancelScheduledMessage = (jobId) => {
  if (scheduledMessages[jobId]) {
    clearTimeout(scheduledMessages[jobId].timeoutId);
    delete scheduledMessages[jobId];
    return { success: true };
  }
  return { success: false, error: 'Trabajo no encontrado' };
};

const getScheduledMessages = () => {
  return Object.values(scheduledMessages);
};

module.exports = {
  init,
  scheduleMessage,
  cancelScheduledMessage,
  getScheduledMessages
};