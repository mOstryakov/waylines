// ChatCore - Основная библиотека для работы с чатами
class ChatCore {
    static VERSION = '1.0.0';
    
    static init() {
        console.log(`🚀 ChatCore v${this.VERSION} инициализирован`);
        this._setupGlobalHandlers();
    }
    
    static _setupGlobalHandlers() {
        // Глобальные обработчики ошибок
        window.addEventListener('error', (e) => {
            console.error('❌ Global error:', e.error);
        });
        
        // Обработчики для Promise rejections
        window.addEventListener('unhandledrejection', (e) => {
            console.error('❌ Unhandled promise rejection:', e.reason);
        });
    }
}

// Утилиты для работы с HTML и текстом
class ChatUtils {
    static escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    static formatTime(date = new Date()) {
        return date.toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit'
        });
    }
    
    static formatDate(date = new Date()) {
        return date.toLocaleDateString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }
    
    static getTimeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (seconds < 60) return 'только что';
        if (minutes < 60) return `${minutes} мин назад`;
        if (hours < 24) return `${hours} ч назад`;
        if (days === 1) return 'вчера';
        if (days < 7) return `${days} дн назад`;
        
        return this.formatDate(new Date(timestamp));
    }
    
    static getCSRFToken() {
        const csrfToken = document.querySelector('[name=csrfmiddlewaretoken]');
        return csrfToken ? csrfToken.value : '';
    }
    
    static generateId() {
        return Date.now().toString() + Math.random().toString(36).substr(2, 9);
    }
    
    static formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    static isValidFileType(file, allowedTypes) {
        if (!file || !allowedTypes) return true;
        return allowedTypes.some(type => file.type.startsWith(type));
    }
    
    static isValidFileSize(file, maxSizeMB = 10) {
        if (!file) return true;
        return file.size <= maxSizeMB * 1024 * 1024;
    }
}

// Управление пользовательским интерфейсом чата
class ChatUI {
    static scrollToBottom(containerSelector = '#chat-messages') {
        const container = document.querySelector(containerSelector);
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }
    
    static updateCharCounter(inputSelector = '#chat-message-input', counterSelector = '#char-counter') {
        const input = document.querySelector(inputSelector);
        const counter = document.querySelector(counterSelector);
        
        if (input && counter) {
            const length = input.value.length;
            counter.textContent = `${length}/1000`;
            
            // Обновляем классы в зависимости от длины
            if (length > 950) {
                counter.className = 'text-danger';
            } else if (length > 800) {
                counter.className = 'text-warning';
            } else if (length > 0) {
                counter.className = 'text-success';
            } else {
                counter.className = 'text-muted';
            }
        }
    }
    
    static updateConnectionStatus(status, message) {
        const statusElement = document.querySelector('#connection-status');
        if (statusElement) {
            statusElement.textContent = message;
            
            const statusClasses = {
                connected: 'text-success',
                disconnected: 'text-warning',
                error: 'text-danger',
                connecting: 'text-info'
            };
            
            statusElement.className = statusClasses[status] || 'text-muted';
        }
    }
    
    static showTypingIndicator(username) {
        const indicator = document.querySelector('#typing-indicator');
        const userElement = document.querySelector('#typing-user');
        
        if (indicator && userElement) {
            userElement.textContent = username;
            indicator.style.display = 'block';
        }
    }
    
