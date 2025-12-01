// static/js/route_editor.js
class RouteEditor {
    constructor() {
        this.map = null;
        this.points = [];
        this.markers = [];
        this.routeLine = null;
        this.routeType = 'walking';
        this.currentEditIndex = null;
        this.history = [];
        this.historyIndex = 0;
        this.tempMarker = null;
        this.addressQueue = [];
        
        this.defaultCenter = [55.7558, 37.6176];
        this.userLocation = null;

        // Медиа данные для фото и аудио
        this.routeMainPhotoFile = null;
        this.routeAdditionalPhotoFiles = [];

        this.pointMainPhotoFile = null;
        this.pointAdditionalPhotoFiles = [];

        this.currentAudioFile = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.audioContext = null;
        this.analyser = null;
        this.visualizationInterval = null;
        this.recordingTimer = null;
        this.recordingStartTime = null;
        this.currentAudio = null;
        this.isRecording = false;
        
        // API ключ OpenRouteService
        this.orsApiKey = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjYyMzA1OTQzOTI2NzQ1MDBiMTUwOGUxYmVhZTUwMGM4IiwiaCI6Im11cm11cjY0In0=';
        
        this.init();
        this.initAudioGenerationManager();
    }

    init() {
        this.initMap();
        this.initEventListeners();
        this.initSearch();
        this.updateHistoryButtons();
        
        // Загрузка существующих данных маршрута, если есть
        if (window.routeData) {
            this.loadExistingRoute(window.routeData);
        }
    }

