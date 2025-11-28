class RouteEditor {
    constructor() {
        this.map = null;
        this.points = [];
        this.markers = [];
        this.routeLine = null;
        this.routeType = 'walking';
        this.currentEditIndex = null;
        this.uploadedPhotos = [];
        this.history = [];
        this.historyIndex = 0;
        this.tempMarker = null;
        this.addressQueue = [];
        
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

    // НОВЫЙ МЕТОД: Нормализация координат
    normalizeCoordinate(coord) {
        if (coord === null || coord === undefined) {
            return 0;
        }
        
        // Если это число - возвращаем как есть
        if (typeof coord === 'number') {
            return coord;
        }
        
        // Если это строка - заменяем запятые на точки и парсим
        if (typeof coord === 'string') {
            // Удаляем лишние пробелы и заменяем запятые на точки
            const normalized = coord.toString().trim().replace(/,/g, '.');
            
            // Удаляем все символы кроме цифр, точек и минусов
            const cleaned = normalized.replace(/[^\d.-]/g, '');
            
            // Парсим в число
            const parsed = parseFloat(cleaned);
            
            // Проверяем результат
            if (isNaN(parsed)) {
                console.warn('Неверный формат координаты:', coord, '->', parsed);
                return 0;
            }
            
            return parsed;
        }
        
        // Для других типов пытаемся преобразовать в число
        return parseFloat(coord) || 0;
    }

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
                hint_author: point.hint_author || ''
            }));

            // Устанавливаем тип маршрута
            this.routeType = routeData.route_type || 'walking';
            document.querySelectorAll('.route-type-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.type === this.routeType);
            });

            // Вспомогательная функция для безопасной установки значений
            const setValueIfExists = (id, value) => {
                const element = document.getElementById(id);
                if (element) {
                    element.value = value || '';
                } else {
                    console.warn(`Element with id '${id}' not found`);
                }
            };

            const setCheckedIfExists = (id, checked) => {
                const element = document.getElementById(id);
                if (element) {
                    element.checked = !!checked;
                } else {
                    console.warn(`Element with id '${id}' not found`);
                }
            };

            // Заполняем форму маршрута с проверками
            setValueIfExists('name', routeData.name);
            setValueIfExists('short_description', routeData.short_description);
            setValueIfExists('description', routeData.description);
            setValueIfExists('duration_minutes', routeData.duration_minutes);
            setValueIfExists('total_distance', routeData.total_distance);
            setValueIfExists('privacy', routeData.privacy);
            setValueIfExists('mood', routeData.mood);
            setValueIfExists('theme', routeData.theme);
            
            // Исправляем поле route_type - проверяем разные варианты названия
            const routeTypeValue = routeData.route_type || routeData.routeType;
            setValueIfExists('route_type', routeTypeValue);

            setCheckedIfExists('has_audio_guide', routeData.has_audio_guide);
            setCheckedIfExists('is_elderly_friendly', routeData.is_elderly_friendly);
            setCheckedIfExists('is_active', routeData.is_active);

            this.updateMap();

            // Строим маршрут если есть точки
            if (this.points.length >= 2) {
                this.buildRoute();
            }
        }
    }

    initEventListeners() {
        // Переключение стилей карты
        document.getElementById('style-toggle').addEventListener('click', () => this.toggleMapStyle());
        
        // Определение местоположения
        document.getElementById('locate-me').addEventListener('click', () => this.locateUser());
        
        // Сброс маршрута
        document.getElementById('reset-route').addEventListener('click', () => this.showResetConfirm());
        
        // Сохранение маршрута
        document.getElementById('save-btn').addEventListener('click', () => this.saveRoute());
        
        // Оптимизация маршрута
        document.getElementById('optimize-btn').addEventListener('click', () => this.optimizeRoute());
        
        // Переключение типа маршрута
        document.querySelectorAll('.route-type-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setRouteType(e.target.dataset.type));
        });

        // История
        document.getElementById('undo-btn').addEventListener('click', () => this.undo());
        document.getElementById('redo-btn').addEventListener('click', () => this.redo());

        // Кнопка добавления точки
        document.getElementById('add-waypoint-btn').addEventListener('click', () => {
            this.showAddPointHint();
        });

        // Обработчики модальных окон
        document.getElementById('save-point-btn').addEventListener('click', () => this.savePoint());
        document.getElementById('confirm-delete-btn').addEventListener('click', () => this.confirmDeletePoint());
        document.getElementById('confirm-reset-btn').addEventListener('click', () => this.confirmResetRoute());

        // Загрузка фотографий
        document.getElementById('point-photo-upload').addEventListener('change', (e) => this.handlePhotoUpload(e));

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
                document.getElementById('search-suggestions').style.display = 'none';
            }
        });
    }

    initSearch() {
        const searchInput = document.getElementById('search-place');
        const searchBtn = document.getElementById('search-btn');

        searchInput.addEventListener('input', this.debounce(async (e) => {
            const query = e.target.value.trim();
            if (query.length < 3) {
                document.getElementById('search-suggestions').style.display = 'none';
                return;
            }
            await this.searchPlaces(query);
        }, 300));

        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.searchPlaces(searchInput.value.trim());
            }
        });

        searchBtn.addEventListener('click', () => {
            this.searchPlaces(searchInput.value.trim());
        });
    }

    async searchPlaces(query) {
        const container = document.getElementById('search-suggestions');
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
            hint_author: ''
        };

        this.addPointToRoute(point);
        document.getElementById('search-place').value = '';
        document.getElementById('search-suggestions').style.display = 'none';
        
        // Центрируем карту на новой точке
        this.map.setView([point.lat, point.lng], 16);
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
        const R = 6371; // Radius of the earth in km
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
            hint_author: ''
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
        
        return `
            <div style="text-align: center; min-width: 200px;">
                <strong>${point.name}</strong><br>
                <small>${point.address}</small>
                ${categoryName ? `<br><small>${categoryIcon} ${categoryName}</small>` : ''}
                ${point.photos.length > 0 ? 
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
        
        // Удаляем временные маркеры (если есть)
        if (this.tempMarker) {
            this.map.removeLayer(this.tempMarker);
            this.tempMarker = null;
        }
    }

    async buildRoute() {
        if (this.points.length < 2) return;

        try {
            document.getElementById('route-loading').style.display = 'flex';
            
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
            document.getElementById('route-loading').style.display = 'none';
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
        
        const apiKey = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjYyMzA1OTQzOTI2NzQ1MDBiMTUwOGUxYmVhZTUwMGM4IiwiaCI6Im11cm11cjY0In0=';
        
        const response = await fetch(`https://api.openrouteservice.org/v2/directions/${profile}/geojson`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': apiKey
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

    // Резервный метод - прямые линии между точками
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

    // Метод для определения цвета маршрута
    getRouteColor() {
        const colors = {
            'walking': '#48bb78',    // Зеленый для пешеходных
            'driving': '#2563eb',    // Синий для автомобильных
            'cycling': '#f59e0b'     // Оранжевый для велосипедных
        };
        return colors[this.routeType] || '#2563eb';
    }

    updateStats() {
        document.getElementById('points-count').textContent = this.points.length;
        document.getElementById('total-distance').textContent = this.calculateTotalDistance() + ' км';
        
        const totalDistanceInput = document.getElementById('total_distance');
        if (totalDistanceInput) {
            totalDistanceInput.value = this.calculateTotalDistance();
        }
    }

    updatePointsList() {
        const list = document.getElementById('points-list');
        
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

        return `
            <div class="waypoint-marker ${markerClass}">${markerText}</div>
            <div class="waypoint-content">
                <div class="waypoint-header">
                    <div class="waypoint-name">${point.name}</div>
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

    showPointDetails(index) {
        const point = this.points[index];
        const detailsDiv = document.getElementById('point-details');
        const title = document.getElementById('point-details-title');
        const content = document.getElementById('point-details-content');
        
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
        document.querySelectorAll('.waypoint-item')[index].classList.add('active');
        
        // Открываем popup на карте
        if (this.markers[index]) {
            this.markers[index].openPopup();
        }
    }

    closePointDetails() {
        document.getElementById('point-details').style.display = 'none';
        document.querySelectorAll('.waypoint-item').forEach(item => {
            item.classList.remove('active');
        });
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
        document.getElementById('point-tags').value = point.tags.join(', ');
        document.getElementById('point-hint-author').value = point.hint_author;
        document.getElementById('point-lat').value = point.lat.toFixed(6);
        document.getElementById('point-lng').value = point.lng.toFixed(6);
        
        this.uploadedPhotos = [...point.photos];
        this.updatePhotoPreview();
        
        // Показ модального окна
        const modal = new bootstrap.Modal(document.getElementById('point-editor-modal'));
        modal.show();
    }

    updatePhotoPreview() {
        const container = document.getElementById('point-photo-preview');
        container.innerHTML = '';
        
        this.uploadedPhotos.forEach((photo, index) => {
            const photoItem = document.createElement('div');
            photoItem.className = 'photo-item';
            photoItem.innerHTML = `
                <img src="${photo}" class="photo-preview" alt="Preview">
                <button type="button" class="remove-photo" onclick="routeEditor.removePhoto(${index})">×</button>
            `;
            container.appendChild(photoItem);
        });
    }

    handlePhotoUpload(e) {
        const files = e.target.files;
        
        for (let file of files) {
            const reader = new FileReader();
            reader.onload = (e) => {
                this.uploadedPhotos.push(e.target.result);
                this.updatePhotoPreview();
            };
            reader.readAsDataURL(file);
        }
        
        e.target.value = '';
    }

    removePhoto(index) {
        this.uploadedPhotos.splice(index, 1);
        this.updatePhotoPreview();
    }

    savePoint() {
        const index = this.currentEditIndex;
        const name = document.getElementById('point-name').value.trim();
        
        if (!name) {
            this.showToast('Введите название точки', 'warning');
            return;
        }

        this.saveToHistory();
        
        this.points[index] = {
            ...this.points[index],
            name: name,
            address: document.getElementById('point-address').value,
            description: document.getElementById('point-description').value,
            category: document.getElementById('point-category').value,
            tags: document.getElementById('point-tags').value.split(',').map(tag => tag.trim()).filter(tag => tag),
            hint_author: document.getElementById('point-hint-author').value,
            photos: [...this.uploadedPhotos],
            lat: this.normalizeCoordinate(document.getElementById('point-lat').value),
            lng: this.normalizeCoordinate(document.getElementById('point-lng').value)
        };

        this.updateMap();
        this.showToast('Точка сохранена', 'success');
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('point-editor-modal'));
        modal.hide();
    }

    showDeleteConfirm(index) {
        this.currentEditIndex = index;
        const pointName = this.points[index].name;
        document.getElementById('delete-point-name').textContent = pointName;
        
        const modal = new bootstrap.Modal(document.getElementById('delete-confirm-modal'));
        modal.show();
    }

    getWaypointsData() {
        return this.points.map((point, index) => ({
            name: point.name,
            description: point.description || '',
            address: point.address || '',
            lat: this.normalizeCoordinate(point.lat),
            lng: this.normalizeCoordinate(point.lng),
            category: point.category || '',
            hint_author: point.hint_author || '',
            tags: point.tags || []
        }));
    }

    confirmDeletePoint() {
        const index = this.currentEditIndex;
        if (index !== null) {
            this.saveToHistory();
            this.points.splice(index, 1);
            this.updateMap();
            this.showToast('Точка удалена', 'warning');
            
            const modal = bootstrap.Modal.getInstance(document.getElementById('delete-confirm-modal'));
            modal.hide();
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

    setRouteType(type) {
        this.routeType = type;
        
        // Обновляем активную кнопку
        document.querySelectorAll('.route-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });
        
        // Перестраиваем маршрут если есть точки
        if (this.points.length >= 2) {
            this.buildRoute();
        }
    }

    async optimizeRoute() {
        if (this.points.length < 3) {
            this.showToast('Нужно минимум 3 точки для оптимизации', 'warning');
            return;
        }

        // Простая оптимизация - сортировка по расстоянию от начальной точки
        this.saveToHistory();
        
        const firstPoint = this.points[0];
        const otherPoints = this.points.slice(1, -1); // Все точки кроме первой и последней
        const lastPoint = this.points[this.points.length - 1];

        // Сортируем по расстоянию от первой точки
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

    showResetConfirm() {
        if (this.points.length === 0) {
            this.showToast('Маршрут уже пустой', 'info');
            return;
        }
        
        const modal = new bootstrap.Modal(document.getElementById('reset-confirm-modal'));
        modal.show();
    }

    confirmResetRoute() {
        this.saveToHistory();
        this.points = [];
        this.clearMap(); // Используем clearMap вместо updateMap
        this.updateStats();
        this.updatePointsList();
        this.updateHistoryButtons();
        this.showToast('Маршрут сброшен', 'warning');
        
        const modal = bootstrap.Modal.getInstance(document.getElementById('reset-confirm-modal'));
        modal.hide();
    }

    resetRoute() {
        if (confirm('Вы уверены, что хотите сбросить весь маршрут? Все точки будут удалены.')) {
            this.saveToHistory();
            this.points = [];
            this.updateMap();
            this.showToast('Маршрут сброшен', 'warning');
        }
    }

    async saveRoute() {
        const name = document.getElementById('name').value.trim();
        if (!name) {
            this.showToast('Укажите название маршрута', 'warning');
            document.getElementById('name').focus();
            return;
        }

        if (this.points.length === 0) {
            this.showToast('Добавьте хотя бы одну точку маршрута', 'warning');
            return;
        }

        // Показываем индикатор загрузки
        document.getElementById('route-loading').style.display = 'flex';

        try {
            // Собираем данные маршрута с нормализованными координатами
            const routeData = {
                name: name,
                short_description: document.getElementById('short_description').value,
                description: document.getElementById('description').value,
                route_type: this.routeType,
                privacy: document.getElementById('privacy').value,
                mood: document.getElementById('mood').value,
                theme: document.getElementById('theme').value,
                duration_minutes: parseInt(document.getElementById('duration_minutes').value) || 0,
                total_distance: parseFloat(this.calculateTotalDistance()) || 0,
                has_audio_guide: document.getElementById('has_audio_guide').checked,
                is_elderly_friendly: document.getElementById('is_elderly_friendly').checked,
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

            console.log('Отправка данных маршрута:', routeData);

            // Проверяем координаты перед отправкой
            const invalidPoints = routeData.waypoints.filter(point => 
                isNaN(point.lat) || isNaN(point.lng) || point.lat === 0 || point.lng === 0
            );
            
            if (invalidPoints.length > 0) {
                console.error('Неверные координаты:', invalidPoints);
                throw new Error('Обнаружены точки с неверными координатами');
            }

            // ИСПРАВЛЕННЫЕ URL - используем правильный путь
            let url, method;
            const isEdit = window.routeData && window.routeData.id;

            if (isEdit) {
                // ПРАВИЛЬНЫЙ URL для редактирования
                url = `/routes/api/routes/${window.routeData.id}/`;
                method = 'POST'; // Ваш RouteUpdateView принимает POST
            } else {
                // ПРАВИЛЬНЫЙ URL для создания
                url = '/routes/api/routes/';
                method = 'POST';
            }

            console.log('URL:', url, 'Method:', method);

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCSRFToken(),
                    'X-Requested-With': 'XMLHttpRequest'
                },
                body: JSON.stringify(routeData)
            });

            // Проверяем ответ
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Ошибка сервера:', errorText);
                
                // Пытаемся распарсить JSON ошибки
                try {
                    const errorData = JSON.parse(errorText);
                    throw new Error(`HTTP ${response.status}: ${errorData.error || errorText}`);
                } catch (e) {
                    throw new Error(`HTTP ${response.status}: ${errorText}`);
                }
            }

            const data = await response.json();
            
            if (data.success) {
                this.showToast('Маршрут успешно сохранен!', 'success');
                
                setTimeout(() => {
                    const routeId = data.route_id || data.id;
                    if (routeId) {
                        // ТЕПЕРЬ ПРАВИЛЬНЫЙ ПУТЬ - без двойного префикса
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
            document.getElementById('route-loading').style.display = 'none';
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
        document.getElementById('undo-btn').disabled = this.historyIndex <= 0;
        document.getElementById('redo-btn').disabled = this.historyIndex >= this.history.length - 1;
    }

    // Вспомогательные методы
    toggleMapStyle() {
        if (this.map.hasLayer(this.osmLayer)) {
            this.map.removeLayer(this.osmLayer);
            this.satelliteLayer.addTo(this.map);
            document.getElementById('style-toggle').textContent = '🗺️ Карта';
        } else {
            this.map.removeLayer(this.satelliteLayer);
            this.osmLayer.addTo(this.map);
            document.getElementById('style-toggle').textContent = '🛰️ Спутник';
        }
    }

    locateUser() {
        if (!navigator.geolocation) {
            this.showToast('Геолокация не поддерживается', 'warning');
            return;
        }

        document.getElementById('route-loading').style.display = 'flex';

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const latlng = [position.coords.latitude, position.coords.longitude];
                this.map.setView(latlng, 16);
                document.getElementById('route-loading').style.display = 'none';
                this.showToast('Местоположение определено', 'success');
                
                // Добавляем маркер текущего местоположения
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
                document.getElementById('route-loading').style.display = 'none';
                this.showToast('Не удалось определить местоположение', 'danger');
            }
        );
    }

    showAddPointHint() {
        this.showToast('Кликните по карте, чтобы добавить точку', 'info');
    }

    showToast(message, type = 'info') {
        const toast = document.createElement('div');
        toast.className = `toast align-items-center text-white bg-${type} border-0`;
        toast.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 2000;';
        toast.innerHTML = `
            <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
            </div>
        `;
        
        document.body.appendChild(toast);
        const bsToast = new bootstrap.Toast(toast, { delay: 3000 });
        bsToast.show();
        
        toast.addEventListener('hidden.bs.toast', () => {
            document.body.removeChild(toast);
        });
    }

    getCSRFToken() {
        // Способ 1: Ищем скрытое поле CSRF
        const csrfInput = document.querySelector('[name=csrfmiddlewaretoken]');
        if (csrfInput) {
            return csrfInput.value;
        }
        
        // Способ 2: Ищем в cookies
        const cookieValue = document.cookie
            .split('; ')
            .find(row => row.startsWith('csrftoken='))
            ?.split('=')[1];
        
        if (cookieValue) {
            return cookieValue;
        }
        
        // Способ 3: Ищем в meta теге
        const metaToken = document.querySelector('meta[name="csrf-token"]');
        if (metaToken) {
            return metaToken.getAttribute('content');
        }
        
        console.error('CSRF token not found');
        return '';
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
    routeEditor = new RouteEditor();
    
    // Глобальные функции для вызова из HTML
    window.editPoint = (index) => routeEditor.editPoint(index);
    window.deletePoint = (index) => routeEditor.deletePoint(index);
    window.removePhoto = (index) => routeEditor.removePhoto(index);
    window.closePointDetails = () => routeEditor.closePointDetails();
});

// Обработка Escape для закрытия поисковых подсказок
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        document.getElementById('search-suggestions').style.display = 'none';
    }
});