import time
import logging

import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured

logger = logging.getLogger(__name__)


class TTSService:
    def __init__(self):
        self.api_key = getattr(settings, "YANDEX_API_KEY", None)
        self.folder_id = getattr(settings, "YANDEX_FOLDER_ID", None)

        if not self.api_key or self.api_key == "your-yandex-key-here":
            raise ImproperlyConfigured(
                "YANDEX_API_KEY is not configured. "
                "Add to settings.py: YANDEX_API_KEY ="
                " 'your_yandex_cloud_api_key'"
            )

        self.lang_voice_map = {
            "ru": {"lang": "ru-RU", "voice": "ermil"},
            "kk": {"lang": "kk-KZ", "voice": "amirkhan"},
            "uz": {"lang": "uz-UZ", "voice": "nigina"},
            "en": {"lang": "en-US", "voice": "alyss"},
            "de": {"lang": "de-DE", "voice": "lena"},
            "he": {"lang": "he-IL", "voice": "maor"},
        }

        self.voice_map = {
            "male_guide_ru": "filipp",
            "female_guide_ru": "alena",
            "storyteller_ru": "filipp",
            "expert_ru": "zahar",
            "alloy": "ermil",
            "echo": "filipp",
            "nova": "alena",
        }

    def generate_audio(
        self,
        text: str,
        language: str = "ru",
        voice_type: str = "alloy",
        expressiveness: int = 50,
        **kwargs,
    ) -> tuple[bytes, float]:
        voice = kwargs.get("voice") or self.voice_map.get(voice_type)
        emotion = kwargs.get("emotion", "neutral")
        speed = float(kwargs.get("speed", 1.0))
        pitch = int(kwargs.get("pitch", 0))
        format = kwargs.get("format", "mp3")

        lang_info = self.lang_voice_map.get(
            language, self.lang_voice_map["ru"]
        )
        lang = lang_info["lang"]
        default_voice = lang_info["voice"]

        final_voice = voice or default_voice

        data = {
            "text": text,
            "lang": lang,
            "voice": final_voice,
            "format": format,
            "sampleRateHertz": 48000,
            "emotion": emotion,
            "speed": str(speed),
        }

        if pitch != 0:
            data["pitch"] = str(pitch)

        try:
            start_time = time.time()
            response = requests.post(
                "https://tts.api.cloud.yandex.net/speech/v1/tts:synthesize",
                headers={"Authorization": f"Api-Key {self.api_key}"},
                data=data,
                timeout=30,
            )

            if response.status_code != 200:
                raise Exception(
                    f"Yandex TTS error ({response.status_code}):"
                    f" {response.text[:200]}"
                )

            audio_content = response.content
            processing_time = time.time() - start_time
            logger.info(
                f"Yandex TTS: generated in {processing_time:.2f}s,"
                f" lang={lang}, voice={final_voice}"
            )
            return audio_content, processing_time

        except Exception as e:
            logger.error(f"Yandex TTS error: {e}")
            raise
