// audio_generation.js
class AudioGenerationManager {
    constructor() {
        this.currentPointId = null;
        this.currentAudioUrl = null;
        this.generationStatusInterval = null;
        this.modalIsOpening = false;
        this.initEventListeners();
    }

    initEventListeners() {
        console.log('🎵 Setting up audio event listeners...');

        // Удаляем все существующие обработчики перед добавлением новых
        this.removeAllEventListeners();

        // Делегирование событий для всех кнопок аудио
        document.addEventListener('click', (e) => {
            if (e.target.closest('.generate-audio-btn')) {
                e.preventDefault();
                e.stopPropagation();
                console.log('🎵 Generate button clicked');
                this.openAudioSettings();
            }
            else if (e.target.closest('.regenerate-audio-btn')) {
                e.preventDefault();
                e.stopPropagation();
                console.log('🎵 Regenerate button clicked');
                this.openAudioSettings();
            }
            else if (e.target.closest('.delete-audio-btn')) {
                e.preventDefault();
                e.stopPropagation();
                console.log('🎵 Delete button clicked');
                this.deleteAudio();
            }
            else if (e.target.closest('.retry-audio-btn')) {
                e.preventDefault();
                e.stopPropagation();
                console.log('🎵 Retry button clicked');
                this.openAudioSettings();
            }
        });

        // Обработчик для кнопки подтверждения в модальном окне
        const confirmBtn = document.getElementById('confirm-generate-audio');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🎵 Confirm generate clicked');
                this.generateAudio();
            });
        }

        console.log('🎵 Audio event listeners setup complete');
    }

    removeAllEventListeners() {
        // Клонируем и заменяем элементы чтобы удалить все обработчики
        const elementsToClean = [
            '.generate-audio-btn',
            '.regenerate-audio-btn', 
            '.delete-audio-btn',
            '.retry-audio-btn',
            '#confirm-generate-audio'
        ];

        elementsToClean.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                if (element.parentNode) {
                    const newElement = element.cloneNode(true);
                    element.parentNode.replaceChild(newElement, element);
                }
            });
        });
    }

    // Показывает аудио контролы для конкретной точки
    showAudioForPoint(pointId, pointData) {
        console.log(`🎵 Showing audio for point: ${pointId}`);
        this.currentPointId = pointId;
        
        if (pointData && pointData.audio_guide) {
            this.showAudioExists(pointData.audio_guide, pointData.audio_metadata);
        } else {
            this.showNoAudio();
        }
    }

    showNoAudio() {
        this.hideAllSections();
        const section = document.getElementById('no-audio-section');
        const badge = document.getElementById('audio-status-badge');
        
        if (section) section.style.display = 'block';
        if (badge) {
            badge.textContent = 'Не сгенерирован';
            badge.className = 'badge bg-secondary bg-opacity-10 text-secondary small';
        }
    }

    showAudioExists(audioUrl, metadata = {}) {
        this.hideAllSections();
        this.currentAudioUrl = audioUrl;
        
        // Настраиваем аудиоплеер
        const audioPlayer = document.getElementById('point-audio-player');
        if (audioPlayer && audioUrl) {
            audioPlayer.src = audioUrl;
            audioPlayer.load().catch(e => console.error('Audio load error:', e));
        }

        // Обновляем информацию
        this.updateAudioInfo(metadata);
        
        const section = document.getElementById('audio-exists-section');
        const badge = document.getElementById('audio-status-badge');
        
        if (section) section.style.display = 'block';
        if (badge) {
            badge.textContent = 'Сгенерирован';
            badge.className = 'badge bg-success bg-opacity-10 text-success small';
        }
    }

    showGenerating() {
        this.hideAllSections();
        const section = document.getElementById('audio-generating-section');
        const badge = document.getElementById('audio-status-badge');
        
        if (section) section.style.display = 'block';
        if (badge) {
            badge.textContent = 'Генерация...';
            badge.className = 'badge bg-warning bg-opacity-10 text-warning small';
        }
    }

    showError(errorMessage) {
        this.hideAllSections();
        const errorElement = document.getElementById('audio-error-message');
        const section = document.getElementById('audio-error-section');
        const badge = document.getElementById('audio-status-badge');
        
        if (errorElement) errorElement.textContent = errorMessage;
        if (section) section.style.display = 'block';
        if (badge) {
            badge.textContent = 'Ошибка';
            badge.className = 'badge bg-danger bg-opacity-10 text-danger small';
        }
    }

    hideAllSections() {
        const sections = [
            'no-audio-section',
            'audio-exists-section', 
            'audio-generating-section',
            'audio-error-section'
        ];
        
        sections.forEach(sectionId => {
            const section = document.getElementById(sectionId);
            if (section) section.style.display = 'none';
        });
    }

    updateAudioInfo(metadata) {
        const voiceInfo = document.getElementById('audio-voice-info');
        const languageInfo = document.getElementById('audio-language-info');
        
        if (voiceInfo && metadata.voice_type) {
            voiceInfo.textContent = this.getVoiceDisplayName(metadata.voice_type);
        }
        if (languageInfo && metadata.language) {
            languageInfo.textContent = this.getLanguageDisplayName(metadata.language);
        }
    }

    openAudioSettings() {
        console.log('🎵 Opening audio settings modal');
        
        // Защита от множественных вызовов
        if (this.modalIsOpening) {
            console.log('🎵 Modal already opening, skipping');
            return;
        }
        
        if (!this.currentPointId) {
            this.showError('Сначала выберите точку маршрута');
            return;
        }
        
        this.modalIsOpening = true;
        
        // 🔥 ИСПОЛЬЗУЕМ ПРОСТОЙ ДИАЛОГ ВМЕСТО BOOTSTRAP MODAL
        this.showSimpleAudioDialog();
    }

    showSimpleAudioDialog() {
        console.log('🎵 Using simple audio dialog');
        
        // Получаем текущие значения
        const currentVoice = document.getElementById('audio-voice-select')?.value || 'alloy';
        const currentLanguage = document.getElementById('audio-language-select')?.value || 'auto';
        
        const dialogHtml = `
            <div id="simple-audio-dialog" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; z-index: 1050;">
                <div style="background: white; padding: 24px; border-radius: 12px; width: 90%; max-width: 380px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); border: 1px solid #e0e0e0;">
                    <div style="display: flex; justify-content: between; align-items: center; margin-bottom: 20px;">
                        <h5 style="margin: 0; color: #333; font-weight: 600;">Настройки аудио</h5>
                        <button type="button" id="simple-dialog-close" style="background: none; border: none; font-size: 18px; cursor: pointer; color: #666; padding: 0; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center;">×</button>
                    </div>
                    
                    <div style="margin-bottom: 20px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #555; font-size: 14px;">Голос</label>
                        <select id="simple-voice-select" style="width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; background: white; font-size: 14px; color: #333;">
                            <option value="alloy">Alloy (нейтральный)</option>
                            <option value="echo">Echo (мужской)</option>
                            <option value="nova">Nova (женский)</option>
                            <option value="onyx">Onyx (глубокий)</option>
                            <option value="fable">Fable (сказочный)</option>
                            <option value="shimmer">Shimmer (легкий)</option>
                        </select>
                    </div>
                    
                    <div style="margin-bottom: 24px;">
                        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #555; font-size: 14px;">Язык</label>
                        <select id="simple-language-select" style="width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; background: white; font-size: 14px; color: #333;">
                            <option value="auto">Автоопределение</option>
                            <option value="ru-RU">Русский</option>
                            <option value="en-US">Английский</option>
                            <option value="es-ES">Испанский</option>
                            <option value="fr-FR">Французский</option>
                        </select>
                    </div>
                    
                    <div style="display: flex; gap: 12px;">
                        <button type="button" id="simple-dialog-cancel" style="flex: 1; padding: 10px 16px; background: #6c757d; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer;">Отмена</button>
                        <button type="button" id="simple-dialog-confirm" style="flex: 1; padding: 10px 16px; background: #007bff; color: white; border: none; border-radius: 6px; font-size: 14px; font-weight: 500; cursor: pointer;">
                            Сгенерировать
                        </button>
                    </div>
                </div>
            </div>
        `;
        
        // Удаляем существующий диалог если есть
        const existingDialog = document.getElementById('simple-audio-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }
        
        // Добавляем новый диалог
        document.body.insertAdjacentHTML('beforeend', dialogHtml);
        
        // Устанавливаем текущие значения
        const voiceSelect = document.getElementById('simple-voice-select');
        const languageSelect = document.getElementById('simple-language-select');
        
        if (voiceSelect) voiceSelect.value = currentVoice;
        if (languageSelect) languageSelect.value = currentLanguage;
        
        // Добавляем обработчики для диалога
        this.setupSimpleDialogHandlers();
        
        this.modalIsOpening = false;
    }

    setupSimpleDialogHandlers() {
        const closeBtn = document.getElementById('simple-dialog-close');
        const cancelBtn = document.getElementById('simple-dialog-cancel');
        const confirmBtn = document.getElementById('simple-dialog-confirm');
        const dialog = document.getElementById('simple-audio-dialog');
        
        const closeDialog = () => {
            if (dialog) {
                dialog.remove();
            }
        };
        
        if (closeBtn) {
            closeBtn.addEventListener('click', closeDialog);
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', closeDialog);
        }
        
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => {
                const voiceType = document.getElementById('simple-voice-select')?.value || 'alloy';
                const language = document.getElementById('simple-language-select')?.value || 'auto';
                
                // Обновляем основные селекты
                const mainVoiceSelect = document.getElementById('audio-voice-select');
                const mainLanguageSelect = document.getElementById('audio-language-select');
                
                if (mainVoiceSelect) mainVoiceSelect.value = voiceType;
                if (mainLanguageSelect) mainLanguageSelect.value = language;
                
                closeDialog();
                this.generateAudio();
            });
        }
        
        // Закрытие по клику на фон
        if (dialog) {
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    closeDialog();
                }
            });
        }
        
        // Закрытие по ESC
        const handleEscape = (e) => {
            if (e.key === 'Escape') {
                closeDialog();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }

    async generateAudio() {
        console.log('🎵 Starting audio generation for point:', this.currentPointId);
        
        if (!this.currentPointId) {
            this.showError('Не выбрана точка маршрута');
            return;
        }

        const voiceType = document.getElementById('audio-voice-select')?.value || 'alloy';
        const language = document.getElementById('audio-language-select')?.value || 'auto';
        
        this.showGenerating();
        
        try {
            const response = await fetch(`/audio/generate/${this.currentPointId}/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCsrfToken()
                },
                body: JSON.stringify({
                    voice_type: voiceType,
                    language: language
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log('🎵 Generation response:', data);

            if (data.status === 'success') {
                this.checkGenerationStatus(data.generation_id);
            } else {
                throw new Error(data.message || 'Ошибка генерации');
            }

        } catch (error) {
            console.error('🎵 Audio generation error:', error);
            this.showError(this.getUserFriendlyError(error));
        }
    }

    async checkGenerationStatus(generationId) {
        console.log('🎵 Checking generation status:', generationId);
        
        this.cancelGenerationStatusCheck();

        const maxAttempts = 30;
        let attempts = 0;

        const checkStatus = async () => {
            if (attempts >= maxAttempts) {
                this.showError('Превышено время ожидания генерации (60 секунд)');
                return;
            }

            try {
                const response = await fetch(`/audio/status/${generationId}/`);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();
                console.log('🎵 Status check response:', data);

                if (data.status === 'completed') {
                    console.log('✅ Audio generation completed');
                    this.showAudioExists(data.audio_url, {
                        voice_type: document.getElementById('audio-voice-select')?.value,
                        language: document.getElementById('audio-language-select')?.value
                    });
                    
                    if (window.routeEditor && window.routeEditor.updatePointAudio) {
                        window.routeEditor.updatePointAudio(this.currentPointId, data.audio_url);
                    }
                    
                } else if (data.status === 'failed') {
                    this.showError(data.error_message || 'Ошибка генерации аудио');
                } else {
                    attempts++;
                    this.generationStatusInterval = setTimeout(checkStatus, 2000);
                }
            } catch (error) {
                console.error('🎵 Status check error:', error);
                attempts++;
                
                if (attempts < maxAttempts) {
                    this.generationStatusInterval = setTimeout(checkStatus, 2000);
                } else {
                    this.showError('Не удалось проверить статус генерации');
                }
            }
        };

        checkStatus();
    }

    cancelGenerationStatusCheck() {
        if (this.generationStatusInterval) {
            clearTimeout(this.generationStatusInterval);
            this.generationStatusInterval = null;
        }
    }

    async deleteAudio() {
        if (!this.currentPointId) {
            this.showError('Не выбрана точка маршрута');
            return;
        }

        if (!confirm('Удалить сгенерированное аудио?')) {
            return;
        }

        console.log('🗑️ Deleting audio for point:', this.currentPointId);

        try {
            const response = await fetch(`/audio/delete/${this.currentPointId}/`, {
                method: 'DELETE',
                headers: {
                    'X-CSRFToken': this.getCsrfToken(),
                    'Content-Type': 'application/json'
                }
            });

            if (response.ok) {
                this.showNoAudio();
                this.currentAudioUrl = null;
                
                if (window.routeEditor && window.routeEditor.updatePointAudio) {
                    window.routeEditor.updatePointAudio(this.currentPointId, null);
                }
                
                console.log('✅ Audio deleted successfully');
            } else {
                throw new Error('Ошибка удаления аудио');
            }

        } catch (error) {
            console.error('🎵 Delete audio error:', error);
            this.showError('Ошибка удаления аудио');
        }
    }

    getVoiceDisplayName(voiceType) {
        const voices = {
            'alloy': 'Alloy (нейтральный)',
            'echo': 'Echo (мужской)', 
            'nova': 'Nova (женский)',
            'onyx': 'Onyx (глубокий)',
            'fable': 'Fable (сказочный)',
            'shimmer': 'Shimmer (легкий)'
        };
        return voices[voiceType] || voiceType;
    }

    getLanguageDisplayName(language) {
        const languages = {
            'auto': 'Автоопределение',
            'ru-RU': 'Русский',
            'en-US': 'Английский',
            'es-ES': 'Испанский',
            'fr-FR': 'Французский'
        };
        return languages[language] || language;
    }

    getUserFriendlyError(error) {
        if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
            return 'Проблемы с подключением к серверу';
        }
        if (error.message.includes('500')) {
            return 'Внутренняя ошибка сервера';
        }
        if (error.message.includes('404')) {
            return 'Сервис генерации аудио временно недоступен';
        }
        return error.message;
    }

    getCsrfToken() {
        return document.querySelector('[name=csrfmiddlewaretoken]')?.value || '';
    }
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    console.log('🎵 DOM loaded, initializing Audio Generation Manager...');
    window.audioGenerationManager = new AudioGenerationManager();
});