    static hideTypingIndicator() {
        const indicator = document.querySelector('#typing-indicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }
    
    static showLoadingIndicator() {
        const indicator = document.querySelector('#chat-loading');
        if (indicator) {
            indicator.style.display = 'block';
        }
    }
    
    static hideLoadingIndicator() {
        const indicator = document.querySelector('#chat-loading');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }
    
    static createMessageElement(messageData, options = {}) {
        const {
            isOwn = false,
            showSender = true,
            animate = true
        } = options;
        
        const messageId = messageData.id || ChatUtils.generateId();
        const senderName = isOwn ? 'Вы' : messageData.sender;
        const timestamp = messageData.created_at || ChatUtils.formatTime(new Date(messageData.timestamp));
        
        let messageContent = '';
        
        switch (messageData.message_type) {
            case 'image':
                messageContent = `
                    <div class="media-message">
                        <img src="${ChatUtils.escapeHtml(messageData.content)}" 
                             alt="Изображение" 
                             class="img-fluid rounded" 
                             style="max-width: 300px;"
                             onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                        <div class="media-error" style="display: none; padding: 20px; text-align: center; color: #6c757d;">
                            <i class="fas fa-exclamation-triangle fa-2x mb-2"></i>
                            <p>Не удалось загрузить изображение</p>
                        </div>
                    </div>
                `;
                break;
                
            case 'video':
                messageContent = `
                    <div class="media-message">
                        <video controls class="img-fluid rounded" style="max-width: 300px;">
                            <source src="${ChatUtils.escapeHtml(messageData.content)}" type="video/mp4">
                            Ваш браузер не поддерживает видео.
                        </video>
                    </div>
                `;
                break;
                
            case 'audio':
            case 'voice':
                messageContent = `
                    <div class="media-message">
                        <audio controls class="w-100">
                            <source src="${ChatUtils.escapeHtml(messageData.content)}" type="audio/mpeg">
                            Ваш браузер не поддерживает аудио.
                        </audio>
                    </div>
                `;
                break;
                
            default:
                messageContent = `
                    <div class="message-content">
                        ${ChatUtils.escapeHtml(messageData.content || messageData.message).replace(/\n/g, '<br>')}
                    </div>
                `;
        }
        
        const messageElement = document.createElement('div');
        messageElement.className = `message-wrapper mb-4 ${isOwn ? 'own-message' : 'other-message'}`;
        messageElement.dataset.messageId = messageId;
        
        if (animate) {
            messageElement.style.animation = 'messageSlideIn 0.3s ease-out';
        }
        
        messageElement.innerHTML = `
            <div class="message-bubble ${isOwn ? 'own-bubble' : 'other-bubble'}">
                ${!isOwn && showSender ? `
                    <div class="message-sender mb-1">
                        <small class="text-primary fw-bold">${ChatUtils.escapeHtml(senderName)}</small>
                    </div>
                ` : ''}
                ${messageContent}
                <div class="message-time text-end mt-1">
                    <small class="${isOwn ? 'text-light' : 'text-muted'}">${timestamp}</small>
                    ${isOwn ? '<i class="fas fa-check-double text-light ms-1" style="font-size: 10px;"></i>' : ''}
                </div>
            </div>
        `;
        
        return messageElement;
    }
    
    static addMessageToChat(messageData, containerSelector = '#chat-messages', options = {}) {
        const container = document.querySelector(containerSelector);
        if (!container) return null;
        
        // Убираем сообщение о пустом чате
        const emptyMessage = container.querySelector('#empty-chat-message');
        if (emptyMessage) {
            emptyMessage.remove();
        }
        
        // Проверяем, нет ли уже такого сообщения
        const existingMessage = container.querySelector(`[data-message-id="${messageData.id}"]`);
        if (existingMessage && !messageData.is_temp) {
            return existingMessage;
        }
        
        const messageElement = this.createMessageElement(messageData, options);
        container.appendChild(messageElement);
        
        this.scrollToBottom(containerSelector);
        return messageElement;
    }
    
    static showEmptyChatMessage(containerSelector = '#chat-messages', options = {}) {
        const {
            title = 'Начните диалог',
            subtitle = 'Отправьте первое сообщение'
        } = options;
        
        const container = document.querySelector(containerSelector);
        if (container) {
            container.innerHTML = `
                <div class="text-center text-muted py-5" id="empty-chat-message">
                    <div class="empty-state-icon mb-4">
                        <i class="fas fa-comments fa-4x text-light"></i>
                    </div>
                    <h4 class="fw-light">${ChatUtils.escapeHtml(title)}</h4>
                    <p class="text-muted">${ChatUtils.escapeHtml(subtitle)}</p>
                </div>
            `;
        }
    }
    
    static clearChat(containerSelector = '#chat-messages') {
        const container = document.querySelector(containerSelector);
        if (container) {
            container.innerHTML = '';
        }
    }
}

// Система уведомлений
class NotificationSystem {
    static show(message, type = 'info', options = {}) {
        const {
            duration = type === 'error' ? 5000 : 3000,
            icon = null,
            action = null
        } = options;
        
        const notificationsContainer = document.querySelector('#notifications');
        if (!notificationsContainer) {
            console.warn('Notifications container not found');
            return null;
        }
        
        const notificationId = 'notification-' + ChatUtils.generateId();
        
        const typeConfig = {
            success: { 
                class: 'notification-success', 
                defaultIcon: 'fa-check-circle',
                duration: 3000
            },
            error: { 
                class: 'notification-error', 
                defaultIcon: 'fa-exclamation-circle',
                duration: 5000
            },
            warning: { 
                class: 'notification-warning', 
                defaultIcon: 'fa-exclamation-triangle',
                duration: 4000
            },
            info: { 
                class: 'notification-info', 
                defaultIcon: 'fa-info-circle',
                duration: 3000
            }
        };
        
        const config = typeConfig[type] || typeConfig.info;
        const finalIcon = icon || config.defaultIcon;
        
        const notification = document.createElement('div');
        notification.id = notificationId;
        notification.className = `notification ${config.class}`;
        
        notification.innerHTML = `
            <div class="notification-content">
                <div class="notification-icon">
                    <i class="fas ${finalIcon}"></i>
                </div>
                <div class="notification-message">${ChatUtils.escapeHtml(message)}</div>
                <button type="button" class="notification-close" onclick="NotificationSystem.close('${notificationId}')">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="notification-progress"></div>
        `;
        
        notificationsContainer.appendChild(notification);
        
        // Анимация появления
        setTimeout(() => notification.classList.add('show'), 10);
        
        // Автоматическое закрытие
        const autoCloseTimeout = setTimeout(() => {
            this.close(notificationId);
        }, duration);
        
        // Сохраняем timeout ID для возможной отмены
        notification._autoCloseTimeout = autoCloseTimeout;
        
        return notificationId;
    }
    
    static close(notificationId) {
        const notification = document.querySelector(`#${notificationId}`);
        if (notification) {
            // Очищаем timeout
            if (notification._autoCloseTimeout) {
                clearTimeout(notification._autoCloseTimeout);
            }
            
            notification.classList.remove('show');
            notification.classList.add('hide');
            
            // Удаляем из DOM после анимации
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 400);
        }
    }
    
    static success(message, options = {}) {
        return this.show(message, 'success', options);
    }
    
    static error(message, options = {}) {
        return this.show(message, 'error', options);
    }
    
    static warning(message, options = {}) {
        return this.show(message, 'warning', options);
    }
    
    static info(message, options = {}) {
        return this.show(message, 'info', options);
    }
}

// Базовый класс для работы с Firebase
class BaseFirebaseChat {
    constructor(chatPath, currentUser, options = {}) {
        if (!firebase) {
            throw new Error('Firebase не загружен');
        }
        
        this.chatPath = chatPath;
        this.currentUser = currentUser;
        this.options = options;
        
        this.database = firebase.database();
        this.messagesRef = this.database.ref(`${chatPath}/messages`);
        this.typingRef = this.database.ref(`${chatPath}/typing`);
        this.usersRef = this.database.ref(`${chatPath}/users`);
        this.connectedRef = this.database.ref('.info/connected');
        
        this.isSending = false;
        this.isInitialized = false;
        
        this._typingTimeout = null;
        this._messageListeners = [];
    }
    
