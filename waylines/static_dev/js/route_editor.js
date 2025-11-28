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
        
        // Медиа данные для фото и аудио
        this.mainPhotoFile = null;
        this.additionalPhotoFiles = [];
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
        // Получаем начальные координаты из существующего маршрута или используем Москву по умолчанию
        const initialCoords = this.points.length > 0 ? 
            [this.points[0].lat, this.points[0].lng] : [55.7558, 37.6176];
        
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
        
        // Фотографии
        this.safeAddEventListener('main-photo-upload', 'change', (e) => {
            this.handleMainPhotoUpload(e.target.files[0]);
        });
        
        this.safeAddEventListener('additional-photos-upload', 'change', (e) => {
            this.handleAdditionalPhotosUpload(e.target.files);
        });

        // Аудио - исправленная инициализация
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

    // Редактирование точки
    editPoint(index) {
        this.currentEditIndex = index;
        const point = this.points[index];
        
        // Заполнение формы редактирования
        document.getElementById('edit-point-index').value = index;
        document.getElementById('point-name').value = point.name;
        document.getElementById('point-address').value = point.address;
        document.getElementById('point-description').value = point.description;
        document.getElementById('point-category').value = point.category;
        
        // ИСПРАВЛЕНИЕ: Сохраняем теги через запятую
        document.getElementById('point-tags').value = Array.isArray(point.tags) ? 
            point.tags.join(', ') : (point.tags || '');
        
        document.getElementById('point-hint-author').value = point.hint_author;
        document.getElementById('point-lat').value = point.lat.toFixed(6);
        document.getElementById('point-lng').value = point.lng.toFixed(6);
        
        // Загрузка фото данных
        this.loadPhotoData(point);
        
        // Загрузка аудио данных
        this.loadAudioData(point);
        
        // Показ модального окна
        const modalElement = document.getElementById('point-editor-modal');
        if (modalElement) {
            const modal = new bootstrap.Modal(modalElement);
            modal.show();
        }
    }

    loadPhotoData(point) {
        // Сброс фото данных
        this.mainPhotoFile = null;
        this.additionalPhotoFiles = [];
        
        const mainUpload = document.querySelector('.main-photo-upload');
        if (!mainUpload) return;
        
        const mainPreview = mainUpload.querySelector('.main-photo-preview');
        const mainPlaceholder = mainUpload.querySelector('.h-100');
        const additionalGrid = document.querySelector('.additional-photos-grid');
        
        // Сбрасываем основное фото
        if (mainPlaceholder) mainPlaceholder.style.display = 'flex';
        if (mainPreview) mainPreview.style.display = 'none';
        
        // Сбрасываем дополнительные фото
        if (additionalGrid) {
            const uploadButton = additionalGrid.lastElementChild;
            additionalGrid.innerHTML = '';
            if (uploadButton) additionalGrid.appendChild(uploadButton);
        }
        
        // Загружаем существующие фото если есть
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
        
        // Собираем все фото
        const allPhotos = [];
        if (this.mainPhotoFile) {
            const mainPreview = document.querySelector('.main-photo-preview img');
            if (mainPreview && mainPreview.src) {
                allPhotos.push(mainPreview.src);
            }
        }
        
        // Добавляем дополнительные фото
        const additionalItems = document.querySelectorAll('.additional-photo-item');
        additionalItems.forEach(item => {
            const img = item.querySelector('img');
            if (img && img.src) {
                allPhotos.push(img.src);
            }
        });

        // ИСПРАВЛЕНИЕ: Разделяем теги по запятой
        const tagsInput = document.getElementById('point-tags');
        const tags = tagsInput ? 
            tagsInput.value.split(',').map(tag => tag.trim()).filter(tag => tag) : [];

        this.points[index] = {
            ...this.points[index],
            name: name,
            address: document.getElementById('point-address')?.value || '',
            description: document.getElementById('point-description')?.value || '',
            category: document.getElementById('point-category')?.value || '',
            tags: tags, // Исправленный массив тегов
            hint_author: document.getElementById('point-hint-author')?.value || '',
            photos: allPhotos,
            has_audio: !!this.currentAudioFile,
            audio_file: this.currentAudioFile,
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
        if (!nameInput) return;
        
        const name = nameInput.value.trim();
        if (!name) {
            this.showToast('Укажите название маршрута', 'warning');
            nameInput.focus();
            return;
        }

        if (this.points.length === 0) {
            this.showToast('Добавьте хотя бы одну точку маршрута', 'warning');
            return;
        }

        const routeLoading = document.getElementById('route-loading');
        if (routeLoading) routeLoading.style.display = 'flex';

        try {
            const routeData = {
                name: name,
                short_description: document.getElementById('short_description')?.value || '',
                description: document.getElementById('description')?.value || '',
                route_type: this.routeType,
                privacy: document.getElementById('privacy')?.value || 'public',
                mood: document.getElementById('mood')?.value || '',
                theme: document.getElementById('theme')?.value || '',
                duration_minutes: parseInt(document.getElementById('duration_minutes')?.value) || 0,
                total_distance: parseFloat(this.calculateTotalDistance()) || 0,
                has_audio_guide: document.getElementById('has_audio_guide')?.checked || false,
                is_elderly_friendly: document.getElementById('is_elderly_friendly')?.checked || false,
                is_active: document.getElementById('is_active') ? document.getElementById('is_active').checked : true,
                waypoints: this.points.map((point, index) => ({
                    name: point.name,
                    description: point.description || '',
                    address: point.address || '',
                    lat: this.normalizeCoordinate(point.lat),
                    lng: this.normalizeCoordinate(point.lng),
                    category: point.category || '',
                    hint_author: point.hint_author || '',
                    tags: point.tags || []
                }))
            };

            const invalidPoints = routeData.waypoints.filter(point => 
                isNaN(point.lat) || isNaN(point.lng) || point.lat === 0 || point.lng === 0
            );
            
            if (invalidPoints.length > 0) {
                console.error('Неверные координаты:', invalidPoints);
                throw new Error('Обнаружены точки с неверными координатами');
            }

            let url, method;
            const isEdit = window.routeData && window.routeData.id;

            if (isEdit) {
                url = `/routes/api/routes/${window.routeData.id}/`;
                method = 'POST';
            } else {
                url = '/routes/api/routes/';
                method = 'POST';
            }

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCSRFToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify(routeData)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            
            if (data.success) {
                this.showToast('Маршрут успешно сохранен!', 'success');
                
                setTimeout(() => {
                    const routeId = data.route_id || data.id;
                    if (routeId) {
                        window.location.href = `/routes/${routeId}/`;
                    } else {
                        window.location.href = '/routes/my/';
                    }
                }, 1500);
            }

        } catch (error) {
            console.error('Ошибка сохранения:', error);
            let errorMessage = error.message;
            
            if (error.message.includes('Failed to fetch')) {
                errorMessage = 'Ошибка сети. Проверьте подключение к интернету.';
            } else if (error.message.includes('404')) {
                errorMessage = 'API endpoint не найден. Проверьте URL.';
            } else if (error.message.includes('403')) {
                errorMessage = 'Доступ запрещен. Возможно, нужно авторизоваться.';
            }
            
            this.showToast(`Ошибка сохранения: ${errorMessage}`, 'danger');
        } finally {
            const routeLoading = document.getElementById('route-loading');
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
            this.showToast('Геолокация не поддерживается', 'warning');
            return;
        }

        const routeLoading = document.getElementById('route-loading');
        if (routeLoading) routeLoading.style.display = 'flex';

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const latlng = [position.coords.latitude, position.coords.longitude];
                this.map.setView(latlng, 16);
                if (routeLoading) routeLoading.style.display = 'none';
                this.showToast('Местоположение определено', 'success');
                
                L.marker(latlng, {
                    icon: L.divIcon({
                        className: 'current-location-marker',
                        html: '<div style="background: #ff4444; border: 3px solid white; border-radius: 50%; width: 20px; height: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.3);"></div>',
                        iconSize: [20, 20],
                        iconAnchor: [10, 10]
                    })
                }).addTo(this.map).bindPopup('Ваше местоположение').openPopup();
            },
            (error) => {
                if (routeLoading) routeLoading.style.display = 'none';
                this.showToast('Не удалось определить местоположение', 'danger');
            }
        );
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
        if (coord === null || coord === undefined) {
            return 0;
        }
        
        if (typeof coord === 'number') {
            return coord;
        }
        
        if (typeof coord === 'string') {
            const normalized = coord.toString().trim().replace(/,/g, '.');
            const cleaned = normalized.replace(/[^\d.-]/g, '');
            const parsed = parseFloat(cleaned);
            
            if (isNaN(parsed)) {
                console.warn('Неверный формат координаты:', coord, '->', parsed);
                return 0;
            }
            
            return parsed;
        }
        
        return parseFloat(coord) || 0;
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