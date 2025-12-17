# ai_audio/services/tts_service.py
import time
import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

class TTSService:
    def __init__(self):
        self.api_key = getattr(settings, "YANDEX_API_KEY", None)
        self.folder_id = getattr(settings, "YANDEX_FOLDER_ID", None)
        
        if not self.api_key or self.api_key == "your-yandex-key-here":
            raise ImproperlyConfigured(
                "YANDEX_API_KEY не задан в настройках. "
                "Добавьте в settings.py: YANDEX_API_KEY = 'ваш_ключ_от_яндекс_облака'"
            )
        
        # Карта голосов для старой версии API
        self.voice_map = {
            "male_guide_ru": "filipp",
            "female_guide_ru": "alena",
            "storyteller_ru": "filipp",
            "expert_ru": "zahar",
            "alloy": "ermil",
            "echo": "filipp",
            "nova": "alena",
        }

    def generate_audio(self, text: str, language: str = "ru", voice_type: str = "male_guide_ru", 
                       expressiveness: int = 50, **kwargs) -> (bytes, float):
        """Генерация аудио с поддержкой новых параметров"""
        start_time = time.time()
        
        # Получаем дополнительные параметры
        voice = kwargs.get('voice') or self.voice_map.get(voice_type, "filipp")
        emotion = kwargs.get('emotion', 'neutral')
        speed = kwargs.get('speed', 1.0)
        pitch = kwargs.get('pitch', 0)
        format = kwargs.get('format', 'mp3')
        
        # Подготовка данных для запроса
        data = {
            "text": text,
            "lang": "ru-RU",
            "voice": voice,
            "format": format,
            "sampleRateHertz": 48000,
            "emotion": emotion,
            "speed": str(speed),
        }
        
        # Добавляем pitch если не 0
        if pitch != 0:
            data["pitch"] = str(pitch)
        
        response = requests.post(
            "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize",
            headers={"Authorization": f"Api-Key {self.api_key}"},
            data=data,
            timeout=30
        )

        if response.status_code != 200:
            raise Exception(f"Ошибка Yandex TTS ({response.status_code}): {response.text[:200]}")

        return response.content, time.time() - start_time