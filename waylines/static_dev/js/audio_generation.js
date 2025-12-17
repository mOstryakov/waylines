    // static/js/audio_generation.js
    class AudioGenerationManager {
        constructor() {
            this.currentPointId = null;
            this.currentPointIndex = null;
            this.audioUrl = null;
            this.isGenerating = false;
            this.audioElement = null;
            
            this.init();
        }

        init() {
            console.log('🎵 Инициализация AudioGenerationManager');
            this.setupEventListeners();
            this.setupAudioElement();
        }

        setupEventListeners() {
            // Кнопка "Использовать текст описания"
            document.getElementById('use-description-text')?.addEventListener('click', (e) => {
                e.preventDefault();
                this.useDescriptionText();
            });

            // Кнопка "Сгенерировать AI-аудио"
            document.getElementById('generate-ai-audio')?.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.generateAudio();
            });

            // Кнопка "Повторить" при ошибке
            document.getElementById('retry-ai-generation')?.addEventListener('click', (e) => {
                e.preventDefault();
                this.generateAudio();
            });

            // Слушаем изменения в поле описания
            document.getElementById('point-description')?.addEventListener('input', () => {
                this.syncDescriptionToPreview();
            });

            // Кнопки управления аудиоплеером
            document.getElementById('re-record-audio')?.addEventListener('click', (e) => {
                e.preventDefault();
                this.resetAudio();
            });

            document.getElementById('remove-audio')?.addEventListener('click', (e) => {
                e.preventDefault();
                this.removeAudio();
            });

            // Переключатель аудиогида
            document.getElementById('enable-audio-guide')?.addEventListener('change', (e) => {
                this.handleAudioToggle(e.target.checked);
            });
        }

        setupAudioElement() {
            // Создаем скрытый аудио элемент если его нет
            if (!document.getElementById('audio-player-element')) {
                this.audioElement = document.createElement('audio');
                this.audioElement.id = 'audio-player-element';
                this.audioElement.style.display = 'none';
                document.body.appendChild(this.audioElement);
            } else {
                this.audioElement = document.getElementById('audio-player-element');
            }
        }

        // Вызывается из RouteEditor при открытии точки
        setupForPoint(pointId, pointIndex, pointData = null) {
            console.log('🎵 Настройка аудио для точки:', pointId, pointData);
            this.currentPointId = pointId;
            this.currentPointIndex = pointIndex;
            
            // Сброс состояния UI
            this.resetGenerationUI();
            
            // Предзаполняем текст из описания точки
            if (pointData?.description) {
                const preview = document.getElementById('ai-text-preview');
                if (preview) {
                    preview.textContent = pointData.description;
                }
            } else {
                this.syncDescriptionToPreview();
            }
            
            // Если у точки уже есть аудио, показываем плеер
            if (pointData?.audio_url) {
                this.showAudioPlayer(pointData.audio_url, pointData.audio_filename || 'Аудиогид точки');
            }
            
            // Сброс состояния генерации
            this.hideGenerationProgress();
            this.hideGenerationError();
            this.hideGenerationSuccess();
        }

        useDescriptionText() {
            const descriptionField = document.getElementById('point-description');
            const preview = document.getElementById('ai-text-preview');
            
            if (descriptionField && preview) {
                const desc = descriptionField.value.trim();
                if (desc) {
                    preview.textContent = desc;
                    this.showToast('Текст загружен в область генерации', 'info');
                } else {
                    this.showToast('Описание точки пустое', 'warning');
                }
            }
        }

        syncDescriptionToPreview() {
            const descriptionField = document.getElementById('point-description');
            const preview = document.getElementById('ai-text-preview');
            
            if (descriptionField && preview) {
                const desc = descriptionField.value.trim();
                // Обновляем только если превью пустое
                if (desc && (!preview.textContent || preview.textContent.trim() === '')) {
                    preview.textContent = desc;
                }
            }
        }

        async generateAudio() {
            // Проверяем, что точка сохранена
            if (!this.currentPointId || this.currentPointId <= 0) {
                this.showToast('Сначала сохраните точку, затем сгенерируйте аудио', 'warning');
                return;
            }

            const text = document.getElementById('ai-text-preview')?.textContent.trim();
            if (!text) {
                this.showToast('Текст для генерации пуст', 'warning');
                return;
            }

            if (text.length > 5000) {
                this.showToast('Текст слишком длинный (максимум 5000 символов)', 'warning');
                return;
            }

            if (this.isGenerating) {
                return;
            }

            this.isGenerating = true;
            this.showGenerationProgress();

            try {
                const voice = document.getElementById('ai-voice-select')?.value || 'alloy';
                const language = document.getElementById('ai-language-select')?.value || 'ru-RU';
                const csrfToken = this.getCsrfToken();

                console.log('🎵 Отправка запроса на генерацию аудио:', {
                    pointId: this.currentPointId,
                    textLength: text.length,
                    voice,
                    language
                });

                const response = await fetch(`/api/ai-audio/generate/${this.currentPointId}/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': csrfToken
                    },
                    body: JSON.stringify({
                        text: text,
                        voice_type: voice,
                        language: language
                    })
                });

                const data = await response.json();
                
                if (response.ok && data.status === 'success') {
                    // Успешная генерация
                    this.audioUrl = data.audio_url;
                    const filename = `AI-аудиогид_${new Date().toLocaleDateString('ru-RU')}.mp3`;
                    
                    this.showAudioPlayer(data.audio_url, filename);
                    this.showGenerationSuccess();
                    
                    // Обновляем RouteEditor
                    if (window.routeEditor?.updatePointAudio) {
                        window.routeEditor.updatePointAudio(this.currentPointId, data.audio_url, filename);
                    }
                    
                    this.showToast('✅ Аудиогид успешно сгенерирован!', 'success');
                } else {
                    throw new Error(data.error || 'Ошибка сервера');
                }
            } catch (error) {
                console.error('❌ Ошибка генерации аудио:', error);
                this.showGenerationError(error.message || 'Неизвестная ошибка');
                this.showToast(`Ошибка генерации: ${error.message}`, 'danger');
            } finally {
                this.isGenerating = false;
                this.hideGenerationProgress();
            }
        }

        // Показать аудиоплеер
        showAudioPlayer(audioUrl, filename = 'Аудиогид точки') {
            // Показываем плеер и скрываем рекордер
            document.getElementById('point-audio-player').style.display = 'block';
            document.getElementById('point-audio-recorder').style.display = 'none';
            
            // Устанавливаем имя файла
            document.getElementById('audio-filename').textContent = filename;
            
            // Включаем аудио
            document.getElementById('enable-audio-guide').checked = true;
            
            // Настраиваем аудио элемент
            if (this.audioElement) {
                this.audioElement.src = audioUrl;
                this.setupAudioPlayerControls();
            }
            
            // Показываем кнопки управления
            this.showAudioControls();
        }

        // Настройка элементов управления аудиоплеером
        setupAudioPlayerControls() {
            if (!this.audioElement) return;
            
            const playBtn = document.querySelector('.audio-play-btn');
            const progressBar = document.querySelector('.audio-progress');
            const durationSpan = document.querySelector('.audio-duration');
            
            if (!playBtn) return;
            
            // Форматирование времени
            const formatTime = (seconds) => {
                if (isNaN(seconds)) return '0:00';
                const mins = Math.floor(seconds / 60);
                const secs = Math.floor(seconds % 60);
                return `${mins}:${secs.toString().padStart(2, '0')}`;
            };
            
            // Сброс предыдущих обработчиков
            const newPlayBtn = playBtn.cloneNode(true);
            playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
            
            // Обработчик воспроизведения
            newPlayBtn.addEventListener('click', () => {
                if (this.audioElement.paused) {
                    this.audioElement.play().catch(e => {
                        console.error('Ошибка воспроизведения:', e);
                        this.showToast('Ошибка воспроизведения аудио', 'danger');
                    });
                    newPlayBtn.innerHTML = '<i class="fas fa-pause"></i>';
                } else {
                    this.audioElement.pause();
                    newPlayBtn.innerHTML = '<i class="fas fa-play"></i>';
                }
            });
            
            // Обновление прогресса
            this.audioElement.addEventListener('timeupdate', () => {
                if (this.audioElement.duration && progressBar) {
                    const progress = (this.audioElement.currentTime / this.audioElement.duration) * 100;
                    progressBar.style.width = `${progress}%`;
                }
                if (durationSpan) {
                    durationSpan.textContent = formatTime(this.audioElement.currentTime);
                }
            });
            
            // Сброс при завершении
            this.audioElement.addEventListener('ended', () => {
                newPlayBtn.innerHTML = '<i class="fas fa-play"></i>';
                if (progressBar) progressBar.style.width = '0%';
                if (durationSpan) durationSpan.textContent = '0:00';
            });
            
            // Загрузка метаданных
            this.audioElement.addEventListener('loadedmetadata', () => {
                if (durationSpan) {
                    durationSpan.textContent = formatTime(this.audioElement.duration);
                }
            });
            
            // Обработка ошибок
            this.audioElement.addEventListener('error', (e) => {
                console.error('Ошибка загрузки аудио:', e);
                this.showToast('Ошибка загрузки аудиофайла', 'danger');
            });
        }

        // Показать элементы управления аудио
        showAudioControls() {
            const controls = document.querySelectorAll('#re-record-audio, #remove-audio');
            controls.forEach(control => {
                control.style.display = 'inline-block';
            });
        }

        // Скрыть элементы управления аудио
        hideAudioControls() {
            const controls = document.querySelectorAll('#re-record-audio, #remove-audio');
            controls.forEach(control => {
                control.style.display = 'none';
            });
        }

        // Сброс аудио (начать запись заново)
        resetAudio() {
            if (confirm('Вы уверены, что хотите перезаписать аудио?')) {
                this.audioUrl = null;
                if (this.audioElement) {
                    this.audioElement.src = '';
                    this.audioElement.pause();
                }
                
                // Скрываем плеер, показываем рекордер
                document.getElementById('point-audio-player').style.display = 'none';
                document.getElementById('point-audio-recorder').style.display = 'block';
                
                // Сбрасываем переключатель
                document.getElementById('enable-audio-guide').checked = false;
                
                // Сбрасываем состояние генерации
                this.resetGenerationUI();
                
                this.showToast('Аудио сброшено. Можете записать новое.', 'info');
            }
        }

        // Удалить аудио
        removeAudio() {
            if (confirm('Вы уверены, что хотите удалить аудио?')) {
                this.audioUrl = null;
                if (this.audioElement) {
                    this.audioElement.src = '';
                    this.audioElement.pause();
                }
                
                // Скрываем плеер, показываем рекордер
                document.getElementById('point-audio-player').style.display = 'none';
                document.getElementById('point-audio-recorder').style.display = 'block';
                
                // Сбрасываем переключатель
                document.getElementById('enable-audio-guide').checked = false;
                
                // Сбрасываем состояние генерации
                this.resetGenerationUI();
                
                // Обновляем RouteEditor
                if (window.routeEditor?.updatePointAudio) {
                    window.routeEditor.updatePointAudio(this.currentPointId, null);
                }
                
                this.showToast('Аудио удалено', 'info');
            }
        }

        // Обработка переключения аудио
        handleAudioToggle(isEnabled) {
            if (!isEnabled && this.audioUrl) {
                if (confirm('Отключение аудио скроет плеер. Хотите продолжить?')) {
                    document.getElementById('point-audio-player').style.display = 'none';
                    document.getElementById('point-audio-recorder').style.display = 'block';
                } else {
                    // Возвращаем переключатель в положение "включено"
                    document.getElementById('enable-audio-guide').checked = true;
                }
            } else if (isEnabled && !this.audioUrl) {
                // Если аудио нет, показываем рекордер
                document.getElementById('point-audio-player').style.display = 'none';
                document.getElementById('point-audio-recorder').style.display = 'block';
            }
        }

        // Сброс UI генерации
        resetGenerationUI() {
            this.hideGenerationProgress();
            this.hideGenerationError();
            this.hideGenerationSuccess();
            const generateBtn = document.getElementById('generate-ai-audio');
            if (generateBtn) generateBtn.disabled = false;
        }

        // Показать прогресс генерации
        showGenerationProgress() {
            const progressEl = document.getElementById('ai-generation-progress');
            const generateBtn = document.getElementById('generate-ai-audio');
            if (progressEl) progressEl.style.display = 'block';
            if (generateBtn) generateBtn.disabled = true;
            
            this.hideGenerationError();
            this.hideGenerationSuccess();
        }

        // Скрыть прогресс генерации
        hideGenerationProgress() {
            const progressEl = document.getElementById('ai-generation-progress');
            if (progressEl) progressEl.style.display = 'none';
        }

        // Показать ошибку генерации
        showGenerationError(errorMessage) {
            const errorEl = document.getElementById('ai-generation-error');
            const errorMsg = document.getElementById('ai-error-message');
            const generateBtn = document.getElementById('generate-ai-audio');
            
            if (errorEl && errorMsg) {
                errorMsg.textContent = errorMessage;
                errorEl.style.display = 'block';
            }
            if (generateBtn) generateBtn.disabled = false;
            
            this.hideGenerationProgress();
            this.hideGenerationSuccess();
        }

        // Скрыть ошибку генерации
        hideGenerationError() {
            const errorEl = document.getElementById('ai-generation-error');
            if (errorEl) errorEl.style.display = 'none';
        }

        // Показать успех генерации
        showGenerationSuccess() {
            const successEl = document.getElementById('ai-generation-success');
            if (successEl) successEl.style.display = 'block';
            
            this.hideGenerationProgress();
            this.hideGenerationError();
        }

        // Скрыть успех генерации
        hideGenerationSuccess() {
            const successEl = document.getElementById('ai-generation-success');
            if (successEl) successEl.style.display = 'none';
        }

        // Получить CSRF токен
        getCsrfToken() {
            // Попробовать найти в форме
            const tokenInput = document.querySelector('input[name="csrfmiddlewaretoken"]');
            if (tokenInput) {
                return tokenInput.value;
            }
            
            // Попробовать найти в cookies
            const name = 'csrftoken';
            let cookieValue = null;
            if (document.cookie && document.cookie !== '') {
                const cookies = document.cookie.split(';');
                for (let i = 0; i < cookies.length; i++) {
                    const cookie = cookies[i].trim();
                    if (cookie.substring(0, name.length + 1) === (name + '=')) {
                        cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                        break;
                    }
                }
            }
            return cookieValue;
        }

        // Показать уведомление
        showToast(message, type = 'info') {
            // Используем существующую функцию если есть
            if (window.routeEditor && typeof window.routeEditor.showToast === 'function') {
                window.routeEditor.showToast(message, type);
            } else {
                console.log(`[${type.toUpperCase()}] ${message}`);
                
                // Простая реализация тоста
                const toast = document.createElement('div');
                toast.className = `toast align-items-center text-white bg-${type} border-0 position-fixed bottom-0 end-0 m-3`;
                toast.setAttribute('role', 'alert');
                toast.style.zIndex = '9999';
                toast.innerHTML = `
                    <div class="d-flex">
                        <div class="toast-body">${message}</div>
                        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
                    </div>
                `;
                document.body.appendChild(toast);
                
                const bsToast = new bootstrap.Toast(toast);
                bsToast.show();
                
                setTimeout(() => {
                    toast.remove();
                }, 3000);
            }
        }
    }

    // Создаем глобальный экземпляр менеджера
    window.audioGenerationManager = new AudioGenerationManager();

    // Добавляем функцию для вызова из pointEditor
    window.setupPointAudio = function(pointId, pointIndex, pointData) {
        if (window.audioGenerationManager) {
            window.audioGenerationManager.setupForPoint(pointId, pointIndex, pointData);
        }
    };

    // Инициализация при загрузке DOM
    document.addEventListener('DOMContentLoaded', () => {
        console.log('✅ AudioGenerationManager загружен и готов к работе');
    });