    initMap() {
        // Используем существующие координаты или Москву по умолчанию
        const initialCoords = this.points.length > 0 ? 
            [this.points[0].lat, this.points[0].lng] : this.defaultCenter;
        
        // Проверяем существование элемента карты
        const mapElement = document.getElementById('map');
        if (!mapElement) {
            console.error('Element with id "map" not found');
            return;
        }
        
        this.map = L.map('map').setView(initialCoords, 13);
        
        // Слои карты
        this.osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        });
        
        this.satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri',
            maxZoom: 19
        });
        
        this.osmLayer.addTo(this.map);

        // Обработчик клика по карте
        this.map.on('click', (e) => this.addPoint(e.latlng));
    }

    initEventListeners() {
        // Безопасное добавление обработчиков с проверкой существования элементов
        this.safeAddEventListener('style-toggle', 'click', () => this.toggleMapStyle());
        this.safeAddEventListener('locate-me', 'click', () => this.locateUser());
        this.safeAddEventListener('reset-route', 'click', () => this.showResetConfirm());
        this.safeAddEventListener('save-btn', 'click', () => this.saveRoute());
        this.safeAddEventListener('optimize-btn', 'click', () => this.optimizeRoute());
        this.safeAddEventListener('undo-btn', 'click', () => this.undo());
        this.safeAddEventListener('redo-btn', 'click', () => this.redo());
        this.safeAddEventListener('add-waypoint-btn', 'click', () => this.showAddPointHint());
        this.safeAddEventListener('save-point-btn', 'click', () => this.savePoint());
        this.safeAddEventListener('confirm-delete-btn', 'click', () => this.confirmDeletePoint());
        this.safeAddEventListener('confirm-reset-btn', 'click', () => this.confirmResetRoute());

        // Переключение типа маршрута
        document.querySelectorAll('.route-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setRouteType(e.target.dataset.type));
        });

        // Инициализация медиа обработчиков после загрузки DOM
        setTimeout(() => {
            this.initMediaHandlers();
        }, 500); // Увеличиваем задержку для полной загрузки DOM

        // Горячие клавиши
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                this.undo();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                this.redo();
            } else if (e.key === 'Delete' && this.currentEditIndex !== null) {
                e.preventDefault();
                this.deletePoint(this.currentEditIndex);
            }
        });

        // Закрытие поисковых подсказок при клике вне
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-bar')) {
                const searchSuggestions = document.getElementById('search-suggestions');
                if (searchSuggestions) {
                    searchSuggestions.style.display = 'none';
                }
            }
        });
    }

    // Безопасное добавление обработчиков событий
    safeAddEventListener(elementId, event, handler) {
        const element = document.getElementById(elementId);
        if (element) {
            element.addEventListener(event, handler);
        } else {
            console.warn(`Element with id '${elementId}' not found`);
        }
    }

    // Медиа обработчики
    initMediaHandlers() {
        console.log('Initializing media handlers...');
        
        // Разделяем обработчики фото маршрута и фото точек
        this.initRoutePhotoHandlers();
        this.initPointPhotoHandlers();
        this.initAudioHandlers();
        
        // Аудиоплеер
        const audioPlayBtn = document.querySelector('.audio-play-btn');
        if (audioPlayBtn) {
            audioPlayBtn.addEventListener('click', () => {
                this.toggleAudioPlayback();
            });
        }
    }

    // Инициализация аудио обработчиков с защитой от ошибок
    initAudioHandlers() {
        console.log('Initializing audio handlers...');
        
        // Используем безопасное добавление с проверкой элементов
        this.safeAddEventListener('audio-file-input', 'change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.handleAudioUpload(e.target.files[0]);
            }
        });
        
        this.safeAddEventListener('remove-audio', 'click', () => {
            this.removeAudio();
        });
        
        this.safeAddEventListener('enable-audio-guide', 'change', (e) => {
            this.toggleAudioGuide(e.target.checked);
        });
        
        this.safeAddEventListener('start-audio-record', 'click', () => {
            this.startKomootStyleRecording();
        });
        
        this.safeAddEventListener('upload-audio-file', 'click', () => {
            const audioFileInput = document.getElementById('audio-file-input');
            if (audioFileInput) {
                audioFileInput.click();
            }
        });
        
        this.safeAddEventListener('re-record-audio', 'click', () => {
            this.resetAudioRecording();
        });

        // Инициализация состояния аудио
        this.resetAudioRecording();
    }

    // Загрузка существующего маршрута
    loadExistingRoute(routeData) {
        if (routeData.points && routeData.points.length > 0) {
            this.points = routeData.points.map(point => ({
                name: point.name,
                lat: this.normalizeCoordinate(point.lat),
                lng: this.normalizeCoordinate(point.lng),
                address: point.address || '',
                description: point.description || '',
                photos: point.photos || [],
                tags: point.tags || [],
                category: point.category || '',
                hint_author: point.hint_author || '',
                has_audio: point.has_audio || false
            }));

            // Устанавливаем тип маршрута
            this.routeType = routeData.route_type || 'walking';
            document.querySelectorAll('.route-type-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.type === this.routeType);
            });

            // Заполняем форму маршрута
            this.setValueIfExists('name', routeData.name);
            this.setValueIfExists('short_description', routeData.short_description);
            this.setValueIfExists('description', routeData.description);
            this.setValueIfExists('duration_minutes', routeData.duration_minutes);
            this.setValueIfExists('total_distance', routeData.total_distance);
            this.setValueIfExists('privacy', routeData.privacy);
            this.setValueIfExists('mood', routeData.mood);
            this.setValueIfExists('theme', routeData.theme);
            
            const routeTypeValue = routeData.route_type || routeData.routeType;
            this.setValueIfExists('route_type', routeTypeValue);

            this.setCheckedIfExists('has_audio_guide', routeData.has_audio_guide);
            this.setCheckedIfExists('is_elderly_friendly', routeData.is_elderly_friendly);
            this.setCheckedIfExists('is_active', routeData.is_active);

            this.updateMap();

            // Строим маршрут если есть точки
            if (this.points.length >= 2) {
                this.buildRoute();
            }
        }
    }

    setValueIfExists(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.value = value || '';
        }
    }

    setCheckedIfExists(id, checked) {
        const element = document.getElementById(id);
        if (element) {
            element.checked = !!checked;
        }
    }

    // Добавление точки
    addPoint(latlng) {
        const point = {
            name: `Точка ${this.points.length + 1}`,
            lat: this.normalizeCoordinate(latlng.lat),
            lng: this.normalizeCoordinate(latlng.lng),
            address: 'Определение адреса...',
            description: '',
            photos: [],
            tags: [],
            category: '',
            hint_author: '',
            has_audio: false
        };

        this.addPointToRoute(point);
        this.getAddressForPoint(point, this.points.length - 1);
    }

    async addPointToRoute(point) {
        this.saveToHistory();
        this.points.push(point);
        this.updateMap();
        
        // Автоматическое построение маршрута при добавлении второй точки
        if (this.points.length >= 2) {
            await this.buildRoute();
        }
        
        this.showToast('Точка добавлена', 'success');
    }

    async getAddressForPoint(point, index) {
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${point.lat}&lon=${point.lng}&zoom=16`
            );
            const data = await response.json();
            
            if (data.display_name) {
                this.points[index].address = data.display_name;
                this.updatePointsList();
            }
        } catch (error) {
            console.error('Ошибка получения адреса:', error);
            this.points[index].address = 'Адрес не определен';
            this.updatePointsList();
        }
    }

    // Обновление карты
    updateMap() {
        // Очистка карты
        this.clearMap();

        // Добавление маркеров
        this.points.forEach((point, index) => {
            const marker = this.createMarker(point, index);
            marker.addTo(this.map);
            this.markers.push(marker);
        });

        // Обновление статистики и списка
        this.updateStats();
        this.updatePointsList();
        this.updateHistoryButtons();
        
        // Автоматическое построение маршрута при достаточном количестве точек
        if (this.points.length >= 2) {
            this.buildRoute();
        }
    }

    createMarker(point, index) {
        const icon = this.createMarkerIcon(index, this.points.length);
        const marker = L.marker([point.lat, point.lng], { icon });
        
        marker.bindPopup(this.createPointPopup(point, index));
        
        // Двойной клик для редактирования
        marker.on('dblclick', () => {
            this.editPoint(index);
        });
        
        return marker;
    }

    createMarkerIcon(index, total) {
        const isStart = index === 0;
        const isEnd = index === total - 1;
        
        let backgroundColor = '#2563eb';
        if (isStart) backgroundColor = '#48bb78';
        if (isEnd) backgroundColor = '#f56565';

        const content = isStart ? 'A' : isEnd ? 'B' : (index + 1).toString();

        return L.divIcon({
            className: 'custom-marker',
            html: `
                <div style="width: 24px; height: 24px; border-radius: 50%; 
                          display: flex; align-items: center; justify-content: center; 
                          font-size: 12px; color: white; font-weight: bold; 
                          background: ${backgroundColor}; border: 3px solid white; 
                          box-shadow: 0 2px 6px rgba(0,0,0,0.3);">
                    ${content}
                </div>
            `,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
        });
    }

    createPointPopup(point, index) {
        const categoryIcon = point.category ? this.getCategoryIcon(point.category) : '';
        const categoryName = point.category ? this.getCategoryName(point.category) : '';
        
        // Иконки медиа
        const mediaIcons = [];
        if (point.photos && point.photos.length > 0) {
            mediaIcons.push('📷');
        }
        if (point.has_audio) {
            mediaIcons.push('🎧');
        }
        const mediaIconsHtml = mediaIcons.length > 0 ? 
            `<div style="margin: 5px 0;">${mediaIcons.join(' ')}</div>` : '';
        
        return `
            <div style="text-align: center; min-width: 200px;">
                <strong>${point.name}</strong><br>
                <small>${point.address}</small>
                ${categoryName ? `<br><small>${categoryIcon} ${categoryName}</small>` : ''}
                ${mediaIconsHtml}
                ${point.photos && point.photos.length > 0 ? 
                    `<img src="${point.photos[0]}" style="max-width: 100px; max-height: 100px; margin: 5px 0; border-radius: 4px;">` : 
                    ''
                }
                <div style="margin-top: 8px; display: flex; gap: 4px;">
                    <button class="btn btn-sm btn-outline-primary" onclick="routeEditor.editPoint(${index})">
                        ✏️ Редактировать
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="routeEditor.showDeleteConfirm(${index})">
                        🗑️ Удалить
                    </button>
                </div>
            </div>
        `;
    }

    clearMap() {
        // Удаляем все маркеры
        this.markers.forEach(marker => this.map.removeLayer(marker));
        this.markers = [];
        
        // Удаляем маршрут
        if (this.routeLine) {
            this.map.removeLayer(this.routeLine);
            this.routeLine = null;
        }
        
        // Удаляем временные маркеры
        if (this.tempMarker) {
            this.map.removeLayer(this.tempMarker);
            this.tempMarker = null;
        }
    }

    // Построение маршрута
    async buildRoute() {
        if (this.points.length < 2) return;

        try {
            const routeLoading = document.getElementById('route-loading');
            if (routeLoading) routeLoading.style.display = 'flex';
            
            const coordinates = await this.buildRouteWithORS();
            
            if (coordinates && coordinates.length > 0) {
                // Удаляем предыдущий маршрут
                if (this.routeLine) {
                    this.map.removeLayer(this.routeLine);
                    this.routeLine = null;
                }
                
                const routeColor = this.getRouteColor();
                const routeWeight = this.routeType === 'walking' ? 4 : 6;
                
                this.routeLine = L.polyline(coordinates, {
                    color: routeColor,
                    weight: routeWeight,
                    opacity: 0.8,
                    lineJoin: 'round',
                    lineCap: 'round'
                }).addTo(this.map);

                // Подгон карты под маршрут
                const group = new L.featureGroup([...this.markers, this.routeLine]);
                this.map.fitBounds(group.getBounds(), { padding: [20, 20] });
                
                this.showToast('Маршрут построен', 'success');
            }
        } catch (error) {
            console.error('Ошибка построения маршрута:', error);
            this.showToast('Не удалось построить маршрут. Используется прямое соединение.', 'warning');
            this.buildStraightRoute();
        } finally {
            const routeLoading = document.getElementById('route-loading');
            if (routeLoading) routeLoading.style.display = 'none';
        }
    }

    async buildRouteWithORS() {
        // Определяем тип маршрута для OpenRouteService
        const profiles = {
            'walking': 'foot-walking',
            'driving': 'driving-car',
            'cycling': 'cycling-regular'
        };
        
        const profile = profiles[this.routeType] || 'driving-car';
        
        // Подготавливаем координаты в формате [долгота, широта]
        const coordinates = this.points.map(point => [point.lng, point.lat]);
        
        const response = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': this.orsApiKey
            },
            body: JSON.stringify({
                coordinates: coordinates,
                instructions: false,
                preference: 'recommended',
                units: 'km',
                language: 'ru'
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('ORS Error:', errorText);
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }
        
        const data = await response.json();
        
        if (data.features && data.features[0] && data.features[0].geometry) {
            // Конвертируем координаты из [lng, lat] в [lat, lng] для Leaflet
            return data.features[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
        }
        
        throw new Error('Не удалось получить геометрию маршрута');
    }

    buildStraightRoute() {
        if (this.routeLine) {
            this.map.removeLayer(this.routeLine);
        }
        
        const coordinates = this.points.map(point => [point.lat, point.lng]);
        const routeColor = this.getRouteColor();
        
        this.routeLine = L.polyline(coordinates, {
            color: routeColor,
            weight: 3,
            opacity: 0.6,
            dashArray: '10, 10'
        }).addTo(this.map);
    }

    getRouteColor() {
        const colors = {
            'walking': '#48bb78',
            'driving': '#2563eb',
            'cycling': '#f59e0b'
        };
        return colors[this.routeType] || '#2563eb';
    }

    // Обновление статистики и списка точек
    updateStats() {
        document.getElementById('points-count').textContent = this.points.length;
        document.getElementById('total-distance').textContent = this.calculateTotalDistance() + ' км';
        
        const totalDistanceInput = document.getElementById('total_distance');
        if (totalDistanceInput) {
            totalDistanceInput.value = this.calculateTotalDistance();
        }
    }

    calculateTotalDistance() {
        if (this.points.length < 2) return 0;

        let total = 0;
        for (let i = 1; i < this.points.length; i++) {
            const prev = this.points[i-1];
            const curr = this.points[i];
            total += this.calculateDistance(prev.lat, prev.lng, curr.lat, curr.lng);
        }
        
        return total.toFixed(2);
    }

    calculateDistance(lat1, lng1, lat2, lng2) {
        const R = 6371;
        const dLat = this.deg2rad(lat2 - lat1);
        const dLng = this.deg2rad(lng2 - lng1);
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
            Math.sin(dLng/2) * Math.sin(dLng/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c;
    }

    deg2rad(deg) {
        return deg * (Math.PI/180);
    }

    updatePointsList() {
        const list = document.getElementById('points-list');
        if (!list) return;
        
        if (this.points.length === 0) {
            list.innerHTML = '<div class="text-muted small">Кликните по карте или используйте поиск</div>';
            return;
        }

        list.innerHTML = '';
        this.points.forEach((point, index) => {
            const item = this.createPointListItem(point, index);
            list.appendChild(item);
        });
    }

    createPointListItem(point, index) {
        const item = document.createElement('div');
        item.className = 'waypoint-item';
        item.innerHTML = this.createPointListHTML(point, index);
        
        item.addEventListener('click', () => this.showPointDetails(index));
        item.addEventListener('dblclick', () => this.editPoint(index));
        
        return item;
    }

    createPointListHTML(point, index) {
        const isStart = index === 0;
        const isEnd = index === this.points.length - 1;
        
        let markerClass = 'marker-waypoint';
        let markerText = (index + 1).toString();
        if (isStart) {
            markerClass = 'marker-start';
            markerText = 'A';
        } else if (isEnd) {
            markerClass = 'marker-end';
            markerText = 'B';
        }

        const categoryHtml = point.category ? `
            <div class="waypoint-category">
                ${this.getCategoryIcon(point.category)} ${this.getCategoryName(point.category)}
            </div>
        ` : '';

        // Иконки медиа
        const mediaIcons = [];
        if (point.photos && point.photos.length > 0) {
            mediaIcons.push('<i class="fas fa-camera text-success"></i>');
        }
        if (point.has_audio) {
            mediaIcons.push('<i class="fas fa-headphones text-primary"></i>');
        }
        const mediaIconsHtml = mediaIcons.length > 0 ? 
            `<div style="margin-left: auto; display: flex; gap: 4px;">${mediaIcons.join('')}</div>` : '';

        return `
            <div class="waypoint-marker ${markerClass}">${markerText}</div>
            <div class="waypoint-content">
                <div class="waypoint-header">
                    <div class="waypoint-name">${point.name}</div>
                    ${mediaIconsHtml}
                </div>
                <div class="waypoint-address">${point.address}</div>
                ${categoryHtml}
            </div>
        `;
    }

    getCategoryIcon(category) {
        const icons = {
            'attraction': '⭐',
            'nature': '🌿',
            'forest': '🌲',
            'bus_stop': '🚏',
            'viewpoint': '👁️',
            'restaurant': '🍴',
            'hotel': '🏨',
            'museum': '🎨',
            'park': '🌳',
            'monument': '🗿',
            'church': '⛪',
            'beach': '🏖️'
        };
        return icons[category] || '📍';
    }

    getCategoryName(category) {
        const names = {
            'attraction': 'Достопримечательность',
            'nature': 'Природа',
            'forest': 'Лес',
            'bus_stop': 'Автобусная остановка',
            'viewpoint': 'Смотровая площадка',
            'restaurant': 'Ресторан',
            'hotel': 'Отель',
            'museum': 'Музей',
            'park': 'Парк',
            'monument': 'Памятник',
            'church': 'Храм',
            'beach': 'Пляж'
        };
        return names[category] || 'Точка';
    }

    // Детали точки
    showPointDetails(index) {
        const point = this.points[index];
        const detailsDiv = document.getElementById('point-details');
        const title = document.getElementById('point-details-title');
        const content = document.getElementById('point-details-content');
        
        if (!detailsDiv || !title || !content) return;
        
        title.textContent = point.name;
        
        let contentHtml = '';
        
        if (point.category) {
            contentHtml += `
                <div class="waypoint-category" style="margin-bottom: 12px;">
                    ${this.getCategoryIcon(point.category)}
                    ${this.getCategoryName(point.category)}
                </div>
            `;
        }
        
        if (point.address && point.address !== 'Определение адреса...') {
            contentHtml += `<div class="text-muted small mb-3">${point.address}</div>`;
        }
        
        if (point.description) {
            if (point.hint_author) {
                contentHtml += `
                    <div class="hint-section">
                        <div class="hint-text">${point.description}</div>
                        <div class="hint-author">Подсказка от ${point.hint_author}</div>
                    </div>
                `;
            } else {
                contentHtml += `<div class="point-description">${point.description}</div>`;
            }
        }
        
        if (point.tags && point.tags.length > 0) {
            contentHtml += `
                <div class="point-tags">
                    ${point.tags.map(tag => `<span class="point-tag">${tag}</span>`).join('')}
                </div>
            `;
        }
        
        if (point.photos && point.photos.length > 0) {
            contentHtml += `
                <div class="point-photos">
                    ${point.photos.map(photo => `<img src="${photo}" class="point-photo" alt="Фото">`).join('')}
                </div>
            `;
        }
        
        content.innerHTML = contentHtml;
        detailsDiv.style.display = 'block';
        
        if (window.audioGenerationManager) {
            if (point.id) {
                // Точка сохранена — показываем реальные аудио контролы
                window.audioGenerationManager.showAudioForPoint(point.id, point);
            } else {
                // Точка ещё не сохранена — показываем "нет аудио" и отключаем генерацию
                window.audioGenerationManager.showNoAudio();
                // Отключаем кнопку генерации в блоке деталей
                const btn = document.querySelector('#point-details .generate-audio-btn');
                if (btn) btn.disabled = true;
            }
        }
        
        // Подсвечиваем точку на карте
        this.highlightPoint(index);
    }

    highlightPoint(index) {
        // Снимаем выделение со всех точек
        document.querySelectorAll('.waypoint-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Выделяем выбранную точку
        const waypointItems = document.querySelectorAll('.waypoint-item');
        if (waypointItems[index]) {
            waypointItems[index].classList.add('active');
        }
        
        // Открываем popup на карте
        if (this.markers[index]) {
            this.markers[index].openPopup();
        }
    }

    closePointDetails() {
        const detailsDiv = document.getElementById('point-details');
        if (detailsDiv) {
            detailsDiv.style.display = 'none';
        }
        document.querySelectorAll('.waypoint-item').forEach(item => {
            item.classList.remove('active');
        });
    }

    // Методы для управления фото точек в модальном окне
    openPointMainPhotoUpload() {
        const fileInput = document.getElementById('main-photo-upload');
        if (fileInput) {
            fileInput.click();
        } else {
            console.warn('Element main-photo-upload not found');
        }
    }

    openPointAdditionalPhotosUpload() {
        const fileInput = document.getElementById('additional-photos-upload');
        if (fileInput) {
            fileInput.click();
        } else {
            console.warn('Element additional-photos-upload not found');
        }
    }

    removePointMainPhoto() {
        const uploadSection = document.querySelector('#point-editor-modal .main-photo-upload');
        const preview = uploadSection?.querySelector('.main-photo-preview');
        const placeholder = uploadSection?.querySelector('.h-100');
        const fileInput = document.getElementById('main-photo-upload');
        
        if (preview) preview.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
        if (fileInput) fileInput.value = '';
        this.pointMainPhotoFile = null;
    }

    // Обновите метод handlePointMainPhotoUpload:
    handlePointMainPhotoUpload(file) {
        if (!file || !this.validateImageFile(file)) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const uploadSection = document.querySelector('#point-editor-modal .main-photo-upload');
            if (!uploadSection) return;
            
            const preview = uploadSection.querySelector('.main-photo-preview');
            const placeholder = uploadSection.querySelector('.h-100');
            
            if (placeholder) placeholder.style.display = 'none';
            if (preview) {
                preview.style.display = 'block';
                const img = preview.querySelector('img');
                if (img) img.src = e.target.result;
            }
            
            this.pointMainPhotoFile = file;
        };
        reader.readAsDataURL(file);
    }

    // Обновите метод handlePointAdditionalPhotosUpload:
    handlePointAdditionalPhotosUpload(files) {
        const grid = document.querySelector('#point-editor-modal .additional-photos-grid');
        if (!grid) return;
        
        const currentCount = grid.querySelectorAll('.additional-photo-item').length;
        
        if (currentCount + files.length > 4) {
            this.showToast('Максимум можно загрузить 4 дополнительных фото', 'warning');
            return;
        }

        Array.from(files).forEach(file => {
            if (!this.validateImageFile(file)) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const photoItem = this.createPointAdditionalPhotoItem(e.target.result);
                // Вставляем перед кнопкой загрузки
                grid.insertBefore(photoItem, grid.lastElementChild);
                this.pointAdditionalPhotoFiles.push(file);
                this.updatePointAdditionalPhotosCount();
            };
            reader.readAsDataURL(file);
        });
    }

    createPointAdditionalPhotoItem(src) {
        const div = document.createElement('div');
        div.className = 'additional-photo-item';
        div.innerHTML = `
            <img src="${src}" class="w-100 h-100 object-fit-cover">
            <button type="button" class="btn btn-sm btn-danger position-absolute top-0 end-0 m-1 photo-remove-btn shadow-sm" 
                    style="width: 20px; height: 20px; padding: 0; display: flex; align-items: center; justify-content: center;"
                    onclick="routeEditor?.removePointAdditionalPhoto(this)">
                <i class="fas fa-times" style="font-size: 10px;"></i>
            </button>
        `;
        return div;
    }

    removePointAdditionalPhoto(button) {
        const photoItem = button.closest('.additional-photo-item');
        if (photoItem) {
            const index = Array.from(photoItem.parentNode.children).indexOf(photoItem);
            this.pointAdditionalPhotoFiles.splice(index, 1);
            photoItem.remove();
            this.updatePointAdditionalPhotosCount();
        }
    }

    updatePointAdditionalPhotosCount() {
        const grid = document.querySelector('#point-editor-modal .additional-photos-grid');
        const countElement = document.getElementById('additional-photos-count');
        if (grid && countElement) {
            const photoCount = grid.querySelectorAll('.additional-photo-item').length;
            countElement.textContent = `${photoCount}/4`;
            
            // Скрываем кнопку загрузки если достигнут лимит
            const uploadButton = grid.querySelector('.additional-photo-upload');
            if (uploadButton) {
                uploadButton.style.display = photoCount >= 4 ? 'none' : 'flex';
            }
        }
    }

    editPoint(index) {
        this.currentEditIndex = index;
        const point = this.points[index];
        
        // Заполнение формы редактирования
        document.getElementById('edit-point-index').value = index;
        document.getElementById('point-name').value = point.name;
        document.getElementById('point-address').value = point.address;
        document.getElementById('point-description').value = point.description;
        document.getElementById('point-category').value = point.category;
        
        document.getElementById('point-tags').value = Array.isArray(point.tags) ? 
            point.tags.join(', ') : (point.tags || '');
        
        document.getElementById('point-hint-author').value = point.hint_author;
        document.getElementById('point-lat').value = point.lat.toFixed(6);
        document.getElementById('point-lng').value = point.lng.toFixed(6);
        
        // Загрузка фото данных
        this.loadPhotoData(point);
        
        // Загрузка аудио данных
        this.loadAudioData(point);
        
        if (window.audioGenerationManager) {
            if (point.id) {
                window.audioGenerationManager.showAudioForPoint(point.id, point);
            } else {
                window.audioGenerationManager.showNoAudio();
                const btn = document.querySelector('#point-editor-modal .generate-audio-btn');
                if (btn) btn.disabled = true;
            }
        }
        
        // Настройка обработчиков для модального окна
        this.setupPointModalHandlers();
        
        // Показ модального окна
        const modalElement = document.getElementById('point-editor-modal');
        if (modalElement) {
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
        }
    }

    // Добавьте метод для настройки обработчиков модального окна:
    setupPointModalHandlers() {
        // Обработчики для файловых инпутов
        const mainPhotoInput = document.getElementById('main-photo-upload');
        const additionalPhotosInput = document.getElementById('additional-photos-upload');
        
        if (mainPhotoInput) {
            mainPhotoInput.onchange = (e) => {
                this.handlePointMainPhotoUpload(e.target.files[0]);
            };
        }
        
        if (additionalPhotosInput) {
            additionalPhotosInput.onchange = (e) => {
                this.handlePointAdditionalPhotosUpload(e.target.files);
            };
        }
        
        // Обработчик закрытия модального окна для очистки
        const modalElement = document.getElementById('point-editor-modal');
        if (modalElement) {
            modalElement.addEventListener('hidden.bs.modal', () => {
                this.cleanupPointModal();
            });
        }
    }

    // Метод для очистки модального окна
    cleanupPointModal() {
        // Сбрасываем фото
        this.removePointMainPhoto();
        
        const grid = document.querySelector('#point-editor-modal .additional-photos-grid');
        if (grid) {
            const photoItems = grid.querySelectorAll('.additional-photo-item');
            photoItems.forEach(item => item.remove());
            this.updatePointAdditionalPhotosCount();
        }
        
        // Сбрасываем файловые инпуты
        const additionalInput = document.getElementById('additional-photos-upload');
        if (additionalInput) additionalInput.value = '';
        
        this.pointAdditionalPhotoFiles = [];
    }

    loadPhotoData(point) {
        // Сброс фото данных ТОЧКИ
        this.pointMainPhotoFile = null;
        this.pointAdditionalPhotoFiles = [];
        
        const mainUpload = document.querySelector('#point-editor-modal .main-photo-upload');
        if (!mainUpload) return;
        
        const mainPreview = mainUpload.querySelector('.main-photo-preview');
        const mainPlaceholder = mainUpload.querySelector('.h-100');
        const additionalGrid = document.querySelector('#point-editor-modal .additional-photos-grid');
        
        // Сбрасываем основное фото точки
        if (mainPlaceholder) mainPlaceholder.style.display = 'flex';
        if (mainPreview) mainPreview.style.display = 'none';
        
        // Сбрасываем дополнительные фото точки
        if (additionalGrid) {
            const uploadButton = additionalGrid.lastElementChild;
            additionalGrid.innerHTML = '';
            if (uploadButton) additionalGrid.appendChild(uploadButton);
        }
        
        // Загружаем существующие фото точки если есть
        if (point.photos && point.photos.length > 0) {
            // Первое фото - основное
            if (mainPlaceholder) mainPlaceholder.style.display = 'none';
            if (mainPreview) {
                mainPreview.style.display = 'block';
                const img = mainPreview.querySelector('img');
                if (img) img.src = point.photos[0];
            }
            
            // Остальные фото - дополнительные
            if (additionalGrid) {
                const uploadButton = additionalGrid.lastElementChild;
                point.photos.slice(1).forEach(photoSrc => {
                    const photoItem = this.createAdditionalPhotoItem(photoSrc, null);
                    additionalGrid.insertBefore(photoItem, uploadButton);
                });
            }
        }
    }

    loadAudioData(point) {
        // Сбрасываем аудио данные
        this.resetAudioRecording();
        
        const enableAudioGuide = document.getElementById('enable-audio-guide');
        if (enableAudioGuide) {
            enableAudioGuide.checked = !!point.has_audio;
            this.toggleAudioGuide(!!point.has_audio);
        }
    }

    // Обработка фотографий
    handleMainPhotoUpload(file) {
        if (!file || !this.validateImageFile(file)) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const uploadSection = document.querySelector('.main-photo-upload');
            if (!uploadSection) return;
            
            const preview = uploadSection.querySelector('.main-photo-preview');
            const placeholder = uploadSection.querySelector('.h-100');
            
            if (placeholder) placeholder.style.display = 'none';
            if (preview) {
                preview.style.display = 'block';
                const img = preview.querySelector('img');
                if (img) img.src = e.target.result;
            }
            
            this.mainPhotoFile = file;
        };
        reader.readAsDataURL(file);
    }

    handleAdditionalPhotosUpload(files) {
        const grid = document.querySelector('.additional-photos-grid');
        if (!grid) return;
        
        const currentCount = grid.children.length - 1;
        
        if (currentCount + files.length > 8) {
            this.showToast('Максимум можно загрузить 8 дополнительных фото', 'warning');
            return;
        }

        Array.from(files).forEach(file => {
            if (!this.validateImageFile(file)) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const photoItem = this.createAdditionalPhotoItem(e.target.result, file);
                grid.insertBefore(photoItem, grid.lastElementChild);
                this.additionalPhotoFiles.push(file);
            };
            reader.readAsDataURL(file);
        });
    }

    createAdditionalPhotoItem(src, file) {
        const div = document.createElement('div');
        div.className = 'additional-photo-item';
        div.innerHTML = `
            <img src="${src}" class="w-100 h-100 object-fit-cover rounded">
            <button type="button" class="btn btn-sm photo-remove-btn position-absolute top-0 end-0 m-1">
                <i class="fas fa-times"></i>
            </button>
        `;
        
        const removeBtn = div.querySelector('.photo-remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = Array.from(div.parentNode.children).indexOf(div) - 1;
                this.additionalPhotoFiles.splice(index, 1);
                div.remove();
            });
        }
        
        return div;
    }

    validateImageFile(file) {
        if (!file.type.startsWith('image/')) {
            this.showToast('Пожалуйста, выбирайте только изображения', 'warning');
            return false;
        }
        
        if (file.size > 5 * 1024 * 1024) {
            this.showToast('Размер файла не должен превышать 5MB', 'warning');
            return false;
        }
        
        return true;
    }

    // Сохранение точки
    savePoint() {
        const index = this.currentEditIndex;
        const nameInput = document.getElementById('point-name');
        if (!nameInput) return;
        
        const name = nameInput.value.trim();
        
        if (!name) {
            this.showToast('Введите название точки', 'warning');
            return;
        }

        this.saveToHistory();
        
        // Используем getPointPhotosForModal() вместо getPointPhotos()
        const pointPhotos = this.getPointPhotosForModal();
        
        const tagsInput = document.getElementById('point-tags');
        const tags = tagsInput ? 
            tagsInput.value.split(',').map(tag => tag.trim()).filter(tag => tag) : [];

        const hasAIAudio = window.audioGenerationManager ? 
            window.audioGenerationManager.currentAudioUrl !== null : false;
        
        const aiAudioUrl = window.audioGenerationManager ? 
            window.audioGenerationManager.currentAudioUrl : null;

        this.points[index] = {
            ...this.points[index],
            name: name,
            address: document.getElementById('point-address')?.value || '',
            description: document.getElementById('point-description')?.value || '',
            category: document.getElementById('point-category')?.value || '',
            tags: tags,
            hint_author: document.getElementById('point-hint-author')?.value || '',
            photos: pointPhotos, // Сохраняем фото в объект точки
            has_audio: hasAIAudio || !!this.currentAudioFile,
            audio_file: this.currentAudioFile,
            audio_guide: aiAudioUrl,
            lat: this.normalizeCoordinate(document.getElementById('point-lat')?.value || 0),
            lng: this.normalizeCoordinate(document.getElementById('point-lng')?.value || 0)
        };

        this.updateMap();
        this.showToast('Точка сохранена', 'success');
        
        const modalElement = document.getElementById('point-editor-modal');
        if (modalElement) {
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) modal.hide();
        }
    }

    // Новый метод для получения фото из модального окна
    getPointPhotosForModal() {
        const pointPhotos = [];
        
        console.log('=== СБОР ФОТО ИЗ МОДАЛЬНОГО ОКНА ===');
        
        // 1. Основное фото
        const mainPreview = document.querySelector('#point-editor-modal .main-photo-preview img');
        if (mainPreview && mainPreview.src) {
            console.log('Найдено основное фото:', mainPreview.src.substring(0, 100));
            
            // Проверяем, что это не дефолтное изображение
            if (!mainPreview.src.includes('placeholder') && !mainPreview.src.includes('data:image/svg')) {
                pointPhotos.push(mainPreview.src);
            }
        }
        
        // 2. Дополнительные фото
        const additionalItems = document.querySelectorAll('#point-editor-modal .additional-photo-item');
        console.log('Найдено дополнительных фото:', additionalItems.length);
        
        additionalItems.forEach((item, i) => {
            const img = item.querySelector('img');
            if (img && img.src) {
                console.log(`Доп. фото ${i}:`, img.src.substring(0, 100));
                
                if (!img.src.includes('placeholder') && !img.src.includes('data:image/svg')) {
                    pointPhotos.push(img.src);
                }
            }
        });
        
        console.log('Итоговое количество фото:', pointPhotos.length);
        return pointPhotos;
    }

    getRoutePhotos() {
        const routePhotos = [];
        
        // Основное фото маршрута
        const mainPreview = document.querySelector('.main-photo-section .main-photo-preview img');
        if (mainPreview && mainPreview.src) {
            if (mainPreview.src.startsWith('data:')) {
                // Новое фото - DataURL
                routePhotos.push(mainPreview.src);
            } else if (mainPreview.src.includes('/uploads/') || mainPreview.src.includes('/media/')) {
                // Уже сохраненное фото - URL
                routePhotos.push(mainPreview.src);
            }
        }
        
        // Дополнительные фото маршрута
        const additionalItems = document.querySelectorAll('.additional-photos-grid .additional-photo-item');
        additionalItems.forEach(item => {
            const img = item.querySelector('img');
            if (img && img.src) {
                if (img.src.startsWith('data:')) {
                    routePhotos.push(img.src);
                } else if (img.src.includes('/uploads/') || img.src.includes('/media/')) {
                    routePhotos.push(img.src);
                }
            }
        });
        
        return routePhotos;
    }

    getPointPhotos(pointIndex) {
        if (pointIndex === undefined && this.currentEditIndex !== null) {
            pointIndex = this.currentEditIndex;
        }
        
        if (pointIndex === undefined || !this.points[pointIndex]) {
            return [];
        }
        
        const point = this.points[pointIndex];
        
        console.log(`=== DEBUG getPointPhotos(${pointIndex}) ===`);
        console.log('Point name:', point.name);
        console.log('Point photos in object:', point.photos);
        
        // Возвращаем фото, которые уже сохранены в объекте точки
        return point.photos || [];
    }

    // Аудио функциональность - ИСПРАВЛЕННАЯ ВЕРСИЯ
    async startKomootStyleRecording() {
        try {
            console.log('Starting recording...');
            
            // Проверяем поддержку MediaRecorder
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Ваш браузер не поддерживает запись аудио');
            }

            // Останавливаем предыдущую запись если есть
            if (this.isRecording && this.mediaRecorder) {
                this.stopRecording();
                return;
            }

            await this.setupAudioContext();
            
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    sampleRate: 44100,
                    channelCount: 1
                } 
            });
            
            // Проверяем поддержку форматов
            const options = { mimeType: 'audio/webm' };
            if (!MediaRecorder.isTypeSupported('audio/webm')) {
                options.mimeType = 'audio/mp4';
            }
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = '';
            }
            
            this.mediaRecorder = new MediaRecorder(stream, options);
            
            this.audioChunks = [];
            this.setupAudioVisualization(stream);
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.audioChunks.push(event.data);
                }
            };

            this.mediaRecorder.onstop = () => {
                console.log('Recording stopped');
                const audioBlob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType });
                this.showAudioPlayer(audioBlob);
                this.stopAudioVisualization();
                this.stopRecordingTimer();
                
                // Освобождаем ресурсы
                stream.getTracks().forEach(track => track.stop());
                this.isRecording = false;
            };

            this.mediaRecorder.onerror = (event) => {
                console.error('Recording error:', event.error);
                this.showToast('Ошибка записи: ' + event.error.name, 'danger');
                this.stopRecording();
            };

            this.mediaRecorder.start(100);
            this.isRecording = true;
            this.startRecordingUI();

        } catch (error) {
            console.error('Recording setup error:', error);
            this.showToast('Не удалось начать запись: ' + error.message, 'danger');
            this.stopRecording();
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.isRecording) {
            try {
                this.mediaRecorder.stop();
            } catch (e) {
                console.error('Error stopping recorder:', e);
            }
        }
        this.stopRecordingUI();
        this.stopRecordingTimer();
        this.isRecording = false;
    }

    async setupAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
        }
        return this.audioContext;
    }

    setupAudioVisualization(stream) {
        try {
            const source = this.audioContext.createMediaStreamSource(stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.8;
            source.connect(this.analyser);

            this.startVisualization();
        } catch (error) {
            console.warn('Audio visualization failed:', error);
        }
    }

    startVisualization() {
        const visualizer = document.getElementById('live-visualizer');
        if (!visualizer) return;
        
        visualizer.innerHTML = '';
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        // Создаем меньше баров для лучшей производительности
        for (let i = 0; i < 20; i++) {
            const bar = document.createElement('div');
            bar.className = 'audio-bar';
            bar.style.height = '2px';
            bar.style.backgroundColor = '#3b82f6';
            bar.style.margin = '0 1px';
            bar.style.borderRadius = '1px';
            visualizer.appendChild(bar);
        }

        this.visualizationInterval = setInterval(() => {
            if (!this.analyser || !this.isRecording) return;
            
            this.analyser.getByteFrequencyData(dataArray);
            const bars = visualizer.children;
            
            for (let i = 0; i < bars.length; i++) {
                const value = dataArray[Math.floor(i * bufferLength / bars.length)] || 0;
                const height = Math.max(2, (value / 255) * 30);
                bars[i].style.height = `${height}px`;
            }
        }, 100);
    }

    startRecordingUI() {
        const recordingIndicator = document.getElementById('recording-indicator');
        const recordingVisualizer = document.getElementById('recording-visualizer');
        const startAudioRecord = document.getElementById('start-audio-record');
        const recordingSection = document.querySelector('.audio-recording-section');
        
        if (recordingIndicator) {
            recordingIndicator.style.display = 'block';
            recordingIndicator.innerHTML = '<i class="fas fa-circle text-danger"></i> Запись...';
        }
        if (recordingVisualizer) recordingVisualizer.style.display = 'block';
        if (startAudioRecord) {
            startAudioRecord.innerHTML = '<i class="fas fa-stop"></i> Остановить запись';
            startAudioRecord.classList.add('btn-danger');
            startAudioRecord.classList.remove('btn-primary');
        }
        if (recordingSection) recordingSection.classList.add('recording-active');
        
        this.startRecordingTimer();
    }

    stopRecordingUI() {
        const recordingIndicator = document.getElementById('recording-indicator');
        const recordingVisualizer = document.getElementById('recording-visualizer');
        const startAudioRecord = document.getElementById('start-audio-record');
        const recordingSection = document.querySelector('.audio-recording-section');
        
        if (recordingIndicator) recordingIndicator.style.display = 'none';
        if (recordingVisualizer) recordingVisualizer.style.display = 'none';
        if (startAudioRecord) {
            startAudioRecord.innerHTML = '<i class="fas fa-microphone"></i> Начать запись';
            startAudioRecord.classList.remove('btn-danger');
            startAudioRecord.classList.add('btn-primary');
            startAudioRecord.disabled = false;
        }
        if (recordingSection) recordingSection.classList.remove('recording-active');
    }

    startRecordingTimer() {
        this.recordingStartTime = Date.now();
        this.recordingTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const seconds = (elapsed % 60).toString().padStart(2, '0');
            const recordingTimer = document.getElementById('recording-timer');
            if (recordingTimer) {
                recordingTimer.textContent = `${minutes}:${seconds}`;
            }
            
            // Автоматическая остановка через 5 минут
            if (elapsed >= 300) {
                this.stopRecording();
                this.showToast('Запись автоматически остановлена (максимум 5 минут)', 'info');
            }
        }, 1000);
    }

    stopRecordingTimer() {
        if (this.recordingTimer) {
            clearInterval(this.recordingTimer);
            this.recordingTimer = null;
        }
        const recordingTimer = document.getElementById('recording-timer');
        if (recordingTimer) {
            recordingTimer.textContent = '00:00';
        }
    }

    stopAudioVisualization() {
        if (this.visualizationInterval) {
            clearInterval(this.visualizationInterval);
            this.visualizationInterval = null;
        }
    }

    showAudioPlayer(audioBlob) {
        const audioRecorder = document.getElementById('audio-recorder');
        const audioPlayer = document.getElementById('audio-player');
        
        if (audioRecorder) audioRecorder.style.display = 'none';
        if (audioPlayer) audioPlayer.style.display = 'block';
        
        const audioUrl = URL.createObjectURL(audioBlob);
        
        // Освобождаем предыдущий аудио объект
        if (this.currentAudio) {
            this.currentAudio.pause();
            URL.revokeObjectURL(this.currentAudio.src);
        }
        
        this.currentAudio = new Audio(audioUrl);
        this.currentAudioFile = audioBlob;
        
        this.setupAudioPlayer(this.currentAudio);
    }

    setupAudioPlayer(audio) {
        audio.addEventListener('loadedmetadata', () => {
            const audioDuration = document.getElementById('audio-duration');
            if (audioDuration) {
                audioDuration.textContent = this.formatTime(audio.duration);
            }
            this.createAudioWaveform();
        });
        
        audio.addEventListener('timeupdate', () => {
            const audioCurrentTime = document.getElementById('audio-current-time');
            const audioProgress = document.querySelector('.audio-progress');
            if (audioCurrentTime) {
                audioCurrentTime.textContent = this.formatTime(audio.currentTime);
            }
            if (audioProgress && audio.duration) {
                const progress = (audio.currentTime / audio.duration) * 100;
                audioProgress.style.width = `${progress}%`;
            }
        });
        
        audio.addEventListener('ended', () => {
            const playBtnIcon = document.querySelector('.audio-play-btn i');
            if (playBtnIcon) {
                playBtnIcon.className = 'fas fa-play';
            }
            // Сбрасываем прогресс
            const audioProgress = document.querySelector('.audio-progress');
            if (audioProgress) {
                audioProgress.style.width = '0%';
            }
        });
        
        audio.addEventListener('error', (e) => {
            console.error('Audio playback error:', e);
            this.showToast('Ошибка воспроизведения аудио', 'danger');
        });
    }

    createAudioWaveform() {
        const visualizer = document.getElementById('audio-visualizer');
        if (!visualizer) return;
        
        visualizer.innerHTML = '';
        
        // Создаем простую визуализацию
        for (let i = 0; i < 30; i++) {
            const bar = document.createElement('div');
            bar.className = 'audio-bar';
            bar.style.height = `${Math.random() * 25 + 5}px`;
            bar.style.backgroundColor = '#6b7280';
            bar.style.margin = '0 1px';
            bar.style.borderRadius = '1px';
            visualizer.appendChild(bar);
        }
    }

    toggleAudioPlayback() {
        if (!this.currentAudio) {
            this.showToast('Аудио не доступно для воспроизведения', 'warning');
            return;
        }
        
        const playBtnIcon = document.querySelector('.audio-play-btn i');
        
        try {
            if (this.currentAudio.paused) {
                this.currentAudio.play().then(() => {
                    if (playBtnIcon) {
                        playBtnIcon.className = 'fas fa-pause';
                    }
                }).catch(error => {
                    console.error('Playback error:', error);
                    this.showToast('Ошибка воспроизведения: ' + error.message, 'danger');
                });
            } else {
                this.currentAudio.pause();
                if (playBtnIcon) {
                    playBtnIcon.className = 'fas fa-play';
                }
            }
        } catch (error) {
            console.error('Playback toggle error:', error);
            this.showToast('Ошибка управления воспроизведением', 'danger');
        }
    }

    resetAudioRecording() {
        const audioPlayer = document.getElementById('audio-player');
        const audioRecorder = document.getElementById('audio-recorder');
        
        if (audioPlayer) audioPlayer.style.display = 'none';
        if (audioRecorder) audioRecorder.style.display = 'block';
        
        // Освобождаем ресурсы
        if (this.currentAudio) {
            this.currentAudio.pause();
            URL.revokeObjectURL(this.currentAudio.src);
            this.currentAudio = null;
        }
        this.currentAudioFile = null;
        this.isRecording = false;
        
        this.stopRecordingUI();
        this.stopRecordingTimer();
        this.stopAudioVisualization();
    }

    handleAudioUpload(file) {
        if (!file) return;
        
        if (!file.type.startsWith('audio/')) {
            this.showToast('Пожалуйста, загружайте только аудиофайлы', 'warning');
            return;
        }

        if (file.size > 10 * 1024 * 1024) {
            this.showToast('Размер аудиофайла не должен превышать 10MB', 'warning');
            return;
        }

        this.showAudioPlayer(file);
    }

    removeAudio() {
        this.resetAudioRecording();
        const audioFileInput = document.getElementById('audio-file-input');
        if (audioFileInput) audioFileInput.value = '';
        
        // Обновляем состояние точки
        if (this.currentEditIndex !== null) {
            this.points[this.currentEditIndex].has_audio = false;
        }
    }

    toggleAudioGuide(enabled) {
        const audioRecorder = document.getElementById('audio-recorder');
        const audioPlayer = document.getElementById('audio-player');
        
        if (enabled) {
            if (audioRecorder) audioRecorder.style.display = 'block';
        } else {
            if (audioRecorder) audioRecorder.style.display = 'none';
            if (audioPlayer) audioPlayer.style.display = 'none';
            this.resetAudioRecording();
        }
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    // Удаление точки
    showDeleteConfirm(index) {
        this.currentEditIndex = index;
        const pointName = this.points[index].name;
        const deletePointName = document.getElementById('delete-point-name');
        if (deletePointName) {
            deletePointName.textContent = pointName;
        }
        
        const modalElement = document.getElementById('delete-confirm-modal');
        if (modalElement) {
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
        }
    }

    confirmDeletePoint() {
        const index = this.currentEditIndex;
        if (index !== null) {
            this.saveToHistory();
            this.points.splice(index, 1);
            this.updateMap();
            this.showToast('Точка удалена', 'warning');
            
            const modalElement = document.getElementById('delete-confirm-modal');
            if (modalElement) {
                const modal = bootstrap.Modal.getInstance(modalElement);
                if (modal) modal.hide();
            }
        }
    }

    deletePoint(index) {
        if (confirm(`Удалить точку "${this.points[index].name}"?`)) {
            this.saveToHistory();
            this.points.splice(index, 1);
            this.updateMap();
            this.showToast('Точка удалена', 'warning');
        }
    }

    // Настройки маршрута
    setRouteType(type) {
        this.routeType = type;
        
        document.querySelectorAll('.route-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });
        
        if (this.points.length >= 2) {
            this.buildRoute();
        }
    }

    // Оптимизация маршрута
    async optimizeRoute() {
        if (this.points.length < 3) {
            this.showToast('Нужно минимум 3 точки для оптимизации', 'warning');
            return;
        }

        this.saveToHistory();
        
        const firstPoint = this.points[0];
        const otherPoints = this.points.slice(1, -1);
        const lastPoint = this.points[this.points.length - 1];

        otherPoints.sort((a, b) => {
            const distA = this.calculateDistance(firstPoint.lat, firstPoint.lng, a.lat, a.lng);
            const distB = this.calculateDistance(firstPoint.lat, firstPoint.lng, b.lat, b.lng);
            return distA - distB;
        });

        this.points = [firstPoint, ...otherPoints, lastPoint];
        this.updateMap();
        await this.buildRoute();
        
        this.showToast('Маршрут оптимизирован!', 'success');
    }

    // Сброс маршрута
    showResetConfirm() {
        if (this.points.length === 0) {
            this.showToast('Маршрут уже пустой', 'info');
            return;
        }
        
        const modalElement = document.getElementById('reset-confirm-modal');
        if (modalElement) {
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
        }
    }

    confirmResetRoute() {
        this.saveToHistory();
        this.points = [];
        this.clearMap();
        this.updateStats();
        this.updatePointsList();
        this.updateHistoryButtons();
        this.showToast('Маршрут сброшен', 'warning');
        
        const modalElement = document.getElementById('reset-confirm-modal');
        if (modalElement) {
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) modal.hide();
        }
    }

    // Сохранение маршрута
    async saveRoute() {
        const nameInput = document.getElementById('name');
        if (!nameInput) {
            this.showToast('Поле названия не найдено', 'danger');
            return;
        }
        
        const name = nameInput.value.trim();
        if (!name) {
            this.showToast('Укажите название маршрута', 'warning');
            nameInput.focus();
            return;
        }

        // ИСПРАВЛЕНО: Проверяем минимум 2 точки
        if (this.points.length < 2) {
            this.showToast('Добавьте хотя бы две точки маршрута', 'warning');
            return;
        }

        console.log('=== Начинаем сохранение маршрута ===');
        console.log('Название:', name);
        console.log('Количество точек:', this.points.length);
        console.log('Точки:', this.points);

        const routeLoading = document.getElementById('route-loading');
        if (routeLoading) routeLoading.style.display = 'flex';

        try {
            // Получаем фото маршрута
            const routePhotos = this.getRoutePhotos();
            
            console.log('Фото маршрута:', routePhotos.length);
            
            // Формируем данные
            const routeData = {
                name: name,
                short_description: document.getElementById('short_description')?.value || '',
                description: document.getElementById('description')?.value || '',
                route_type: this.routeType,
                privacy: document.getElementById('privacy')?.value || 'public',
                mood: document.getElementById('mood')?.value || '',
                theme: document.getElementById('theme')?.value || '',
                difficulty: document.getElementById('difficulty')?.value || 'easy',
                duration_display: document.getElementById('duration_display')?.value || '',
                duration_minutes: parseInt(document.getElementById('duration_minutes')?.value) || 0,
                total_distance: parseFloat(this.calculateTotalDistance()) || 0,
                has_audio_guide: document.getElementById('has_audio_guide')?.checked || false,
                is_elderly_friendly: document.getElementById('is_elderly_friendly')?.checked || false,
                is_child_friendly: document.getElementById('is_child_friendly')?.checked || false,
                is_active: document.getElementById('is_active') ? document.getElementById('is_active').checked : true,
                route_photos: routePhotos,
                waypoints: this.points.map((point, index) => ({
                    name: point.name,
                    description: point.description || '',
                    address: point.address || '',
                    lat: this.normalizeCoordinate(point.lat),
                    lng: this.normalizeCoordinate(point.lng),
                    category: point.category || '',
                    hint_author: point.hint_author || '',
                    tags: point.tags || [],
                    photos: this.getPointPhotos(index) || [],
                    has_audio: point.has_audio || false
                }))
            };

            console.log('Данные для отправки:', routeData);

            // Определяем URL и метод
            let url, method;
            
            // Проверяем, редактируем ли существующий маршрут
            const isEdit = window.routeData && window.routeData.id;
            console.log('Режим редактирования:', isEdit, 'ID:', window.routeData?.id);

            if (isEdit) {
                url = `/routes/api/routes/${window.routeData.id}/`;
                method = 'PUT';
            } else {
                url = '/routes/api/routes/';
                method = 'POST';
            }

            console.log('Отправка запроса:', method, url);

            // Получаем CSRF токен
            const csrfToken = this.getCSRFToken();
            if (!csrfToken) {
                this.showToast('Ошибка CSRF токена', 'danger');
                return;
            }

            // Отправляем запрос
            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken,
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify(routeData)
            });

            console.log('Статус ответа:', response.status);

            // Обрабатываем ответ
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Ошибка сервера:', response.status, errorText);
                
                let errorMessage = `HTTP ${response.status}: `;
                if (response.status === 400) {
                    errorMessage += 'Неверные данные';
                } else if (response.status === 401) {
                    errorMessage += 'Требуется авторизация';
                } else if (response.status === 403) {
                    errorMessage += 'Доступ запрещен';
                } else if (response.status === 404) {
                    errorMessage += 'Страница не найдена';
                } else {
                    errorMessage += errorText.substring(0, 100);
                }
                
                throw new Error(errorMessage);
            }

            const data = await response.json();
            console.log('Ответ сервера:', data);

            // Проверяем успешность
            if (data.id || data.route_id || data.success) {
                const routeId = data.id || data.route_id;
                this.showToast('✅ Маршрут успешно сохранен!', 'success');
                
                // Обновляем ID точек если они есть в ответе
                if (data.points) {
                    data.points.forEach((savedPoint, idx) => {
                        if (this.points[idx]) {
                            this.points[idx].id = savedPoint.id;
                        }
                    });
                }
                
                // Переход через 1.5 секунды
                setTimeout(() => {
                    if (routeId) {
                        window.location.href = `/routes/${routeId}/`;
                    } else {
                        window.location.href = '/routes/my/';
                    }
                }, 1500);
                
            } else {
                this.showToast('Сервер не вернул ID маршрута', 'warning');
                setTimeout(() => {
                    window.location.href = '/routes/my/';
                }, 1500);
            }

        } catch (error) {
            console.error('Ошибка сохранения:', error);
            
            let errorMessage = error.message;
            if (error.message.includes('Failed to fetch')) {
                errorMessage = 'Ошибка сети. Проверьте подключение к интернету.';
            } else if (error.message.includes('404')) {
                errorMessage = 'Сервер не отвечает. Проверьте URL API.';
            }
            
            this.showToast(`Ошибка: ${errorMessage}`, 'danger');
            
        } finally {
            if (routeLoading) routeLoading.style.display = 'none';
        }
    }

    // История изменений
    saveToHistory() {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(JSON.parse(JSON.stringify(this.points)));
        this.historyIndex++;
        this.updateHistoryButtons();
    }

    undo() {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.points = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
            this.updateMap();
        }
    }

    redo() {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.points = JSON.parse(JSON.stringify(this.history[this.historyIndex]));
            this.updateMap();
        }
    }

    updateHistoryButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');
        
        if (undoBtn) undoBtn.disabled = this.historyIndex <= 0;
        if (redoBtn) redoBtn.disabled = this.historyIndex >= this.history.length - 1;
    }

    // Поиск
    initSearch() {
        const searchInput = document.getElementById('search-place');
        const searchBtn = document.getElementById('search-btn');

        if (searchInput) {
            searchInput.addEventListener('input', this.debounce(async (e) => {
                const query = e.target.value.trim();
                if (query.length < 3) {
                    const container = document.getElementById('search-suggestions');
                    if (container) container.style.display = 'none';
                    return;
                }
                await this.searchPlaces(query);
            }, 300));

            searchInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.searchPlaces(searchInput.value.trim());
                }
            });
        }

        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                const searchInput = document.getElementById('search-place');
                if (searchInput) {
                    this.searchPlaces(searchInput.value.trim());
                }
            });
        }
    }

    async searchPlaces(query) {
        const container = document.getElementById('search-suggestions');
        if (!container) return;
        
        if (!query) {
            container.style.display = 'none';
            return;
        }

        container.innerHTML = '<div class="search-suggestion text-muted">🔎 Поиск...</div>';
        container.style.display = 'block';

        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=8&addressdetails=1`
            );
            const results = await response.json();

            if (results.length === 0) {
                container.innerHTML = '<div class="search-suggestion text-muted">Место не найдено</div>';
                return;
            }

            container.innerHTML = '';
            results.forEach(result => {
                const item = document.createElement('div');
                item.className = 'search-suggestion';
                item.innerHTML = this.createSearchSuggestionHTML(result);
                item.addEventListener('click', () => this.addPointFromSearch(result));
                container.appendChild(item);
            });
        } catch (error) {
            console.error('Ошибка поиска:', error);
            container.innerHTML = '<div class="search-suggestion text-danger">Ошибка поиска</div>';
        }
    }

    createSearchSuggestionHTML(result) {
        const icon = this.getPlaceIcon(result);
        const name = result.display_name.split(',')[0];
        const address = result.display_name.length > 50 ? 
            result.display_name.substring(0, 50) + '...' : result.display_name;
        
        return `
            <div style="font-size: 18px; margin-right: 8px;">${icon}</div>
            <div style="flex: 1; min-width: 0;">
                <div style="font-weight: 600; margin-bottom: 2px;">${name}</div>
                <div style="font-size: 12px; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${address}</div>
            </div>
        `;
    }

    getPlaceIcon(place) {
        const types = {
            'tourist_attraction': '🏛️',
            'tourism': '🏛️',
            'shop': '🛍️',
            'mall': '🛍️',
            'amenity': '🏢',
            'natural': '🌳',
            'park': '🌲',
            'restaurant': '🍴',
            'cafe': '☕',
            'hotel': '🏨',
            'museum': '🎨',
            'bus_stop': '🚏',
            'viewpoint': '👁️',
            'monument': '🗿',
            'church': '⛪',
            'beach': '🏖️'
        };

        for (const [type, icon] of Object.entries(types)) {
            if (place.type === type || place.class === type) {
                return icon;
            }
        }
        return '📍';
    }

    addPointFromSearch(result) {
        const point = {
            name: result.display_name.split(',')[0],
            lat: this.normalizeCoordinate(result.lat),
            lng: this.normalizeCoordinate(result.lon),
            address: result.display_name,
            description: '',
            photos: [],
            tags: [],
            category: this.detectCategory(result),
            hint_author: '',
            has_audio: false
        };

        this.addPointToRoute(point);
        const searchInput = document.getElementById('search-place');
        if (searchInput) searchInput.value = '';
        const searchSuggestions = document.getElementById('search-suggestions');
        if (searchSuggestions) searchSuggestions.style.display = 'none';
        
        this.map.setView([point.lat, point.lng], 16);
    }

    detectCategory(result) {
        const categories = {
            'park': 'nature',
            'forest': 'forest',
            'museum': 'attraction',
            'monument': 'attraction',
            'restaurant': 'restaurant',
            'cafe': 'restaurant',
            'hotel': 'hotel',
            'viewpoint': 'viewpoint',
            'bus_stop': 'bus_stop',
            'church': 'attraction',
            'beach': 'nature'
        };

        for (const [keyword, category] of Object.entries(categories)) {
            if (result.display_name.toLowerCase().includes(keyword) || 
                result.type?.includes(keyword) ||
                result.class?.includes(keyword)) {
                return category;
            }
        }
        return '';
    }

    // Вспомогательные методы
    toggleMapStyle() {
        if (this.map.hasLayer(this.osmLayer)) {
            this.map.removeLayer(this.osmLayer);
            this.satelliteLayer.addTo(this.map);
            document.getElementById('style-toggle').innerHTML = '<i class="fas fa-map"></i>';
        } else {
            this.map.removeLayer(this.satelliteLayer);
            this.osmLayer.addTo(this.map);
            document.getElementById('style-toggle').innerHTML = '<i class="fas fa-satellite"></i>';
        }
    }

    locateUser() {
        if (!navigator.geolocation) {
            this.showToast('Геолокация не поддерживается вашим браузером', 'warning');
            // Центрируем на Москве
            this.map.setView(this.defaultCenter, 10);
            return;
        }

        const routeLoading = document.getElementById('route-loading');
        if (routeLoading) routeLoading.style.display = 'flex';

        // Опции для геолокации
        const options = {
            enableHighAccuracy: true,
            timeout: 10000, // 10 секунд
            maximumAge: 300000 // 5 минут
        };

        navigator.geolocation.getCurrentPosition(
            (position) => {
                // Успешное определение местоположения
                const latlng = [position.coords.latitude, position.coords.longitude];
                this.userLocation = latlng;
                
                this.map.setView(latlng, 16);
                
                if (routeLoading) routeLoading.style.display = 'none';
                this.showToast('Ваше местоположение определено', 'success');
                
                // Добавляем маркер текущего местоположения
                this.addUserLocationMarker(latlng[0], latlng[1]);
            },
            (error) => {
                if (routeLoading) routeLoading.style.display = 'none';
                
                let errorMessage = 'Не удалось определить ваше местоположение. ';
                
                switch(error.code) {
                    case error.PERMISSION_DENIED:
                        errorMessage += 'Разрешение на доступ к геолокации отклонено. ';
                        break;
                    case error.POSITION_UNAVAILABLE:
                        errorMessage += 'Информация о местоположении недоступна. ';
                        break;
                    case error.TIMEOUT:
                        errorMessage += 'Время ожидания определения местоположения истекло. ';
                        break;
                    default:
                        errorMessage += 'Произошла неизвестная ошибка. ';
                        break;
                }
                
                errorMessage += 'Карта центрирована на Москве.';
                
                // Центрируем карту на Москве
                this.map.setView(this.defaultCenter, 10);
                this.showToast(errorMessage, 'info', 5000);
            },
            options
        );
    }

    addUserLocationMarker(lat, lng) {
        // Удаляем старый маркер, если есть
        if (this.userLocationMarker) {
            this.map.removeLayer(this.userLocationMarker);
        }

        // Создаем красивый маркер местоположения
        this.userLocationMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: 'user-location-marker',
                html: `
                    <div class="user-location-pulse">
                        <div class="user-location-dot"></div>
                    </div>
                `,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            }),
            zIndexOffset: 1000
        }).addTo(this.map);

        // Добавляем всплывающую подсказку
        this.userLocationMarker.bindPopup(`
            <div class="text-center">
                <strong>Ваше местоположение</strong><br>
                <small>Определено автоматически</small>
            </div>
        `);
    }

    showAddPointHint() {
        this.showToast('Кликните по карте, чтобы добавить точку', 'info');
    }

    showToast(message, type = 'info') {
        // Создаем простой toast без Bootstrap
        const toast = document.createElement('div');
        toast.className = `toast-message toast-${type}`;
        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 2000;
            padding: 12px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            max-width: 300px;
            word-wrap: break-word;
        `;
        
        // Цвета в зависимости от типа
        const colors = {
            'success': '#10b981',
            'warning': '#f59e0b', 
            'danger': '#ef4444',
            'info': '#3b82f6'
        };
        
        toast.style.backgroundColor = colors[type] || colors.info;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        // Автоматическое скрытие
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 3000);
    }

    getCSRFToken() {
        const csrfInput = document.querySelector('[name=csrfmiddlewaretoken]');
        if (csrfInput) {
            return csrfInput.value;
        }
        
        const cookieValue = document.cookie
            .split('; ')
            .find(row => row.startsWith('csrftoken='))
            ?.split('=')[1];
        
        if (cookieValue) {
            return cookieValue;
        }
        
        const metaToken = document.querySelector('meta[name="csrf-token"]');
        if (metaToken) {
            return metaToken.getAttribute('content');
        }
        
        console.error('CSRF token not found');
        return '';
    }

    normalizeCoordinate(coord) {
        console.log('Нормализация координаты:', coord, 'тип:', typeof coord);
        
        if (coord === null || coord === undefined || coord === '') {
            console.warn('Координата пустая:', coord);
            return 0;
        }
        
        if (typeof coord === 'number') {
            return coord;
        }
        
        if (typeof coord === 'string') {
            const normalized = coord.toString().trim().replace(/,/g, '.');
            const cleaned = normalized.replace(/[^\d.-]/g, '');
            const parsed = parseFloat(cleaned);
            
            console.log('После очистки:', cleaned, '->', parsed);
            
            if (isNaN(parsed)) {
                console.error('Неверный формат координаты:', coord);
                return 0;
            }
            
            return parsed;
        }
        
        const parsed = parseFloat(coord);
        console.log('Прямой парсинг:', coord, '->', parsed);
        return isNaN(parsed) ? 0 : parsed;
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Улучшенное создание элемента списка точек
    createPointListItem(point, index) {
        const item = document.createElement('div');
        item.className = 'point-card p-3';
        if (this.currentEditIndex === index) {
            item.classList.add('active');
        }
        
        item.innerHTML = this.createEnhancedPointCardHTML(point, index);
        
        item.addEventListener('click', () => this.showPointDetails(index));
        item.addEventListener('dblclick', () => this.editPoint(index));
        
        return item;
    }

    createEnhancedPointCardHTML(point, index) {
        const isStart = index === 0;
        const isEnd = index === this.points.length - 1;
        
        let markerClass = 'marker-waypoint';
        let markerText = (index + 1).toString();
        if (isStart) {
            markerClass = 'marker-start';
            markerText = 'A';
        } else if (isEnd) {
            markerClass = 'marker-end';
            markerText = 'B';
        }

        // Превью фото точки
        const photoPreview = point.photos && point.photos.length > 0 ? 
            `<img src="${point.photos[0]}" class="point-photo-preview" alt="${point.name}">` :
            `<div class="point-photo-placeholder">
                <i class="fas fa-camera text-muted"></i>
            </div>`;

        // Медиа индикаторы
        const mediaIndicators = [];
        if (point.photos && point.photos.length > 0) {
            mediaIndicators.push(`
                <div class="media-indicator media-photo" title="${point.photos.length} фото">
                    <i class="fas fa-camera"></i>
                </div>
            `);
        }
        if (point.has_audio || point.audio_guide) {
            mediaIndicators.push(`
                <div class="media-indicator media-audio audio-indicator" title="${point.audio_guide ? 'AI аудиогид' : 'Записанное аудио'}">
                    <i class="fas fa-headphones ${point.audio_guide ? 'text-success' : 'text-primary'}"></i>
                </div>
            `);
        }
        if (point.category) {
            mediaIndicators.push(`
                <div class="media-indicator media-category" title="${this.getCategoryName(point.category)}">
                    <i class="${this.getCategoryFAIcon(point.category)}"></i>
                </div>
            `);
        }

        // Время и расстояние от предыдущей точки
        const distanceInfo = this.calculateLegDistance(index);
        const timeInfo = this.calculateLegTime(index);

        return `
            <div class="d-flex align-items-start gap-3">
                <!-- Маркер точки -->
                <div class="point-marker ${markerClass} flex-shrink-0">
                    ${markerText}
                </div>
                
                <!-- Превью фото -->
                <div class="flex-shrink-0">
                    ${photoPreview}
                </div>
                
                <!-- Основная информация -->
                <div class="flex-grow-1 min-w-0">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <h6 class="mb-0 fw-bold text-dark line-clamp-1">${point.name}</h6>
                        <div class="point-media-indicators">
                            ${mediaIndicators.join('')}
                        </div>
                    </div>
                    
                    <p class="text-muted small mb-2 line-clamp-2">${point.address}</p>
                    
                    <!-- Дополнительная информация -->
                    <div class="d-flex gap-3 text-xs text-muted mb-2">
                        ${distanceInfo ? `<div><i class="fas fa-route me-1"></i>${distanceInfo}</div>` : ''}
                        ${timeInfo ? `<div><i class="fas fa-clock me-1"></i>${timeInfo}</div>` : ''}
                    </div>
                    
                    <!-- Теги и категория -->
                    <div class="d-flex flex-wrap gap-1">
                        ${point.category ? `
                            <span class="badge bg-primary bg-opacity-10 text-primary border-0 px-2 py-1 rounded-pill ultra-small">
                                <i class="${this.getCategoryFAIcon(point.category)} me-1"></i>${this.getCategoryName(point.category)}
                            </span>
                        ` : ''}
                        
                        ${point.tags && point.tags.length > 0 ? point.tags.slice(0, 2).map(tag => `
                            <span class="badge bg-light text-dark border px-2 py-1 rounded-pill ultra-small">
                                #${tag}
                            </span>
                        `).join('') : ''}
                        
                        ${point.tags && point.tags.length > 2 ? `
                            <span class="badge bg-light text-muted border px-2 py-1 rounded-pill ultra-small">
                                +${point.tags.length - 2}
                            </span>
                        ` : ''}
                    </div>
                </div>
            </div>
            
            <!-- Действия -->
            <div class="d-flex gap-2 mt-3 pt-2 border-top">
                <button class="btn btn-sm btn-outline-primary flex-fill" onclick="event.stopPropagation(); routeEditor.editPoint(${index})">
                    <i class="fas fa-edit me-1"></i>Редактировать
                </button>
                <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); routeEditor.showDeleteConfirm(${index})">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `;
    }

    getCategoryFAIcon(category) {
        const icons = {
            'attraction': 'fas fa-landmark',
            'nature': 'fas fa-tree',
            'forest': 'fas fa-tree',
            'bus_stop': 'fas fa-bus',
            'viewpoint': 'fas fa-binoculars',
            'restaurant': 'fas fa-utensils',
            'hotel': 'fas fa-hotel',
            'museum': 'fas fa-landmark',
            'park': 'fas fa-tree',
            'monument': 'fas fa-monument',
            'church': 'fas fa-church',
            'beach': 'fas fa-umbrella-beach'
        };
        return icons[category] || 'fas fa-map-marker-alt';
    }

    calculateLegDistance(index) {
        if (index === 0) return null;
        const prevPoint = this.points[index - 1];
        const currentPoint = this.points[index];
        
        const distance = this.calculateDistance(
            prevPoint.lat, prevPoint.lng,
            currentPoint.lat, currentPoint.lng
        );
        
        return distance < 1 ? `${(distance * 1000).toFixed(0)}м` : `${distance.toFixed(1)}км`;
    }

    calculateLegTime(index) {
        if (index === 0) return null;
        
        const distance = this.calculateDistance(
            this.points[index - 1].lat, this.points[index - 1].lng,
            this.points[index].lat, this.points[index].lng
        );
        
        // Предполагаемая скорость в зависимости от типа маршрута
        const speeds = {
            'walking': 5, // км/ч
            'cycling': 15, // км/ч
            'driving': 50  // км/ч
        };
        
        const speed = speeds[this.routeType] || 5;
        const timeMinutes = Math.round((distance / speed) * 60);
        
        if (timeMinutes < 60) {
            return `${timeMinutes}мин`;
        } else {
            const hours = Math.floor(timeMinutes / 60);
            const minutes = timeMinutes % 60;
            return minutes > 0 ? `${hours}ч ${minutes}мин` : `${hours}ч`;
        }
    }

    // Обновляем метод для расчета общего времени
    updateStats() {
        document.getElementById('points-count').textContent = this.points.length;
        document.getElementById('points-count-display').textContent = this.points.length;
        
        const totalDistance = this.calculateTotalDistance();
        document.getElementById('total-distance').textContent = totalDistance + ' км';
        
        // Обновляем время
        this.updateEstimatedTime();
        
        const totalDistanceInput = document.getElementById('total_distance');
        if (totalDistanceInput) {
            totalDistanceInput.value = totalDistance;
        }
    }

    updateEstimatedTime() {
        const timeElement = document.getElementById('estimated-time');
        if (!timeElement) return;
        
        if (this.points.length < 2) {
            timeElement.textContent = '-';
            return;
        }
        
        const totalDistance = this.calculateTotalDistance();
        const speeds = {
            'walking': 5,
            'cycling': 15,
            'driving': 50
        };
        
        const speed = speeds[this.routeType] || 5;
        const totalHours = totalDistance / speed;
        
        if (totalHours < 1) {
            const minutes = Math.round(totalHours * 60);
            timeElement.textContent = `${minutes} мин`;
        } else if (totalHours < 3) {
            const hours = Math.floor(totalHours);
            const minutes = Math.round((totalHours - hours) * 60);
            timeElement.textContent = minutes > 0 ? `${hours}ч ${minutes}мин` : `${hours}ч`;
        } else {
            timeElement.textContent = `${Math.round(totalHours)}ч`;
        }
    }

    // Методы для фото маршрута
    initRoutePhotoHandlers() {
        this.safeAddEventListener('route-main-photo', 'change', (e) => {
            this.handleRouteMainPhotoUpload(e.target.files[0]);
        });
        
        this.safeAddEventListener('route-additional-photos', 'change', (e) => {
            this.handleRouteAdditionalPhotosUpload(e.target.files);
        });
    }

    initPointPhotoHandlers() {
        const mainPhotoInput = document.getElementById('main-photo-upload');
        const additionalPhotosInput = document.getElementById('additional-photos-upload');
        
        if (mainPhotoInput) {
            mainPhotoInput.addEventListener('change', (e) => {
                this.handlePointMainPhotoUpload(e.target.files[0]);
            });
        }
        
        if (additionalPhotosInput) {
            additionalPhotosInput.addEventListener('change', (e) => {
                this.handlePointAdditionalPhotosUpload(e.target.files);
            });
        }
        
        // Обработчики для удаления фото
        this.setupPointPhotoRemoveHandlers();
    }

    setupPointPhotoRemoveHandlers() {
        // Обработчик для удаления основного фото
        const mainRemoveBtn = document.querySelector('#point-editor-modal .main-photo-preview .photo-remove-btn');
        if (mainRemoveBtn) {
            mainRemoveBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.removePointMainPhoto();
            });
        }
    }

    removePointMainPhoto() {
        const uploadSection = document.querySelector('#point-editor-modal .main-photo-upload');
        const preview = uploadSection.querySelector('.main-photo-preview');
        const placeholder = uploadSection.querySelector('.h-100');
        const fileInput = document.getElementById('main-photo-upload');
        
        if (preview) preview.style.display = 'none';
        if (placeholder) placeholder.style.display = 'flex';
        if (fileInput) fileInput.value = '';
        this.pointMainPhotoFile = null;
    }

    handleRouteMainPhotoUpload(file) {
        if (!file || !this.validateImageFile(file)) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const uploadSection = document.querySelector('.main-photo-section .main-photo-upload');
            if (!uploadSection) return;
            
            const preview = uploadSection.querySelector('.main-photo-preview');
            const placeholder = uploadSection.querySelector('.h-100');
            
            if (placeholder) placeholder.style.display = 'none';
            if (preview) {
                preview.style.display = 'block';
                const img = preview.querySelector('img');
                if (img) img.src = e.target.result;
            }
            
            this.routeMainPhotoFile = file;
        };
        reader.readAsDataURL(file);
    }

    handleRouteAdditionalPhotosUpload(files) {
        const grid = document.querySelector('.additional-photos-grid');
        if (!grid) return;
        
        Array.from(files).forEach(file => {
            if (!this.validateImageFile(file)) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const photoItem = this.createAdditionalPhotoItem(e.target.result, file);
                grid.insertBefore(photoItem, grid.lastElementChild);
                this.routeAdditionalPhotoFiles.push(file);
            };
            reader.readAsDataURL(file);
        });
    }

    handlePointMainPhotoUpload(file) {
        if (!file || !this.validateImageFile(file)) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const uploadSection = document.querySelector('#point-editor-modal .main-photo-upload');
            if (!uploadSection) return;
            
            const preview = uploadSection.querySelector('.main-photo-preview');
            const placeholder = uploadSection.querySelector('.h-100');
            
            if (placeholder) placeholder.style.display = 'none';
            if (preview) {
                preview.style.display = 'block';
                const img = preview.querySelector('img');
                if (img) img.src = e.target.result;
            }
            
            this.pointMainPhotoFile = file;
        };
        reader.readAsDataURL(file);
    }

    handlePointAdditionalPhotosUpload(files) {
        const grid = document.querySelector('#point-editor-modal .additional-photos-grid');
        if (!grid) return;
        
        const currentCount = grid.querySelectorAll('.additional-photo-item').length;
        
        if (currentCount + files.length > 4) {
            this.showToast('Максимум можно загрузить 4 дополнительных фото', 'warning');
            return;
        }

        Array.from(files).forEach(file => {
            if (!this.validateImageFile(file)) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const photoItem = this.createPointAdditionalPhotoItem(e.target.result);
                // Вставляем перед кнопкой загрузки
                grid.insertBefore(photoItem, grid.lastElementChild);
                this.pointAdditionalPhotoFiles.push(file);
                this.updatePointAdditionalPhotosCount();
            };
            reader.readAsDataURL(file);
        });
    }

    createPointAdditionalPhotoItem(src) {
        const div = document.createElement('div');
        div.className = 'additional-photo-item';
        div.innerHTML = `
            <img src="${src}" class="w-100 h-100 object-fit-cover rounded">
            <button type="button" class="btn btn-sm btn-danger photo-remove-btn position-absolute top-0 end-0 m-1"
                    onclick="routeEditor.removePointAdditionalPhoto(this)">
                <i class="fas fa-times"></i>
            </button>
        `;
        return div;
    }

    removePointAdditionalPhoto(button) {
        const photoItem = button.closest('.additional-photo-item');
        if (photoItem) {
            const index = Array.from(photoItem.parentNode.children).indexOf(photoItem);
            this.pointAdditionalPhotoFiles.splice(index, 1);
            photoItem.remove();
            this.updatePointAdditionalPhotosCount();
        }
    }

    updatePointAdditionalPhotosCount() {
        const grid = document.querySelector('#point-editor-modal .additional-photos-grid');
        const countElement = document.getElementById('additional-photos-count');
        if (grid && countElement) {
            const photoCount = grid.querySelectorAll('.additional-photo-item').length;
            countElement.textContent = `${photoCount}/4`;
            
            // Скрываем кнопку загрузки если достигнут лимит
            const uploadButton = grid.querySelector('.additional-photo-upload');
            if (uploadButton) {
                uploadButton.style.display = photoCount >= 4 ? 'none' : 'flex';
            }
        }
    }
    // Инициализация AI аудио менеджера
    initAudioGenerationManager() {
        if (!window.audioGenerationManager) {
            console.warn('AudioGenerationManager not found');
            return;
        }
        
        // Настройка обработчиков для AI аудио
        this.setupAudioGenerationHandlers();
    }

    setupAudioGenerationHandlers() {
        // Делегирование событий для AI аудио кнопок
        document.addEventListener('click', (e) => {
            if (e.target.closest('.generate-audio-btn')) {
                this.openAudioSettings();
            }
            if (e.target.closest('.regenerate-audio-btn')) {
                this.openAudioSettings();
            }
            if (e.target.closest('.delete-audio-btn')) {
                this.deleteAIAudio();
            }
            if (e.target.closest('.retry-audio-btn')) {
                this.openAudioSettings();
            }
        });

        // Модальное окно генерации
        const confirmGenerateBtn = document.getElementById('confirm-generate-audio');
        if (confirmGenerateBtn) {
            confirmGenerateBtn.addEventListener('click', () => {
                this.generateAIAudio();
            });
        }
    }

    // Показ аудио контролов для точки
    showAudioForPoint(pointId, pointData) {
        if (window.audioGenerationManager) {
            window.audioGenerationManager.showAudioForPoint(pointId, pointData);
        } else {
            console.warn('AudioGenerationManager not available');
        }
    }

    // Открытие настроек аудио
    openAudioSettings() {
        if (!window.audioGenerationManager) {
            this.showToast('AI аудио сервис недоступен', 'warning');
            return;
        }
        window.audioGenerationManager.openAudioSettings();
    }

    // Генерация AI аудио
    async generateAIAudio() {
        if (!window.audioGenerationManager || this.currentEditIndex === null) {
            this.showToast('Не выбрана точка для генерации аудио', 'warning');
            return;
        }

        const pointId = this.points[this.currentEditIndex].id;
        if (!pointId) {
            this.showToast('Точка не сохранена. Сначала сохраните точку.', 'warning');
            return;
        }

        try {
            await window.audioGenerationManager.generateAudio();
        } catch (error) {
            console.error('AI audio generation error:', error);
            this.showToast('Ошибка генерации аудио: ' + error.message, 'danger');
        }
    }

    // Удаление AI аудио
    async deleteAIAudio() {
        if (!window.audioGenerationManager || this.currentEditIndex === null) {
            return;
        }

        const pointId = this.points[this.currentEditIndex].id;
        if (!pointId) {
            this.showToast('Точка не сохранена', 'warning');
            return;
        }

        try {
            await window.audioGenerationManager.deleteAudio();
            // Обновляем состояние точки
            this.points[this.currentEditIndex].has_audio = false;
            this.points[this.currentEditIndex].audio_guide = null;
            this.updatePointsList();
        } catch (error) {
            console.error('AI audio deletion error:', error);
            this.showToast('Ошибка удаления аудио', 'danger');
        }
    }

    // Обновление аудио в данных точки
    updatePointAudio(pointId, audioUrl) {
        const pointIndex = this.points.findIndex(p => p.id === pointId);
        if (pointIndex !== -1) {
            this.points[pointIndex].audio_guide = audioUrl;
            this.points[pointIndex].has_audio = !!audioUrl;
            this.updatePointInList(pointIndex);
        }
    }

    // Обновление точки в списке (добавь аудио индикатор)
    updatePointInList(index) {
        const point = this.points[index];
        if (!point) return;
        
        const pointElement = document.querySelector(`[data-point-id="${index}"]`);
        if (pointElement) {
            // Обновляем индикатор аудио
            const audioIndicator = pointElement.querySelector('.audio-indicator');
            if (audioIndicator) {
                if (point.audio_guide) {
                    audioIndicator.innerHTML = '<i class="fas fa-headphones text-success"></i>';
                    audioIndicator.title = 'Есть аудиогид';
                } else {
                    audioIndicator.innerHTML = '<i class="fas fa-headphones text-muted"></i>';
                    audioIndicator.title = 'Нет аудиогида';
                }
            }
        }
    }
}

