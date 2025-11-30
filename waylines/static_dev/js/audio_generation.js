// audio_generation.js
class AudioGenerationManager {
    constructor() {
        this.currentPointId = null;
        this.currentAudioUrl = null;
        this.generationStatusInterval = null;
        this.initEventListeners();
    }

    initEventListeners() {
        // Проверяем что элементы существуют перед добавлением обработчиков
        const generateBtn = document.querySelector('.generate-audio-btn');
        const confirmBtn = document.getElementById('confirm-generate-audio');
        
        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.openAudioSettings());
        }
        
        if (confirmBtn) {
            confirmBtn.addEventListener('click', () => this.generateAudio());
        }

        // Делегирование для динамических элементов
        document.addEventListener('click', (e) => {
            if (e.target.closest('.regenerate-audio-btn')) {
                this.openAudioSettings();
            }
            if (e.target.closest('.delete-audio-btn')) {
                this.deleteAudio();
            }
            if (e.target.closest('.retry-audio-btn')) {
                this.openAudioSettings();
            }
        });

        // Закрытие модального окна при успешной генерации
        document.getElementById('audioSettingsModal')?.addEventListener('hidden.bs.modal', () => {
            // Сброс состояния если нужно
        });
    }

    showAudioExists(audioUrl, metadata = {}) {
        this.hideAllSections();
        this.currentAudioUrl = audioUrl;
        
        const audioPlayer = document.getElementById('point-audio-player');
        if (audioPlayer) {
            audioPlayer.src = audioUrl;
            audioPlayer.load();
        }

        // Безопасное обновление информации
        const voiceInfo = document.getElementById('audio-voice-info');
        const languageInfo = document.getElementById('audio-language-info');
        const audioExistsSection = document.getElementById('audio-exists-section');
        const statusBadge = document.getElementById('audio-status-badge');

        if (voiceInfo && metadata.voice_type) {
            voiceInfo.textContent = this.getVoiceDisplayName(metadata.voice_type);
        }
        if (languageInfo && metadata.language) {
            languageInfo.textContent = this.getLanguageDisplayName(metadata.language);
        }
        if (audioExistsSection) {
            audioExistsSection.style.display = 'block';
        }
        if (statusBadge) {
            statusBadge.textContent = 'Сгенерирован';
            statusBadge.className = 'badge bg-success bg-opacity-10 text-success small';
        }
    }

    // Показывает аудио контролы для конкретной точки
    showAudioForPoint(pointId, pointData) {
        this.currentPointId = pointId;
        
        // Проверяем есть ли уже аудио
        if (pointData.audio_guide) {
            this.showAudioExists(pointData.audio_guide, pointData.audio_metadata);
        } else {
            this.showNoAudio();
        }
    }

    showNoAudio() {
        this.hideAllSections();
        document.getElementById('no-audio-section').style.display = 'block';
        document.getElementById('audio-status-badge').textContent = 'Не сгенерирован';
        document.getElementById('audio-status-badge').className = 'badge bg-secondary bg-opacity-10 text-secondary small';
    }

    showAudioExists(audioUrl, metadata = {}) {
        this.hideAllSections();
        this.currentAudioUrl = audioUrl;
        
        const audioPlayer = document.getElementById('point-audio-player');
        if (audioPlayer) {
            audioPlayer.src = audioUrl;
            audioPlayer.load();
        }

        // Обновляем информацию
        if (metadata.voice_type) {
            document.getElementById('audio-voice-info').textContent = this.getVoiceDisplayName(metadata.voice_type);
        }
        if (metadata.language) {
            document.getElementById('audio-language-info').textContent = this.getLanguageDisplayName(metadata.language);
        }

        document.getElementById('audio-exists-section').style.display = 'block';
        document.getElementById('audio-status-badge').textContent = 'Сгенерирован';
        document.getElementById('audio-status-badge').className = 'badge bg-success bg-opacity-10 text-success small';
    }

    showGenerating() {
        this.hideAllSections();
        document.getElementById('audio-generating-section').style.display = 'block';
        document.getElementById('audio-status-badge').textContent = 'Генерация...';
        document.getElementById('audio-status-badge').className = 'badge bg-warning bg-opacity-10 text-warning small';
    }

    showError(errorMessage) {
        this.hideAllSections();
        document.getElementById('audio-error-message').textContent = errorMessage;
        document.getElementById('audio-error-section').style.display = 'block';
        document.getElementById('audio-status-badge').textContent = 'Ошибка';
        document.getElementById('audio-status-badge').className = 'badge bg-danger bg-opacity-10 text-danger small';
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

    openAudioSettings() {
        // Можно добавить сохранение предпочтений пользователя
        const modal = new bootstrap.Modal(document.getElementById('audioSettingsModal'));
        modal.show();
    }

    async generateAudio() {
        if (!this.currentPointId) return;

        const voiceType = document.getElementById('audio-voice-select').value;
        const language = document.getElementById('audio-language-select').value;
        
        this.showGenerating();
        
        try {
            // 🔧 ИСПРАВЛЕННЫЙ URL - используем правильный endpoint из ai_audio
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

            if (data.status === 'success') {
                // Закрываем модальное окно
                const modal = bootstrap.Modal.getInstance(document.getElementById('audioSettingsModal'));
                if (modal) modal.hide();
                
                // Периодически проверяем статус
                this.checkGenerationStatus(data.generation_id);
            } else {
                throw new Error(data.message || 'Ошибка генерации');
            }

        } catch (error) {
            console.error('Audio generation error:', error);
            this.showError(error.message);
        }
    }

    async checkGenerationStatus(generationId) {
        // Очищаем предыдущий интервал
        if (this.generationStatusInterval) {
            clearTimeout(this.generationStatusInterval);
        }

        const maxAttempts = 30;
        let attempts = 0;

        const checkStatus = async () => {
            if (attempts >= maxAttempts) {
                this.showError('Превышено время ожидания генерации (60 секунд)');
                this.generationStatusInterval = null;
                return;
            }

            try {
                // 🔧 ИСПРАВЛЕННЫЙ URL для проверки статуса
                const response = await fetch(`/audio/status/${generationId}/`);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                
                const data = await response.json();

                if (data.status === 'completed') {
                    this.showAudioExists(data.audio_url, {
                        voice_type: document.getElementById('audio-voice-select').value,
                        language: document.getElementById('audio-language-select').value
                    });
                    
                    if (window.routeEditor && window.routeEditor.updatePointAudio) {
                        window.routeEditor.updatePointAudio(this.currentPointId, data.audio_url);
                    }
                    this.generationStatusInterval = null;
                    
                } else if (data.status === 'failed') {
                    this.showError(data.error_message || 'Ошибка генерации аудио');
                    this.generationStatusInterval = null;
                } else {
                    attempts++;
                    this.generationStatusInterval = setTimeout(checkStatus, 2000);
                }
            } catch (error) {
                console.error('Status check error:', error);
                attempts++;
                
                if (attempts < maxAttempts) {
                    this.generationStatusInterval = setTimeout(checkStatus, 2000);
                } else {
                    this.showError('Не удалось проверить статус генерации');
                    this.generationStatusInterval = null;
                }
            }
        };

        checkStatus();
    }

    async deleteAudio() {
        if (!this.currentPointId || !confirm('Удалить сгенерированное аудио?')) {
            return;
        }

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
                
                // Обновляем основную точку
                if (window.routeEditor && window.routeEditor.updatePointAudio) {
                    window.routeEditor.updatePointAudio(this.currentPointId, null);
                }
                
                // Сбрасываем текущий URL аудио
                this.currentAudioUrl = null;
                
            } else {
                const errorData = await response.json();
                throw new Error(errorData.message || 'Ошибка удаления аудио');
            }

        } catch (error) {
            console.error('Delete audio error:', error);
            this.showError('Ошибка удаления аудио: ' + error.message);
        }
    }

    openAudioSettings() {
        try {
            const modalElement = document.getElementById('audioSettingsModal');
            if (!modalElement) {
                throw new Error('Модальное окно настроек не найдено');
            }
            
            const modal = bootstrap.Modal.getInstance(modalElement) || new bootstrap.Modal(modalElement);
            modal.show();
        } catch (error) {
            console.error('Error opening audio settings:', error);
            // Fallback - генерируем сразу с настройками по умолчанию
            this.generateAudioWithDefaults();
        }
    }

    generateAudioWithDefaults() {
        const voiceType = document.getElementById('audio-voice-select')?.value || 'alloy';
        const language = document.getElementById('audio-language-select')?.value || 'auto';
        this.generateAudioWithParams(voiceType, language);
    }

    cancelGenerationStatusCheck() {
        if (this.generationStatusInterval) {
            clearTimeout(this.generationStatusInterval);
            this.generationStatusInterval = null;
        }
    }

    getVoiceDisplayName(voiceType) {
        const voices = {
            'alloy': 'Alloy',
            'echo': 'Echo', 
            'nova': 'Nova',
            'onyx': 'Onyx',
            'fable': 'Fable',
            'shimmer': 'Shimmer'
        };
        return voices[voiceType] || voiceType;
    }

    getLanguageDisplayName(language) {
        const languages = {
            'auto': 'Авто',
            'ru-RU': 'Русский',
            'en-US': 'Английский',
            'es-ES': 'Испанский',
            'fr-FR': 'Французский'
        };
        return languages[language] || language;
    }

    getCsrfToken() {
        return document.querySelector('[name=csrfmiddlewaretoken]')?.value || '';
    }
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', function() {
    window.audioGenerationManager = new AudioGenerationManager();
});