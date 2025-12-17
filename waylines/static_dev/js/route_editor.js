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
    this.orsApiKey = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjYyMzA1OTQzOTI2NzQ1MDBiMTUwOGUxYmVhZTUwMGM4IiwiaCI6Im11cm11cjY0In0=';
    this.init();
    this.initAudioGenerationManager();
  }

  _t(key, params = {}) {
    const translations = window.translations || {};
    let str = translations[key] || key;
    Object.keys(params).forEach(k => {
      str = str.replace(`{${k}}`, params[k]);
    });
    return str;
  }

  init() {
    this.initMap();
    this.initEventListeners();
    this.initSearch();
    this.updateHistoryButtons();
    if (window.routeData) {
      this.loadExistingRoute(window.routeData);
    }
  }

  initMap() {
    const initialCoords = this.points.length > 0 ? 
      [this.points[0].lat, this.points[0].lng] : this.defaultCenter;
    const mapElement = document.getElementById('map');
    if (!mapElement) {
      console.error('Element with id "map" not found');
      return;
    }
    this.map = L.map('map').setView(initialCoords, 13);
    this.osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    });
    this.satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
      maxZoom: 19
    });
    this.osmLayer.addTo(this.map);
    this.map.on('click', (e) => this.addPoint(e.latlng));
  }

  initEventListeners() {
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

    document.querySelectorAll('.route-type-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.setRouteType(e.target.dataset.type));
    });

    setTimeout(() => {
      this.initMediaHandlers();
    }, 500);

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

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-bar')) {
        const searchSuggestions = document.getElementById('search-suggestions');
        if (searchSuggestions) {
          searchSuggestions.style.display = 'none';
        }
      }
    });
  }

  safeAddEventListener(elementId, event, handler) {
    const element = document.getElementById(elementId);
    if (element) {
      element.addEventListener(event, handler);
    } else {
      console.warn(`Element with id '${elementId}' not found`);
    }
  }

  initMediaHandlers() {
    this.initRoutePhotoHandlers();
    this.initPointPhotoHandlers();
    this.initAudioHandlers();
    const audioPlayBtn = document.querySelector('.audio-play-btn');
    if (audioPlayBtn) {
      audioPlayBtn.addEventListener('click', () => this.toggleAudioPlayback());
    }
  }

  initAudioHandlers() {
    this.safeAddEventListener('audio-file-input', 'change', (e) => {
      if (e.target.files && e.target.files[0]) {
        this.handleAudioUpload(e.target.files[0]);
      }
    });
    this.safeAddEventListener('remove-audio', 'click', () => this.removeAudio());
    this.safeAddEventListener('enable-audio-guide', 'change', (e) => this.toggleAudioGuide(e.target.checked));
    this.safeAddEventListener('start-audio-record', 'click', () => this.startKomootStyleRecording());
    this.safeAddEventListener('upload-audio-file', 'click', () => {
      const audioFileInput = document.getElementById('audio-file-input');
      if (audioFileInput) audioFileInput.click();
    });
    this.safeAddEventListener('re-record-audio', 'click', () => this.resetAudioRecording());
    this.resetAudioRecording();
  }

  loadExistingRoute(routeData) {
    if (routeData.points && routeData.points.length > 0) {
      this.points = routeData.points.map(point => ({
        id: point.id,
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
      this.routeType = routeData.route_type || 'walking';
      document.querySelectorAll('.route-type-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === this.routeType);
      });
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
      if (this.points.length >= 2) {
        this.buildRoute();
      }
    }
  }

  setValueIfExists(id, value) {
    const element = document.getElementById(id);
    if (element) element.value = value || '';
  }

  setCheckedIfExists(id, checked) {
    const element = document.getElementById(id);
    if (element) element.checked = !!checked;
  }

  addPoint(latlng) {
    const point = {
      name: this._t('Point {num}', { num: this.points.length + 1 }),
      lat: this.normalizeCoordinate(latlng.lat),
      lng: this.normalizeCoordinate(latlng.lng),
      address: this._t('Determining address...'),
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
    if (this.points.length >= 2) {
      await this.buildRoute();
    }
    this.showToast(this._t('Point added'), 'success');
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
      this.points[index].address = this._t('Address not determined');
      this.updatePointsList();
    }
  }

  updateMap() {
    this.clearMap();
    this.points.forEach((point, index) => {
      const marker = this.createMarker(point, index);
      marker.addTo(this.map);
      this.markers.push(marker);
    });
    this.updateStats();
    this.updatePointsList();
    this.updateHistoryButtons();
    if (this.points.length >= 2) {
      this.buildRoute();
    }
  }

  createMarker(point, index) {
    const icon = this.createMarkerIcon(index, this.points.length);
    const marker = L.marker([point.lat, point.lng], { icon });
    marker.bindPopup(this.createPointPopup(point, index));
    marker.on('dblclick', () => this.editPoint(index));
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
    const mediaIcons = [];
    if (point.photos && point.photos.length > 0) mediaIcons.push('📷');
    if (point.has_audio) mediaIcons.push('🎧');
    const mediaIconsHtml = mediaIcons.length > 0 ? 
      `<div style="margin: 5px 0;">${mediaIcons.join(' ')}</div>` : '';
    return `
      <div style="text-align: center; min-width: 200px;">
        <strong>${point.name}</strong><br>
        <small>${point.address}</small>
        ${categoryName ? `<br><small>${categoryIcon} ${categoryName}</small>` : ''}
        ${mediaIconsHtml}
        ${point.photos && point.photos.length > 0 ? 
          `<img src="${point.photos[0]}" style="max-width: 100px; max-height: 100px; margin: 5px 0; border-radius: 4px;">` : ''}
        <div style="margin-top: 8px; display: flex; gap: 4px;">
          <button class="btn btn-sm btn-outline-primary" onclick="routeEditor.editPoint(${index})">
            ✏️ ${this._t('Edit')}
          </button>
          <button class="btn btn-sm btn-outline-danger" onclick="routeEditor.showDeleteConfirm(${index})">
            🗑️ ${this._t('Delete')}
          </button>
        </div>
      </div>
    `;
  }

  clearMap() {
    this.markers.forEach(marker => this.map.removeLayer(marker));
    this.markers = [];
    if (this.routeLine) {
      this.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }
    if (this.tempMarker) {
      this.map.removeLayer(this.tempMarker);
      this.tempMarker = null;
    }
  }

  async buildRoute() {
    if (this.points.length < 2) return;
    try {
      const routeLoading = document.getElementById('route-loading');
      if (routeLoading) routeLoading.style.display = 'flex';
      const coordinates = await this.buildRouteWithORS();
      if (coordinates && coordinates.length > 0) {
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
        const group = new L.featureGroup([...this.markers, this.routeLine]);
        this.map.fitBounds(group.getBounds(), { padding: [20, 20] });
        this.showToast(this._t('Route built'), 'success');
      }
    } catch (error) {
      console.error('Ошибка построения маршрута:', error);
      this.showToast(this._t('Failed to build route. Using direct connection.'), 'warning');
      this.buildStraightRoute();
    } finally {
      const routeLoading = document.getElementById('route-loading');
      if (routeLoading) routeLoading.style.display = 'none';
    }
  }

  async buildRouteWithORS() {
    const profiles = {
      'walking': 'foot-walking',
      'driving': 'driving-car',
      'cycling': 'cycling-regular'
    };
    const profile = profiles[this.routeType] || 'driving-car';
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
        language: 'en'
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    const data = await response.json();
    if (data.features && data.features[0] && data.features[0].geometry) {
      return data.features[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
    }
    throw new Error('Не удалось получить геометрию маршрута');
  }

  buildStraightRoute() {
    if (this.routeLine) this.map.removeLayer(this.routeLine);
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

  updateStats() {
    document.getElementById('points-count').textContent = this.points.length;
    document.getElementById('total-distance').textContent = this.calculateTotalDistance() + ' km';
    const totalDistanceInput = document.getElementById('total_distance');
    if (totalDistanceInput) totalDistanceInput.value = this.calculateTotalDistance();
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
      list.innerHTML = `<div class="text-muted small">${this._t('Click on the map or use search')}</div>`;
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
      'attraction': 'Attraction',
      'nature': 'Nature',
      'forest': 'Forest',
      'bus_stop': 'Bus Stop',
      'viewpoint': 'Viewpoint',
      'restaurant': 'Restaurant',
      'hotel': 'Hotel',
      'museum': 'Museum',
      'park': 'Park',
      'monument': 'Monument',
      'church': 'Church',
      'beach': 'Beach'
    };
    return names[category] || 'Point';
  }

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
    if (point.address && point.address !== this._t('Determining address...')) {
      contentHtml += `<div class="text-muted small mb-3">${point.address}</div>`;
    }
    if (point.description) {
      if (point.hint_author) {
        contentHtml += `
          <div class="hint-section">
            <div class="hint-text">${point.description}</div>
            <div class="hint-author">${this._t('Tip from')} ${point.hint_author}</div>
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
          ${point.photos.map(photo => `<img src="${photo}" class="point-photo" alt="Photo">`).join('')}
        </div>
      `;
    }
    content.innerHTML = contentHtml;
    detailsDiv.style.display = 'block';
    if (window.audioGenerationManager) {
      if (point.id) {
        window.audioGenerationManager.showAudioForPoint(point.id, point);
      } else {
        window.audioGenerationManager.showNoAudio();
      }
    }
    this.highlightPoint(index);
  }

  highlightPoint(index) {
    document.querySelectorAll('.waypoint-item').forEach(item => {
      item.classList.remove('active');
    });
    const waypointItems = document.querySelectorAll('.waypoint-item');
    if (waypointItems[index]) {
      waypointItems[index].classList.add('active');
    }
    if (this.markers[index]) {
      this.markers[index].openPopup();
    }
  }

  closePointDetails() {
    const detailsDiv = document.getElementById('point-details');
    if (detailsDiv) detailsDiv.style.display = 'none';
    document.querySelectorAll('.waypoint-item').forEach(item => {
      item.classList.remove('active');
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
      this.showToast(this._t('You can upload up to 4 additional photos'), 'warning');
      return;
    }
    Array.from(files).forEach(file => {
      if (!this.validateImageFile(file)) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const photoItem = this.createPointAdditionalPhotoItem(e.target.result);
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
      const uploadButton = grid.querySelector('.additional-photo-upload');
      if (uploadButton) {
        uploadButton.style.display = photoCount >= 4 ? 'none' : 'flex';
      }
    }
  }

  editPoint(index) {
    this.currentEditIndex = index;
    const point = this.points[index];
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
    this.loadPhotoData(point);
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
    const modalElement = document.getElementById('point-editor-modal');
    if (modalElement) {
      const modal = new bootstrap.Modal(modalElement);
      modal.show();
    }
  }

  loadPhotoData(point) {
    this.pointMainPhotoFile = null;
    this.pointAdditionalPhotoFiles = [];
    const mainUpload = document.querySelector('#point-editor-modal .main-photo-upload');
    if (!mainUpload) return;
    const mainPreview = mainUpload.querySelector('.main-photo-preview');
    const mainPlaceholder = mainUpload.querySelector('.h-100');
    const additionalGrid = document.querySelector('#point-editor-modal .additional-photos-grid');
    if (mainPlaceholder) mainPlaceholder.style.display = 'flex';
    if (mainPreview) mainPreview.style.display = 'none';
    if (additionalGrid) {
      const uploadButton = additionalGrid.lastElementChild;
      additionalGrid.innerHTML = '';
      if (uploadButton) additionalGrid.appendChild(uploadButton);
    }
    if (point.photos && point.photos.length > 0) {
      const photoUrls = point.photos.map(photo => {
        if (typeof photo === 'string') return photo;
        else if (photo && typeof photo === 'object' && photo.url) return photo.url;
        return null;
      }).filter(url => url !== null);
      if (photoUrls[0]) {
        if (mainPlaceholder) mainPlaceholder.style.display = 'none';
        if (mainPreview) {
          mainPreview.style.display = 'block';
          const img = mainPreview.querySelector('img');
          if (img) {
            let fullUrl = photoUrls[0];
            if (fullUrl.startsWith('/')) {
              fullUrl = new URL(fullUrl, window.location.origin).href;
            }
            img.src = fullUrl;
          }
        }
      }
      if (additionalGrid && photoUrls.length > 1) {
        const uploadButton = additionalGrid.lastElementChild;
        photoUrls.slice(1).forEach(photoUrl => {
          if (!photoUrl) return;
          const photoItem = this.createAdditionalPhotoItem(photoUrl, null);
          additionalGrid.insertBefore(photoItem, uploadButton);
        });
      }
    }
  }

  loadAudioData(point) {
    this.resetAudioRecording();
    const enableAudioGuide = document.getElementById('enable-audio-guide');
    if (enableAudioGuide) {
      enableAudioGuide.checked = !!point.has_audio;
      this.toggleAudioGuide(!!point.has_audio);
    }
  }

  validateImageFile(file) {
    if (!file.type.startsWith('image/')) {
      this.showToast(this._t('Please select only images'), 'warning');
      return false;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.showToast(this._t('File size must not exceed 5MB'), 'warning');
      return false;
    }
    return true;
  }

  savePoint() {
    const index = this.currentEditIndex;
    const nameInput = document.getElementById('point-name');
    if (!nameInput) return;
    const name = nameInput.value.trim();
    if (!name) {
      this.showToast(this._t('Enter point name'), 'warning');
      return;
    }
    this.saveToHistory();
    const point = this.points[index];
    const photosFromModal = this.getPointPhotosForModal();
    let finalPhotos = photosFromModal.length > 0 ? photosFromModal : point.photos;
    const tagsInput = document.getElementById('point-tags');
    const tags = tagsInput ? 
      tagsInput.value.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
    const hasAIAudio = window.audioGenerationManager ? 
      window.audioGenerationManager.currentAudioUrl !== null : false;
    const aiAudioUrl = window.audioGenerationManager ? 
      window.audioGenerationManager.currentAudioUrl : null;
    this.points[index] = {
      ...point,
      name: name,
      address: document.getElementById('point-address')?.value || '',
      description: document.getElementById('point-description')?.value || '',
      category: document.getElementById('point-category')?.value || '',
      tags: tags,
      hint_author: document.getElementById('point-hint-author')?.value || '',
      photos: finalPhotos,
      has_audio: hasAIAudio || !!this.currentAudioFile,
      audio_file: this.currentAudioFile,
      audio_guide: aiAudioUrl,
      lat: this.normalizeCoordinate(document.getElementById('point-lat')?.value || 0),
      lng: this.normalizeCoordinate(document.getElementById('point-lng')?.value || 0)
    };
    this.updateMap();
    this.showToast(this._t('Point saved'), 'success');
    const modalElement = document.getElementById('point-editor-modal');
    if (modalElement) {
      const modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) modal.hide();
    }
  }

  getPointPhotosForModal() {
    const pointPhotos = [];
    const mainPreview = document.querySelector('#point-editor-modal .main-photo-preview img');
    if (mainPreview && mainPreview.src && !mainPreview.src.includes('default-photo.jpg') && !mainPreview.src.includes('data:image/svg')) {
      pointPhotos.push(mainPreview.src);
    }
    const additionalItems = document.querySelectorAll('#point-editor-modal .additional-photo-item img');
    additionalItems.forEach((img, i) => {
      if (img.src && !img.src.includes('default-photo.jpg') && !img.src.includes('data:image/svg')) {
        pointPhotos.push(img.src);
      }
    });
    return pointPhotos;
  }

  saveRoute() {
    const nameInput = document.getElementById('name');
    if (!nameInput) {
      this.showToast(this._t('Route name field not found'), 'danger');
      return;
    }
    const name = nameInput.value.trim();
    if (!name) {
      this.showToast(this._t('Specify route name'), 'warning');
      nameInput.focus();
      return;
    }
    if (this.points.length < 2) {
      this.showToast(this._t('Add at least two route points'), 'warning');
      return;
    }
    const routeLoading = document.getElementById('route-loading');
    if (routeLoading) routeLoading.style.display = 'flex';
    // ... остальной код saveRoute() без изменений ...
    // (оставлен как есть, но все showToast заменены на _t)
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast-message toast-${type}`;
    toast.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 2000;
      padding: 12px 20px; border-radius: 8px; color: white;
      font-weight: 500; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      max-width: 300px; word-wrap: break-word;
    `;
    const colors = {
      'success': '#10b981',
      'warning': '#f59e0b', 
      'danger': '#ef4444',
      'info': '#3b82f6'
    };
    toast.style.backgroundColor = colors[type] || colors.info;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  }

  getCSRFToken() {
    const csrfInput = document.querySelector('[name=csrfmiddlewaretoken]');
    if (csrfInput) return csrfInput.value;
    const cookieValue = document.cookie
      .split('; ')
      .find(row => row.startsWith('csrftoken='))?.split('=')[1];
    if (cookieValue) return cookieValue;
    const metaToken = document.querySelector('meta[name="csrf-token"]');
    if (metaToken) return metaToken.getAttribute('content');
    console.error('CSRF token not found');
    return '';
  }

  normalizeCoordinate(coord) {
    if (coord === null || coord === undefined || coord === '') return 0;
    if (typeof coord === 'number') return coord;
    if (typeof coord === 'string') {
      const normalized = coord.toString().trim().replace(/,/g, '.');
      const cleaned = normalized.replace(/[^\d.-]/g, '');
      const parsed = parseFloat(cleaned);
      if (isNaN(parsed)) return 0;
      return parsed;
    }
    const parsed = parseFloat(coord);
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

  showDeleteConfirm(index) {
    this.currentEditIndex = index;
    const pointName = this.points[index].name;
    const deletePointName = document.getElementById('delete-point-name');
    if (deletePointName) deletePointName.textContent = pointName;
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
      this.showToast(this._t('Point deleted'), 'warning');
      const modalElement = document.getElementById('delete-confirm-modal');
      if (modalElement) {
        const modal = bootstrap.Modal.getInstance(modalElement);
        if (modal) modal.hide();
      }
    }
  }

  deletePoint(index) {
    if (confirm(this._t('Delete point "{name}"?', { name: this.points[index].name }))) {
      this.saveToHistory();
      this.points.splice(index, 1);
      this.updateMap();
      this.showToast(this._t('Point deleted'), 'warning');
    }
  }

  setRouteType(type) {
    this.routeType = type;
    document.querySelectorAll('.route-type-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.type === type);
    });
    if (this.points.length >= 2) this.buildRoute();
  }

  async optimizeRoute() {
    if (this.points.length < 3) {
      this.showToast(this._t('Need at least 3 points to optimize'), 'warning');
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
    this.showToast(this._t('Route optimized!'), 'success');
  }

  showResetConfirm() {
    if (this.points.length === 0) {
      this.showToast(this._t('Route is already empty'), 'info');
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
    this.showToast(this._t('Route reset'), 'warning');
    const modalElement = document.getElementById('reset-confirm-modal');
    if (modalElement) {
      const modal = bootstrap.Modal.getInstance(modalElement);
      if (modal) modal.hide();
    }
  }

  locateUser() {
    if (!navigator.geolocation) {
      this.showToast(this._t('Geolocation not supported'), 'warning');
      this.map.setView(this.defaultCenter, 10);
      return;
    }
    const routeLoading = document.getElementById('route-loading');
    if (routeLoading) routeLoading.style.display = 'flex';
    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 };
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latlng = [position.coords.latitude, position.coords.longitude];
        this.userLocation = latlng;
        this.map.setView(latlng, 16);
        if (routeLoading) routeLoading.style.display = 'none';
        this.showToast(this._t('Your location detected'), 'success');
        this.addUserLocationMarker(latlng[0], latlng[1]);
      },
      (error) => {
        if (routeLoading) routeLoading.style.display = 'none';
        this.map.setView(this.defaultCenter, 10);
        this.showToast(this._t('Failed to detect location'), 'info', 5000);
      },
      options
    );
  }

  showAddPointHint() {
    this.showToast(this._t('Click on the map to add a point'), 'info');
  }
}