// Глобальная переменная для доступа из HTML
let routeEditor;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing Route Editor...');
    
    try {
        routeEditor = new RouteEditor();
        
        // Глобальные функции для вызова из HTML
        window.editPoint = (index) => routeEditor.editPoint(index);
        window.deletePoint = (index) => routeEditor.deletePoint(index);
        window.closePointDetails = () => routeEditor.closePointDetails();
        
        console.log('Route Editor initialized successfully');
    } catch (error) {
        console.error('Failed to initialize Route Editor:', error);
        // Показываем сообщение об ошибке пользователю
        const errorMessage = document.createElement('div');
        errorMessage.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: #ef4444;
            color: white;
            padding: 15px;
            text-align: center;
            z-index: 10000;
            font-weight: bold;
        `;
        errorMessage.textContent = 'Ошибка загрузки редактора маршрутов. Пожалуйста, обновите страницу.';
        document.body.appendChild(errorMessage);
    }
});

// Обработка Escape для закрытия поисковых подсказок
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const searchSuggestions = document.getElementById('search-suggestions');
        if (searchSuggestions) {
            searchSuggestions.style.display = 'none';
        }
    }
});

window.handleMainPhotoUpload = function(file) {
    if (routeEditor) {
        routeEditor.handlePointMainPhotoUpload(file);
    }
};

window.handleAdditionalPhotosUpload = function(files) {
    if (routeEditor) {
        routeEditor.handlePointAdditionalPhotosUpload(files);
    }
};

window.removeMainPhoto = function() {
    if (routeEditor) {
        routeEditor.removePointMainPhoto();
    }
};

window.removeAdditionalPhoto = function(button) {
    if (routeEditor) {
        routeEditor.removePointAdditionalPhoto(button);
    }
};

window.updatePointAudio = function(pointId, audioUrl) {
    if (routeEditor) {
        routeEditor.updatePointAudio(pointId, audioUrl);
    }
};

window.getCurrentPointId = function() {
    if (routeEditor && routeEditor.currentEditIndex !== null) {
        const point = routeEditor.points[routeEditor.currentEditIndex];
        return point.id || routeEditor.currentEditIndex;
    }
    return null;
};