    async init() {
        if (this.isInitialized) {
            console.warn('Чат уже инициализирован');
            return;
        }
        
        try {
            await this._setupConnectionMonitoring();
            await this._setupMessagesListener();
            await this._setupTypingListener();
            await this._setupUsersListener();
            await this._setUserOnline();
            
            this.isInitialized = true;
            console.log('✅ Чат инициализирован:', this.chatPath);
            
        } catch (error) {
            console.error('❌ Ошибка инициализации чата:', error);
            throw error;
        }
    }
    
    async _setupConnectionMonitoring() {
        this.connectedRef.on('value', (snap) => {
            if (snap.val() === true) {
                ChatUI.updateConnectionStatus('connected', 'Подключено');
                this._onConnected();
            } else {
                ChatUI.updateConnectionStatus('disconnected', 'Переподключение...');
                this._onDisconnected();
            }
        });
    }
    
    async _setupMessagesListener() {
        const messageHandler = this.messagesRef
            .orderByChild('timestamp')
            .on('child_added', (snapshot) => {
                const message = snapshot.val();
                this._onMessageReceived(message);
            });
        
        this._messageListeners.push(messageHandler);
    }
    
    async _setupTypingListener() {
        this.typingRef.on('child_changed', (snapshot) => {
            const typingData = snapshot.val();
            if (typingData && typingData.isTyping && typingData.userId !== this.currentUser.id) {
                this._onUserTyping(typingData);
            } else {
                this._onUserStoppedTyping(typingData);
            }
        });
    }
    
    async _setupUsersListener() {
        // Может быть переопределен в дочерних классах
    }
    
    async _setUserOnline() {
        if (this.usersRef) {
            this.usersRef.child(this.currentUser.id).set({
                userId: this.currentUser.id,
                username: this.currentUser.username,
                lastSeen: Date.now(),
                isOnline: true
            });
        }
    }
    
