document.addEventListener('DOMContentLoaded', function() {
    const socket = io();
    const sessionId = document.cookie.match(/connect.sid=([^;]+)/)?.[1];
    
    const initBtn = document.getElementById('init-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const qrContainer = document.getElementById('qr-container');
    const qrCodeElement = document.getElementById('qr-code');
    const messageSection = document.getElementById('message-section');
    const messageForm = document.getElementById('message-form');
    const statusElement = document.getElementById('status');
    
    // Iniciar sesión con WhatsApp
    initBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/init', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (data.error) {
                showStatus(data.error, 'error');
            }
        } catch (error) {
            showStatus(error.message, 'error');
        }
    });
    
    // Desconectar sesión
    logoutBtn.addEventListener('click', async () => {
        try {
            const response = await fetch('/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            const data = await response.json();
            
            if (data.status === 'logged out') {
                qrContainer.style.display = 'none';
                messageSection.style.display = 'none';
                logoutBtn.style.display = 'none';
                initBtn.style.display = 'block';
                showStatus('Sesión cerrada correctamente', 'success');
            }
        } catch (error) {
            showStatus(error.message, 'error');
        }
    });
    
    // Enviar mensajes
    messageForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const numbers = document.getElementById('numbers').value;
        const message = document.getElementById('message').value;
        const fileInput = document.getElementById('file');
        const schedule = document.getElementById('schedule').value;
        
        const formData = new FormData();
        formData.append('numbers', numbers);
        formData.append('message', message);
        if (fileInput.files[0]) {
            formData.append('file', fileInput.files[0]);
        }
        if (schedule) {
            formData.append('schedule', schedule);
        }
        
        try {
            const response = await fetch('/send-message', {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (data.error) {
                showStatus(data.error, 'error');
            } else if (data.status === 'sent') {
                showStatus('Mensajes enviados correctamente', 'success');
            } else if (data.status === 'scheduled') {
                showStatus(`Mensajes programados para: ${new Date(data.scheduledTime).toLocaleString()}`, 'success');
            }
        } catch (error) {
            showStatus(error.message, 'error');
        }
    });
    
    // Escuchar eventos del servidor
    let qrGenerated = false;

socket.on('qr', (qr) => {
    if (!qrGenerated) {
        initBtn.style.display = 'none';
        qrContainer.style.display = 'block';
        logoutBtn.style.display = 'block';
        
        QRCode.toCanvas(qrCodeElement, qr, { width: 200 }, (error) => {
            if (error) {
                console.error('Error generando QR:', error);
                // Intentar nuevamente después de 2 segundos
                setTimeout(() => socket.emit('request-qr'), 2000);
            } else {
                qrGenerated = true;
            }
        });
    }
});
    
    socket.on('authenticated', () => {
        showStatus('Autenticado, esperando conexión...', 'success');
    });
    
    socket.on('ready', () => {
        qrContainer.style.display = 'none';
        messageSection.style.display = 'block';
        showStatus('Conectado a WhatsApp correctamente', 'success');
    });
    
    socket.on('disconnected', (reason) => {
        qrContainer.style.display = 'none';
        messageSection.style.display = 'none';
        logoutBtn.style.display = 'none';
        initBtn.style.display = 'block';
        showStatus(`Desconectado: ${reason}`, 'error');
    });
    
    // Mostrar estado
    function showStatus(message, type) {
        statusElement.textContent = message;
        statusElement.className = type;
    }
});