    async sendMessage(messageText, messageType = 'text', mediaFile = null) {
        if (this.isSending) {
            NotificationSystem.warning('Сообщение отправляется...');
            return false;
        }
        
        this.isSending = true;
        
        try {
            let finalContent = messageText;
            let finalMessageType = messageType;
            
            // Обработка медиафайлов
            if (mediaFile) {
                const mediaUrl = await this._uploadMedia(mediaFile, messageType);
                if (!mediaUrl) {
                    throw new Error('Не удалось загрузить медиафайл');
                }
                finalContent = mediaUrl;
                finalMessageType = messageType;
            }
            
            const messageData = {
                id: ChatUtils.generateId(),
                content: finalContent,
                sender: this.currentUser.username,
                sender_id: this.currentUser.id,
                message_type: finalMessageType,
                timestamp: Date.now(),
                created_at: ChatUtils.formatTime()
            };
            
            // Добавляем локально для мгновенного отображения
            this._addLocalMessage({
                ...messageData,
                is_own: true,
                is_temp: true
            });
            
            // Отправляем в Firebase
            await this.messagesRef.child(messageData.id).set(messageData);
            
            this._onMessageSent(messageData);
            return true;
            
        } catch (error) {
            console.error('❌ Ошибка отправки сообщения:', error);
            NotificationSystem.error('Ошибка отправки сообщения');
            return false;
            
        } finally {
            this.isSending = false;
        }
    }
    
    async _uploadMedia(file, messageType) {
        // Базовая реализация - должна быть переопределена
        console.log('Загрузка медиафайла:', file.name, messageType);
        
        // Для демонстрации возвращаем fake URL
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                resolve(e.target.result); // Data URL для демонстрации
            };
            reader.readAsDataURL(file);
        });
    }
    
    async loadMessageHistory(limit = 50) {
        try {
            ChatUI.showLoadingIndicator();
            
            const snapshot = await this.messagesRef
                .orderByChild('timestamp')
                .limitToLast(limit)
                .once('value');
            
            const messages = [];
            snapshot.forEach((childSnapshot) => {
                messages.push(childSnapshot.val());
            });
            
            // Сортируем по времени (старые первыми)
            messages.sort((a, b) => a.timestamp - b.timestamp);
            
            this._renderMessageHistory(messages);
            
            return messages;
            
        } catch (error) {
            console.error('Ошибка загрузки истории:', error);
            NotificationSystem.error('Ошибка загрузки истории сообщений');
            return [];
            
        } finally {
            ChatUI.hideLoadingIndicator();
        }
    }
    
    setTyping(isTyping) {
        if (!this.currentUser.id) return;
        
        if (isTyping) {
            this.typingRef.child(this.currentUser.id).set({
                isTyping: true,
                userId: this.currentUser.id,
                username: this.currentUser.username,
                timestamp: Date.now()
            });
            
            // Очищаем предыдущий таймаут
            if (this._typingTimeout) {
                clearTimeout(this._typingTimeout);
            }
            
            // Автоматически останавливаем индикатор через 3 секунды
            this._typingTimeout = setTimeout(() => {
                this.setTyping(false);
            }, 3000);
            
        } else {
            this.typingRef.child(this.currentUser.id).remove();
            
            if (this._typingTimeout) {
                clearTimeout(this._typingTimeout);
                this._typingTimeout = null;
            }
        }
    }
    
    // Методы обработки событий (могут быть переопределены)
    _onMessageReceived(message) {
        console.log('📨 Получено сообщение:', message);
        this._addLocalMessage(message);
    }
    
    _onMessageSent(message) {
        console.log('✅ Сообщение отправлено:', message);
    }
    
    _onUserTyping(typingData) {
        console.log('✍️ Пользователь печатает:', typingData.username);
        ChatUI.showTypingIndicator(typingData.username);
    }
    
    _onUserStoppedTyping(typingData) {
        console.log('💤 Пользователь перестал печатать:', typingData?.username);
        ChatUI.hideTypingIndicator();
    }
    
    _onConnected() {
        console.log('🔗 Подключено к чату');
    }
    
    _onDisconnected() {
        console.log('🔌 Отключено от чата');
    }
    
    _addLocalMessage(messageData) {
        const isOwn = messageData.sender_id === this.currentUser.id;
        
        ChatUI.addMessageToChat(messageData, '#chat-messages', {
            isOwn: isOwn,
            showSender: !isOwn,
            animate: true
        });
    }
    
    _renderMessageHistory(messages) {
        ChatUI.clearChat('#chat-messages');
        
        if (messages.length === 0) {
            this._showEmptyState();
            return;
        }
        
        messages.forEach(message => {
            this._addLocalMessage(message);
        });
    }
    
    _showEmptyState() {
        ChatUI.showEmptyChatMessage('#chat-messages', {
            title: 'Начните диалог',
            subtitle: 'Отправьте первое сообщение'
        });
    }
    
    destroy() {
        // Отписываемся от всех listeners
        this._messageListeners.forEach(listener => {
            if (this.messagesRef && typeof listener === 'function') {
                this.messagesRef.off('child_added', listener);
            }
        });
        
        if (this.typingRef) this.typingRef.off();
        if (this.usersRef) this.usersRef.off();
        if (this.connectedRef) this.connectedRef.off();
        
        // Очищаем таймауты
        if (this._typingTimeout) {
            clearTimeout(this._typingTimeout);
        }
        
        this.isInitialized = false;
        console.log('🗑️ Чат уничтожен:', this.chatPath);
    }
}

// Менеджер медиафайлов
class MediaManager {
    static async takePhoto() {
        return new Promise((resolve, reject) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.capture = 'environment';
            
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    resolve(file);
                } else {
                    reject(new Error('Файл не выбран'));
                }
            };
            
            input.oncancel = () => {
                reject(new Error('Отменено пользователем'));
            };
            
            input.click();
        });
    }
    
    static async recordAudio(duration = 30000) {
        return new Promise(async (resolve, reject) => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                const mediaRecorder = new MediaRecorder(stream);
                const audioChunks = [];
                
                mediaRecorder.ondataavailable = (event) => {
                    audioChunks.push(event.data);
                };
                
                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
                    stream.getTracks().forEach(track => track.stop());
                    resolve(audioBlob);
                };
                
                mediaRecorder.onerror = (event) => {
                    stream.getTracks().forEach(track => track.stop());
                    reject(new Error('Ошибка записи аудио'));
                };
                
                mediaRecorder.start();
                
                // Автоматическая остановка через указанное время
                setTimeout(() => {
                    if (mediaRecorder.state === 'recording') {
                        mediaRecorder.stop();
                    }
                }, duration);
                
            } catch (error) {
                reject(new Error('Не удалось получить доступ к микрофону'));
            }
        });
    }
    
    static validateFile(file, options = {}) {
        const {
            maxSizeMB = 10,
            allowedTypes = ['image/', 'video/', 'audio/']
        } = options;
        
        if (!file) {
            return { isValid: false, error: 'Файл не выбран' };
        }
        
        if (!ChatUtils.isValidFileType(file, allowedTypes)) {
            return { isValid: false, error: 'Неподдерживаемый тип файла' };
        }
        
        if (!ChatUtils.isValidFileSize(file, maxSizeMB)) {
            return { 
                isValid: false, 
                error: `Файл слишком большой. Максимальный размер: ${maxSizeMB}MB` 
            };
        }
        
        return { isValid: true, error: null };
    }
    
    static createFilePreview(file) {
        return new Promise((resolve) => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    resolve({
                        type: 'image',
                        url: e.target.result,
                        name: file.name,
                        size: file.size
                    });
                };
                reader.readAsDataURL(file);
                
            } else if (file.type.startsWith('video/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    resolve({
                        type: 'video',
                        url: e.target.result,
                        name: file.name,
                        size: file.size
                    });
                };
                reader.readAsDataURL(file);
                
            } else if (file.type.startsWith('audio/')) {
                resolve({
                    type: 'audio',
                    name: file.name,
                    size: file.size
                });
                
            } else {
                resolve({
                    type: 'file',
                    name: file.name,
                    size: file.size
                });
            }
        });
    }
}

// Инициализация библиотеки
ChatCore.init();

// Глобальные алиасы для обратной совместимости
window.ChatUtils = ChatUtils;
window.ChatUI = ChatUI;
window.NotificationSystem = NotificationSystem;
window.BaseFirebaseChat = BaseFirebaseChat;
window.MediaManager = MediaManager;

// Функции уведомлений для обратной совместимости
window.showError = (message) => NotificationSystem.error(message);
window.showSuccess = (message) => NotificationSystem.success(message);
window.showWarning = (message) => NotificationSystem.warning(message);
window.showInfo = (message) => NotificationSystem.info(message);

console.log('🎉 ChatCore загружен и готов к работе!');